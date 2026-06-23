/**
 * MCP Tool: 获取本周学习计划
 */

import { getWeekPlan } from '../curriculum.js'
import { readProgress, getOrInitWeekProgress } from '../progress-tracker.js'

export const getWeeklyPlanTool = {
  name: 'get_weekly_plan',
  description: '获取当前周或指定周的学习计划，包括目标、资源和进度',
  inputSchema: {
    type: 'object',
    properties: {
      week: {
        type: 'number',
        description: '第几周（1-6），不指定则返回当前周',
      },
    },
  },
}

export async function handleGetWeeklyPlan(args: {
  week?: number
}): Promise<string> {
  const progress = await readProgress()
  const targetWeek = args.week || progress.currentWeek

  const plan = getWeekPlan(targetWeek)
  if (!plan) {
    return `❌ Week ${targetWeek} 不存在（课程总共 6 周）`
  }

  const weekProgress = getOrInitWeekProgress(progress, targetWeek)

  // 格式化输出
  let output = `📚 Week ${targetWeek}: ${plan.title}\n\n`
  output += `⏱️ 预计时长：${plan.estimatedHours} 小时\n`
  output += `✅ 已完成：${weekProgress.hoursSpent}/${plan.estimatedHours} 小时 (${Math.round((weekProgress.hoursSpent / plan.estimatedHours) * 100)}%)\n\n`

  // 学习目标
  output += `🎯 学习目标：\n`
  plan.objectives.forEach((obj, idx) => {
    const completed = weekProgress.completedObjectives.includes(obj)
    output += `  ${completed ? '✅' : '⬜'} ${obj}\n`
  })
  output += `\n`

  // 实践项目
  output += `🔨 实践项目：\n`
  output += `  ${plan.practice.description}\n`
  output += `  状态：${weekProgress.practiceCompleted ? '✅ 已完成' : '⬜ 待完成'}\n\n`

  // 验收标准
  output += `  验收标准：\n`
  plan.practice.acceptanceCriteria.forEach((criteria) => {
    output += `    - ${criteria}\n`
  })
  output += `\n`

  // 学习资源
  output += `📖 学习资源：\n`
  plan.resources.forEach((res) => {
    output += `  - [${res.type}] ${res.title}\n`
    output += `    ${res.url}\n`
  })

  return output
}
