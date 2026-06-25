/**
 * AWS 学习路线课程大纲 (6 周)
 */

export interface WeekPlan {
  title: string
  estimatedHours: number
  objectives: string[]
  resources: Array<{
    type: 'video' | 'doc' | 'tutorial'
    title: string
    url: string
  }>
  practice: {
    description: string
    acceptanceCriteria: string[]
  }
}

export const curriculum: Record<string, WeekPlan> = {
  week1: {
    title: 'AWS 基础概念',
    estimatedHours: 10,
    objectives: [
      '注册 AWS Free Tier 账号并设置账单警报',
      '理解 IAM 权限模型（用户、角色、策略）',
      '理解 S3 存储桶和对象的概念',
      '理解 Lambda 无服务器计算的工作原理',
      '手动在 AWS 控制台创建第一个 Lambda 函数',
    ],
    resources: [
      {
        type: 'video',
        title: 'AWS Cloud Practitioner Essentials',
        url: 'https://aws.amazon.com/training/digital/aws-cloud-practitioner-essentials/',
      },
      {
        type: 'doc',
        title: 'Lambda 入门指南',
        url: 'https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html',
      },
      {
        type: 'doc',
        title: 'IAM 用户指南',
        url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html',
      },
    ],
    practice: {
      description: '在 AWS 控制台创建一个 Lambda 函数，返回 "Hello from Lambda"',
      acceptanceCriteria: [
        '能通过 Function URL 访问并看到返回结果',
        '理解 Lambda 的执行角色（Execution Role）作用',
      ],
    },
  },

  week2: {
    title: 'TypeScript + Lambda 本地开发',
    estimatedHours: 12,
    objectives: [
      '学习 AWS SDK for JavaScript v3 基础用法',
      '从 Lambda 读取 S3 文件并返回内容',
      '理解 Lambda 的 IAM 权限配置',
      '使用 AWS SAM CLI 或手动打包部署 Lambda',
    ],
    resources: [
      {
        type: 'doc',
        title: 'AWS Lambda Node.js Runtime',
        url: 'https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html',
      },
      {
        type: 'doc',
        title: 'AWS SDK for JavaScript v3',
        url: 'https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/',
      },
      {
        type: 'tutorial',
        title: 'Lambda + S3 示例',
        url: 'https://github.com/aws-samples/lambda-s3-examples',
      },
    ],
    practice: {
      description: '创建一个 Lambda 函数，从 S3 读取 JSON 文件并解析返回',
      acceptanceCriteria: [
        '能从 Lambda 成功读取 S3 文件',
        '理解如何为 Lambda 添加 s3:GetObject 权限',
        '本地测试通过',
      ],
    },
  },

  week3: {
    title: 'AWS CDK 入门',
    estimatedHours: 10,
    objectives: [
      '理解 Infrastructure as Code (IaC) 概念',
      '学习 CDK Stack、Construct、Props 基础',
      '用 CDK 创建 DynamoDB 表',
      '部署和销毁 CDK 应用',
    ],
    resources: [
      {
        type: 'tutorial',
        title: 'CDK TypeScript Workshop',
        url: 'https://cdkworkshop.com/',
      },
      {
        type: 'doc',
        title: 'AWS CDK API Reference',
        url: 'https://docs.aws.amazon.com/cdk/api/v2/',
      },
    ],
    practice: {
      description: '用 CDK 创建一个 DynamoDB 表并部署到 AWS',
      acceptanceCriteria: [
        '能用 cdk deploy 命令部署资源',
        '理解 CDK synthesize → CloudFormation 的流程',
        '能在 AWS 控制台看到创建的 DynamoDB 表',
      ],
    },
  },

  week4: {
    title: 'Bedrock + Tool Use',
    estimatedHours: 15,
    objectives: [
      '在 AWS 控制台启用 Claude 3.5 Sonnet 模型',
      '理解 Bedrock API 基础调用方法',
      '学习 Tool Use (Function Calling) 概念',
      '实现一个简单的 Tool Use 示例',
    ],
    resources: [
      {
        type: 'doc',
        title: 'Bedrock User Guide',
        url: 'https://docs.aws.amazon.com/bedrock/',
      },
      {
        type: 'doc',
        title: 'Claude Tool Use 文档',
        url: 'https://docs.anthropic.com/en/docs/tool-use',
      },
      {
        type: 'tutorial',
        title: 'Bedrock 示例代码',
        url: 'https://github.com/aws-samples/amazon-bedrock-samples',
      },
    ],
    practice: {
      description: '创建一个 Lambda，让 Claude 通过 Tool Use 调用自定义函数',
      acceptanceCriteria: [
        '能调用 Bedrock API 并获得 Claude 的 tool_use 响应',
        '理解 Tool Use 的多轮对话流程',
        '成功执行至少一个工具调用',
      ],
    },
  },

  week5: {
    title: 'CampusGeo Mini Project (Part 1)',
    estimatedHours: 20,
    objectives: [
      '设计简化版 CampusGeo 架构',
      '创建 CDK Stack（Lambda + DynamoDB + S3）',
      '实现查询工具（从 S3 读取 GeoJSON）',
      '部署到 AWS 并测试',
    ],
    resources: [
      {
        type: 'doc',
        title: 'CampusGeo CLAUDE.md',
        url: 'file://h:/Dropbox/Academy/Claude Code/GIS Agent/CLAUDE.md',
      },
      {
        type: 'doc',
        title: 'Turf.js 文档',
        url: 'https://turfjs.org/docs/',
      },
    ],
    practice: {
      description: '部署一个简化版 CampusGeo，能响应 "Show me buildings" 查询',
      acceptanceCriteria: [
        '成功部署 Lambda + S3 + DynamoDB',
        '能通过 API Gateway 调用',
        '返回正确的 GeoJSON 数据',
      ],
    },
  },

  week6: {
    title: 'CampusGeo Mini Project (Part 2) + 整合',
    estimatedHours: 20,
    objectives: [
      '添加多个查询工具（buildings, trees, parking）',
      '实现 Lambda 全局缓存优化',
      '前端简单集成测试',
      '完整的端到端验证',
    ],
    resources: [
      {
        type: 'doc',
        title: 'Phase 1 TEST_PLAN.md',
        url: 'file://h:/Dropbox/Academy/Claude Code/GIS Agent/TEST_PLAN.md',
      },
    ],
    practice: {
      description: '完成 CampusGeo Phase 1 的所有剩余任务',
      acceptanceCriteria: [
        'Lambda p95 延迟 < 2s',
        '至少 3 个查询工具正常工作',
        '前端能正确显示地图数据',
      ],
    },
  },
}

export function getWeekPlan(week: number): WeekPlan | null {
  const key = `week${week}`
  return curriculum[key] || null
}

export function getTotalWeeks(): number {
  return Object.keys(curriculum).length
}
