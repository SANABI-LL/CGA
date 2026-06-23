/**
 * MCP Tool: 智能建议下一步
 */

import { getWeekPlan } from '../curriculum.js'
import {
  readProgress,
  getOrInitWeekProgress,
  calculateCompletion,
  hasStudiedToday,
  getToday,
} from '../progress-tracker.js'

export const suggestNextStepTool = {
  name: 'suggest_next_step',
  description: '根据当前进度，智能建议下一步应该做什么',
  inputSchema: {
    type: 'object',
    properties: {},
  },
}

export async function handleSuggestNextStep(): Promise<string> {
  const progress = await readProgress()
  const currentWeek = progress.currentWeek
  const plan = getWeekPlan(currentWeek)

  if (!plan) {
    return '❌ 当前周无效，请检查进度配置'
  }

  const weekProgress = getOrInitWeekProgress(progress, currentWeek)
  const completion = calculateCompletion(weekProgress, plan.objectives.length)

  let output = ''

  // 情况 1: 今天还没学习
  if (!hasStudiedToday(progress)) {
    const daysSinceLastStudy = progress.lastActiveDate
      ? Math.floor(
          (new Date(getToday()).getTime() -
            new Date(progress.lastActiveDate).getTime()) /
            86400000
        )
      : 0

    output += `💡 建议：开始今天的学习\n\n`
    if (daysSinceLastStudy > 0) {
      output += `原因：你已经 ${daysSinceLastStudy} 天没有学习了，保持学习节奏很重要！\n\n`
    } else {
      output += `原因：今天还没有学习记录\n\n`
    }

    // 建议下一个目标
    const missingObjectives = plan.objectives.filter(
      (obj) => !weekProgress.completedObjectives.includes(obj)
    )

    if (missingObjectives.length > 0) {
      output += `📖 建议目标：${missingObjectives[0]}\n`
      output += `⏱️ 预计时间：1-2 小时\n\n`
    } else if (!weekProgress.practiceCompleted) {
      output += `🔨 建议：完成实践项目\n`
      output += `${plan.practice.description}\n\n`
    }

    output += `🎬 开始行动：运行 \`/learn-plan\` 查看详细计划\n`
    return output
  }

  // 情况 2: 今天已学习，检查完成度
  if (completion.canProceed) {
    // 完成度 >= 80%，建议进入下一周
    if (currentWeek < 6) {
      output += `💡 建议：进入下一周\n\n`
      output += `原因：Week ${currentWeek} 完成度 ${completion.percent}%，已达标！\n\n`
      output += `🎬 下一步：准备开始 Week ${currentWeek + 1}\n`
      const nextPlan = getWeekPlan(currentWeek + 1)
      if (nextPlan) {
        output += `主题：${nextPlan.title}\n`
      }
    } else {
      output += `🎉 恭喜！你已经完成了全部 6 周的学习！\n\n`
      output += `接下来可以：\n`
      output += `  - 复习之前的笔记\n`
      output += `  - 完成 CampusGeo Phase 1 部署\n`
      output += `  - 开始 Phase 2 的用户基础设施\n`
    }
    return output
  }

  // 情况 3: 连续学习 5+ 天，建议休息
  if (progress.streakDays >= 5) {
    output += `💡 建议：今天可以休息\n\n`
    output += `原因：你已经连续学习 ${progress.streakDays} 天了！🔥\n`
    output += `适当休息能提高长期学习效率。\n\n`
    output += `明天继续 Week ${currentWeek} 的剩余内容即可。\n`
    return output
  }

  // 情况 4: 今天已学习，但完成度 < 80%
  const missingObjectives = plan.objectives.filter(
    (obj) => !weekProgress.completedObjectives.includes(obj)
  )

  output += `💡 建议：继续完成本周目标\n\n`
  output += `原因：Week ${currentWeek} 完成度 ${completion.percent}%，距离 80% 还差 ${80 - completion.percent}%\n\n`

  if (missingObjectives.length > 0) {
    output += `📖 下一个目标：${missingObjectives[0]}\n`
    output += `⏱️ 预计时间：1-2 小时\n\n`
  } else if (!weekProgress.practiceCompleted) {
    output += `🔨 下一步：完成实践项目\n`
    output += `${plan.practice.description}\n\n`
  }

  output += `🎬 继续行动：运行 \`/learn-plan\` 查看详细计划\n`
  return output
}
