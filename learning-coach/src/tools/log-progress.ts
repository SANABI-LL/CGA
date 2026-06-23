/**
 * MCP Tool: 记录学习进度
 */

import { updateProgress } from '../progress-tracker.js'

export const logProgressTool = {
  name: 'log_learning_progress',
  description: '记录今天的学习内容和时长，更新完成的目标',
  inputSchema: {
    type: 'object',
    properties: {
      week: {
        type: 'number',
        description: '第几周（1-6）',
      },
      hoursSpent: {
        type: 'number',
        description: '学习时长（小时）',
      },
      completedObjectives: {
        type: 'array',
        items: { type: 'string' },
        description: '完成的学习目标列表',
      },
      notes: {
        type: 'string',
        description: '学习笔记（今天做了什么）',
      },
      learnings: {
        type: 'string',
        description: '学到的知识点或心得',
      },
    },
    required: ['week', 'hoursSpent', 'notes', 'learnings'],
  },
}

export async function handleLogProgress(args: {
  week: number
  hoursSpent: number
  completedObjectives?: string[]
  notes: string
  learnings: string
}): Promise<string> {
  const result = await updateProgress(
    args.week,
    args.hoursSpent,
    args.completedObjectives || [],
    args.notes,
    args.learnings
  )

  return result.message
}
