/**
 * MCP Tool: 检查某周完成度（80% 标准）
 */

import { getWeekPlan } from '../curriculum.js'
import {
  readProgress,
  getOrInitWeekProgress,
  calculateCompletion,
} from '../progress-tracker.js'

export const checkCompletionTool = {
  name: 'check_weekly_completion',
  description: '检查某周是否完成，给出完成度百分比（80% 即算完成）',
  inputSchema: {
    type: 'object',
    properties: {
      week: {
        type: 'number',
        description: '第几周（1-6）',
      },
    },
    required: ['week'],
  },
}

export async function handleCheckCompletion(args: {
  week: number
}): Promise<string> {
  const progress = await readProgress()
  const plan = getWeekPlan(args.week)

  if (!plan) {
    return `❌ Week ${args.week} 不存在`
  }

  const weekProgress = getOrInitWeekProgress(progress, args.week)
  const completion = calculateCompletion(weekProgress, plan.objectives.length)

  let output = `📊 Week ${args.week}: ${plan.title}\n\n`
  output += `完成度：${completion.percent}% ${completion.canProceed ? '✅' : '⏳'}\n\n`

  // 已完成目标
  output += `已完成目标 (${weekProgress.completedObjectives.length}/${plan.objectives.length})：\n`
  weekProgress.completedObjectives.forEach((obj) => {
    output += `  ✅ ${obj}\n`
  })
  output += `\n`

  // 未完成目标
  const missingObjectives = plan.objectives.filter(
    (obj) => !weekProgress.completedObjectives.includes(obj)
  )
  if (missingObjectives.length > 0) {
    output += `未完成目标 (${missingObjectives.length})：\n`
    missingObjectives.forEach((obj) => {
      output += `  ⬜ ${obj}\n`
    })
    output += `\n`
  }

  // 实践项目
  output += `实践项目：${weekProgress.practiceCompleted ? '✅ 已完成' : '⬜ 未完成'}\n\n`

  // 时长统计
  output += `学习时长：${weekProgress.hoursSpent}/${plan.estimatedHours} 小时\n\n`

  // 建议
  if (completion.canProceed) {
    output += `💡 建议：\n`
    output += `🎉 Week ${args.week} 完成度 ${completion.percent}%，已达标！\n`
    if (args.week < 6) {
      output += `可以运行 \`/learn-start-week ${args.week + 1}\` 进入下一周。\n`
    } else {
      output += `恭喜你完成了所有 6 周的学习！🎓\n`
    }
  } else {
    output += `💡 建议：\n`
    output += `⏳ Week ${args.week} 完成度 ${completion.percent}%，距离 80% 还差 ${80 - completion.percent}%\n`
    if (missingObjectives.length > 0) {
      output += `建议先完成：${missingObjectives[0]}\n`
    }
  }

  return output
}
