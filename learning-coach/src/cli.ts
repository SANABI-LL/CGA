#!/usr/bin/env node
/**
 * Learning Coach CLI - 真实的进度追踪工具
 *
 * 使用方法：
 *   pnpm track           - 显示进度报告
 *   pnpm track log       - 记录今天的工作
 *   pnpm track stats     - 显示 Git 统计
 *   pnpm track remind    - 检查是否需要提醒
 */

import {
  generateProgressReport,
  getGitLog,
  calculateGitStats,
  estimateWorkHours,
  getTodayCommits,
  getThisWeekCommits,
  shouldRemindCommit,
} from './git-tracker.js'
import { readProgress, writeProgress, updateProgress } from './progress-tracker.js'

const command = process.argv[2] || 'report'

async function main() {
  switch (command) {
    case 'report':
    case 'status':
      showReport()
      break

    case 'log':
      await logTodayProgress()
      break

    case 'stats':
      showDetailedStats()
      break

    case 'remind':
      checkReminder()
      break

    case 'init':
      await initProgress()
      break

    default:
      console.log(`
Learning Coach - 真实的进度追踪工具

使用方法:
  pnpm track           显示进度报告
  pnpm track log       记录今天的工作
  pnpm track stats     显示详细统计
  pnpm track remind    检查提醒
  pnpm track init      初始化进度（记录今天的工作）

示例:
  pnpm track
  pnpm track log
      `)
  }
}

/**
 * 显示进度报告
 */
function showReport() {
  console.log(generateProgressReport())
}

/**
 * 记录今天的进度
 */
async function logTodayProgress() {
  const todayCommits = getTodayCommits()

  if (todayCommits.length === 0) {
    console.log('❌ 今天还没有提交任何代码')
    console.log('💡 先完成一些工作并 git commit，然后再运行 pnpm track log')
    return
  }

  const hoursEstimated = estimateWorkHours(todayCommits)
  const objectives = todayCommits.map((c) => c.message)

  // 生成学习总结
  const learnings = todayCommits
    .map((c) => `- ${c.message} (${c.filesChanged} files, +${c.insertions}/-${c.deletions} lines)`)
    .join('\n')

  const notes = `今天完成了 ${todayCommits.length} 次提交，涉及 ${todayCommits.reduce((sum, c) => sum + c.filesChanged, 0)} 个文件。`

  const result = await updateProgress(
    1, // currentWeek
    hoursEstimated,
    objectives,
    notes,
    learnings
  )

  console.log(result.message)
  console.log('\n📝 详细记录:')
  console.log(learnings)
}

/**
 * 显示详细统计
 */
function showDetailedStats() {
  const commits = getGitLog(100)
  const stats = calculateGitStats(commits)

  console.log('\n📊 Git 统计详情')
  console.log('='.repeat(50))
  console.log(`总提交数: ${stats.totalCommits}`)
  console.log(`文件变更: ${stats.totalFilesChanged}`)
  console.log(`代码新增: +${stats.totalInsertions}`)
  console.log(`代码删除: -${stats.totalDeletions}`)
  console.log(`净增长: ${stats.totalInsertions - stats.totalDeletions} 行`)
  console.log(`\n活跃度:`)
  console.log(`  当前连续: ${stats.currentStreak} 天`)
  console.log(`  上次提交: ${stats.lastCommitDate}`)
  console.log(`  距今天数: ${stats.daysSinceLastCommit} 天`)

  console.log('\n📅 按日期统计:')
  const dates = Object.keys(stats.commitsByDate).sort().reverse().slice(0, 10)
  for (const date of dates) {
    const count = stats.commitsByDate[date]
    const bar = '█'.repeat(count)
    console.log(`  ${date}: ${bar} (${count})`)
  }

  console.log(`\n⏱️  估算工作时间: ~${estimateWorkHours(commits)} 小时`)
}

/**
 * 检查提醒
 */
function checkReminder() {
  const { remind, message } = shouldRemindCommit()

  if (remind) {
    console.log(message)
  } else {
    console.log('✅ 进度良好，继续保持！')
  }

  const todayCommits = getTodayCommits()
  if (todayCommits.length > 0) {
    console.log(`\n今天已提交 ${todayCommits.length} 次 ✓`)
  } else {
    console.log('\n今天还没有提交')
  }
}

/**
 * 初始化进度（记录今天的工作）
 */
async function initProgress() {
  console.log('🚀 初始化 Learning Coach...\n')

  const todayCommits = getTodayCommits()

  if (todayCommits.length === 0) {
    console.log('⚠️  警告: 今天还没有 git commit')
    console.log('💡 建议: 先完成一些工作并提交，然后运行:')
    console.log('   pnpm track log')
    return
  }

  console.log(`✅ 检测到今天有 ${todayCommits.length} 次提交\n`)

  // 更新进度
  const hoursEstimated = estimateWorkHours(todayCommits)
  const objectives = todayCommits.map((c) => c.message)
  const notes = `Phase 1 完成: 前后端集成与开发服务器。今天完成了 ${todayCommits.length} 次提交。`
  const learnings = todayCommits
    .map((c) => `- ${c.message}`)
    .join('\n')

  const progress = await readProgress()
  progress.currentWeek = 1
  progress.startDate = new Date().toISOString().split('T')[0]
  progress.lastActiveDate = new Date().toISOString().split('T')[0]
  progress.streakDays = 1

  const weekProgress = {
    status: 'in_progress' as const,
    completedObjectives: objectives,
    hoursSpent: hoursEstimated,
    notes: [{
      date: new Date().toISOString().split('T')[0],
      timestamp: new Date().toISOString(),
      content: notes,
      learnings,
    }],
    practiceCompleted: true, // 今天完成了实际部署和测试
  }

  progress.weeklyProgress['week1'] = weekProgress

  await writeProgress(progress)

  console.log('✅ 初始化完成！\n')
  console.log('📊 当前状态:')
  console.log(`  - 本周工作: ${hoursEstimated} 小时`)
  console.log(`  - 完成目标: ${objectives.length} 个`)
  console.log(`  - 连续学习: ${progress.streakDays} 天`)
  console.log(`  - 实践完成: ✓`)

  console.log('\n🎯 今日成就:')
  console.log(learnings)

  console.log('\n💡 下次使用:')
  console.log('  pnpm track          - 查看进度报告')
  console.log('  pnpm track log      - 记录今天的工作')
  console.log('  pnpm track stats    - 查看详细统计')
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
