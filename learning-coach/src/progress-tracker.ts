/**
 * 学习进度追踪和持久化
 */

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface Progress {
  currentWeek: number
  startDate: string
  weeklyProgress: Record<string, WeekProgress>
  streakDays: number
  lastActiveDate: string
}

export interface WeekProgress {
  status: 'not_started' | 'in_progress' | 'completed'
  completedObjectives: string[]
  hoursSpent: number
  notes: Array<{
    date: string
    timestamp: string
    content: string
    learnings: string
  }>
  practiceCompleted: boolean
}

const PROGRESS_FILE = path.join(__dirname, '../data/progress.json')

/**
 * 读取学习进度
 */
export async function readProgress(): Promise<Progress> {
  try {
    const data = await fs.readFile(PROGRESS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    // 初始化默认进度
    const defaultProgress: Progress = {
      currentWeek: 1,
      startDate: new Date().toISOString().split('T')[0],
      weeklyProgress: {},
      streakDays: 0,
      lastActiveDate: '',
    }
    return defaultProgress
  }
}

/**
 * 写入学习进度
 */
export async function writeProgress(progress: Progress): Promise<void> {
  await fs.writeFile(PROGRESS_FILE, JSON.stringify(progress, null, 2), 'utf-8')
}

/**
 * 计算连续学习天数
 */
export function calculateStreak(progress: Progress): number {
  const today = new Date().toISOString().split('T')[0]

  if (progress.lastActiveDate === today) {
    // 今天已经记录过，保持现有 streak
    return progress.streakDays
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
  if (progress.lastActiveDate === yesterday) {
    // 连续学习
    return progress.streakDays + 1
  }

  // 断连，重新开始
  return 1
}

/**
 * 获取或初始化某周的进度
 */
export function getOrInitWeekProgress(
  progress: Progress,
  week: number
): WeekProgress {
  const key = `week${week}`
  if (!progress.weeklyProgress[key]) {
    progress.weeklyProgress[key] = {
      status: 'not_started',
      completedObjectives: [],
      hoursSpent: 0,
      notes: [],
      practiceCompleted: false,
    }
  }
  return progress.weeklyProgress[key]
}

/**
 * 更新学习进度
 */
export async function updateProgress(
  week: number,
  hoursSpent: number,
  completedObjectives: string[],
  notes: string,
  learnings: string
): Promise<{ success: boolean; message: string; progress: Progress }> {
  const progress = await readProgress()
  const weekProgress = getOrInitWeekProgress(progress, week)

  // 更新小时数
  weekProgress.hoursSpent += hoursSpent

  // 添加新完成的目标（去重）
  const newObjectives = completedObjectives.filter(
    (obj) => !weekProgress.completedObjectives.includes(obj)
  )
  weekProgress.completedObjectives.push(...newObjectives)

  // 更新状态
  if (weekProgress.completedObjectives.length > 0) {
    weekProgress.status = 'in_progress'
  }

  // 添加笔记
  const today = new Date().toISOString().split('T')[0]
  weekProgress.notes.push({
    date: today,
    timestamp: new Date().toISOString(),
    content: notes,
    learnings,
  })

  // 更新连续学习天数
  progress.streakDays = calculateStreak(progress)
  progress.lastActiveDate = today

  await writeProgress(progress)

  return {
    success: true,
    message: `✅ 进度已保存！\n\n📊 本周: ${weekProgress.hoursSpent} 小时，完成 ${weekProgress.completedObjectives.length} 个目标\n🔥 连续学习: ${progress.streakDays} 天`,
    progress,
  }
}

/**
 * 计算某周的完成度百分比（80% 标准）
 */
export function calculateCompletion(
  weekProgress: WeekProgress,
  totalObjectives: number
): {
  percent: number
  canProceed: boolean
  missingCount: number
} {
  const objectivesCompletion =
    weekProgress.completedObjectives.length / totalObjectives
  const practiceCompletion = weekProgress.practiceCompleted ? 1 : 0

  // 目标 70% + 实践 30%
  const overall = objectivesCompletion * 0.7 + practiceCompletion * 0.3

  return {
    percent: Math.round(overall * 100),
    canProceed: overall >= 0.8, // 80% 标准
    missingCount: totalObjectives - weekProgress.completedObjectives.length,
  }
}

/**
 * 获取今天的日期（YYYY-MM-DD）
 */
export function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

/**
 * 检查今天是否已经学习过
 */
export function hasStudiedToday(progress: Progress): boolean {
  return progress.lastActiveDate === getToday()
}

/**
 * 获取所有学习笔记
 */
export function getAllNotes(
  progress: Progress
): Array<{
  date: string
  timestamp: string
  content: string
  learnings: string
}> {
  const allNotes: Array<{
    date: string
    timestamp: string
    content: string
    learnings: string
  }> = []

  for (const weekKey in progress.weeklyProgress) {
    allNotes.push(...progress.weeklyProgress[weekKey].notes)
  }

  // 按时间戳排序
  return allNotes.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
