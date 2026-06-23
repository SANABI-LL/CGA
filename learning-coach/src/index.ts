#!/usr/bin/env node
/**
 * AWS Learning Coach - MCP Server
 *
 * 提供 4 个工具：
 * 1. log_learning_progress - 记录学习进度
 * 2. get_weekly_plan - 获取学习计划
 * 3. check_weekly_completion - 检查完成度
 * 4. suggest_next_step - 智能建议
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import { logProgressTool, handleLogProgress } from './tools/log-progress.js'
import {
  getWeeklyPlanTool,
  handleGetWeeklyPlan,
} from './tools/get-weekly-plan.js'
import {
  checkCompletionTool,
  handleCheckCompletion,
} from './tools/check-completion.js'
import {
  suggestNextStepTool,
  handleSuggestNextStep,
} from './tools/suggest-next-step.js'

const server = new Server(
  {
    name: 'learning-coach',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    logProgressTool,
    getWeeklyPlanTool,
    checkCompletionTool,
    suggestNextStepTool,
  ],
}))

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    let result: string

    switch (name) {
      case 'log_learning_progress':
        result = await handleLogProgress(args as any)
        break

      case 'get_weekly_plan':
        result = await handleGetWeeklyPlan(args as any)
        break

      case 'check_weekly_completion':
        result = await handleCheckCompletion(args as any)
        break

      case 'suggest_next_step':
        result = await handleSuggestNextStep()
        break

      default:
        throw new Error(`Unknown tool: ${name}`)
    }

    return {
      content: [
        {
          type: 'text',
          text: result,
        },
      ],
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error)
    return {
      content: [
        {
          type: 'text',
          text: `❌ Error: ${errorMessage}`,
        },
      ],
      isError: true,
    }
  }
})

// 启动服务器
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('AWS Learning Coach MCP server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
