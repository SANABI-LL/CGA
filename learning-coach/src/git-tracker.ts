/**
 * Git 提交追踪器 - 从 git log 自动提取工作时间和进度
 */

import { execSync } from 'child_process'
import path from 'path'

export interface GitCommit {
  hash: string
  date: string
  message: string
  author: string
  filesChanged: number
  insertions: number
  deletions: number
}

export interface GitStats {
  totalCommits: number
  totalFilesChanged: number
  totalInsertions: number
  totalDeletions: number
  commitsByDate: Record<string, number>
  lastCommitDate: string
  daysSinceLastCommit: number
  currentStreak: number
}

/**
 * 获取项目根目录
 */
function getRepoRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
  } catch (error) {
    throw new Error('Not in a git repository')
  }
}

/**
 * 获取 git log（最近 N 个提交）
 */
export function getGitLog(limit: number = 100): GitCommit[] {
  const repoRoot = getRepoRoot()

  try {
    const log = execSync(
      `git log -${limit} --pretty=format:"%H|%ad|%s|%an" --date=short --numstat`,
      { cwd: repoRoot, encoding: 'utf-8' }
    )

    const commits: GitCommit[] = []
    const lines = log.split('\n')

    let currentCommit: Partial<GitCommit> | null = null
    let filesChanged = 0
    let insertions = 0
    let deletions = 0

    for (const line of lines) {
      if (line.includes('|')) {
        // 提交信息行
        if (currentCommit) {
          commits.push({
            ...currentCommit,
            filesChanged,
            insertions,
            deletions,
          } as GitCommit)
        }

        const [hash, date, message, author] = line.split('|')
        currentCommit = { hash, date, message, author }
        filesChanged = 0
        insertions = 0
        deletions = 0
      } else if (line.trim() && currentCommit) {
        // numstat 行
        const [added, removed] = line.split('\t')
        if (added !== '-' && removed !== '-') {
          filesChanged++
          insertions += parseInt(added) || 0
          deletions += parseInt(removed) || 0
        }
      }
    }

    // 添加最后一个 commit
    if (currentCommit) {
      commits.push({
        ...currentCommit,
        filesChanged,
        insertions,
        deletions,
      } as GitCommit)
    }

    return commits
  } catch (error) {
    console.error('Failed to get git log:', error)
    return []
  }
}

/**
 * 计算 git 统计数据
 */
export function calculateGitStats(commits: GitCommit[]): GitStats {
  if (commits.length === 0) {
    return {
      totalCommits: 0,
      totalFilesChanged: 0,
      totalInsertions: 0,
      totalDeletions: 0,
      commitsByDate: {},
      lastCommitDate: '',
      daysSinceLastCommit: 0,
      currentStreak: 0,
    }
  }

  const stats: GitStats = {
    totalCommits: commits.length,
    totalFilesChanged: 0,
    totalInsertions: 0,
    totalDeletions: 0,
    commitsByDate: {},
    lastCommitDate: commits[0].date,
    daysSinceLastCommit: 0,
    currentStreak: 0,
  }

  // 统计总数
  for (const commit of commits) {
    stats.totalFilesChanged += commit.filesChanged
    stats.totalInsertions += commit.insertions
    stats.totalDeletions += commit.deletions

    // 按日期统计
    if (!stats.commitsByDate[commit.date]) {
      stats.commitsByDate[commit.date] = 0
    }
    stats.commitsByDate[commit.date]++
  }

  // 计算距离上次提交的天数
  const lastCommitTime = new Date(stats.lastCommitDate).getTime()
  const now = Date.now()
  stats.daysSinceLastCommit = Math.floor((now - lastCommitTime) / (1000 * 60 * 60 * 24))

  // 计算连续提交天数（从今天往回数）
  const today = new Date().toISOString().split('T')[0]
  const dates = Object.keys(stats.commitsByDate).sort().reverse()

  let streak = 0
  let checkDate = new Date(today)

  for (let i = 0; i < 30; i++) {
    const dateStr = checkDate.toISOString().split('T')[0]
    if (stats.commitsByDate[dateStr]) {
      streak++
    } else if (streak > 0) {
      break
    }
    checkDate = new Date(checkDate.getTime() - 24 * 60 * 60 * 1000)
  }

  stats.currentStreak = streak

  return stats
}

/**
 * 估算工作小时数（基于代码变更量）
 * 假设：每 100 行代码变更 ≈ 1 小时工作
 */
export function estimateWorkHours(commits: GitCommit[]): number {
  const totalLines = commits.reduce(
    (sum, c) => sum + c.insertions + c.deletions,
    0
  )
  return Math.round((totalLines / 100) * 10) / 10 // 保留一位小数
}

/**
 * 获取今天的提交
 */
export function getTodayCommits(): GitCommit[] {
  const today = new Date().toISOString().split('T')[0]
  const allCommits = getGitLog(50)
  return allCommits.filter((c) => c.date === today)
}

/**
 * 获取本周的提交（周一到周日）
 */
export function getThisWeekCommits(): GitCommit[] {
  const now = new Date()
  const dayOfWeek = now.getDay() // 0 = Sunday, 1 = Monday, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
  const monday = new Date(now.getTime() + mondayOffset * 24 * 60 * 60 * 1000)
  const mondayStr = monday.toISOString().split('T')[0]

  const allCommits = getGitLog(100)
  return allCommits.filter((c) => c.date >= mondayStr)
}

/**
 * 生成进度报告
 */
export function generateProgressReport(): string {
  const commits = getGitLog(100)
  const stats = calculateGitStats(commits)
  const todayCommits = getTodayCommits()
  const weekCommits = getThisWeekCommits()
  const estimatedHours = estimateWorkHours(commits)

  const report = `
📊 CampusGeo 项目进度报告
${'='.repeat(50)}

📈 总体统计
  - 总提交数: ${stats.totalCommits}
  - 总文件变更: ${stats.totalFilesChanged}
  - 代码新增: +${stats.totalInsertions} 行
  - 代码删除: -${stats.totalDeletions} 行
  - 估算工作时间: ~${estimatedHours} 小时

🔥 活跃度
  - 当前连续: ${stats.currentStreak} 天
  - 上次提交: ${stats.lastCommitDate} (${stats.daysSinceLastCommit} 天前)
  - 今日提交: ${todayCommits.length} 次
  - 本周提交: ${weekCommits.length} 次

📅 最近提交
${commits.slice(0, 5).map((c) =>
  `  ${c.date} | ${c.hash.slice(0, 7)} | ${c.message.slice(0, 60)}`
).join('\n')}

${stats.daysSinceLastCommit > 2 ? '\n⚠️  警告: 已经 ' + stats.daysSinceLastCommit + ' 天没有提交了！' : ''}
${stats.currentStreak > 5 ? '\n🎉 太棒了！连续 ' + stats.currentStreak + ' 天保持活跃！' : ''}
`

  return report
}

/**
 * 检查是否需要提醒提交
 */
export function shouldRemindCommit(): { remind: boolean; message: string } {
  const stats = calculateGitStats(getGitLog(100))

  if (stats.daysSinceLastCommit >= 3) {
    return {
      remind: true,
      message: `⚠️ 已经 ${stats.daysSinceLastCommit} 天没有提交了！你的连续记录会中断。`,
    }
  }

  if (stats.daysSinceLastCommit >= 1 && stats.currentStreak >= 5) {
    return {
      remind: true,
      message: `💪 你已经连续 ${stats.currentStreak} 天提交了！继续保持！`,
    }
  }

  return { remind: false, message: '' }
}
