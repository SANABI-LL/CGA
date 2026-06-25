# Learning Coach - 真实的进度追踪工具

**改造说明**：不再是"管理学习的元工具"，而是**从 Git 提交自动提取进度的真实追踪器**。

## 🎯 当前状态（2026-06-25）

✅ **已记录今天的工作 - 不再是 `hoursSpent: 0`**

```
Week 1: in_progress
- 工作时间: 6.5 小时（真实）
- 完成目标: 8 个
- 连续天数: 1 天
- 实践完成: ✓
```

## 📊 今日成就

- ✅ S3 数据读取 (539 trees)
- ✅ 开发服务器启动
- ✅ 前端 SSE 集成
- ✅ Git: 21 files, +3541/-125 lines

## 🚀 快速使用

**查看进度（支持中文）**：

- **彩色版本**（推荐）：右键 `show-progress.ps1` → "使用 PowerShell 运行"
- **简化版本**：双击 `show-progress.bat`

**命令行使用**：
```bash
# 详细统计（含 Git 分析）
npm run track:stats

# 记录今日工作
npm run track:log

# 检查提醒
npm run track:remind
```

## 💡 核心原则

基于批评："做了督促学习的工具，然后没用它学习 = 元级别的拖延"

## 🎯 核心功能

### 1. **学习进度追踪**
- 记录每天的学习时长和完成的目标
- 自动计算连续学习天数
- 保存学习笔记和心得

### 2. **智能建议**
- 根据当前进度推荐下一步行动
- 检测学习断连并发出提醒
- 达到 80% 完成度自动提示进入下周

### 3. **跨电脑工作支持**
- 进度数据保存在 `data/progress.json`
- 通过 Git 同步到不同电脑
- 在任何电脑上都能无缝继续学习

## 📦 目录结构

```
learning-coach/
├── src/
│   ├── index.ts              # MCP 服务器入口
│   ├── curriculum.ts         # 6 周课程大纲
│   ├── progress-tracker.ts   # 进度管理逻辑
│   └── tools/                # 4 个 MCP 工具
│       ├── log-progress.ts
│       ├── get-weekly-plan.ts
│       ├── check-completion.ts
│       └── suggest-next-step.ts
├── data/
│   └── progress.json         # 用户进度（Git 跟踪）
├── dist/                     # 编译输出
└── README.md
```

## 🚀 使用方法

### 在 Claude Code 中调用

Learning Coach 作为 MCP 服务器运行，Claude Code 会自动加载它。你可以直接使用以下命令：

#### **查看本周计划**
```
你: 查看本周的学习计划

Claude: [调用 get_weekly_plan 工具]
📚 Week 1: AWS 基础概念

⏱️ 预计时长：10 小时
✅ 已完成：0/10 小时 (0%)

🎯 学习目标：
  ⬜ 注册 AWS Free Tier 账号并设置账单警报
  ⬜ 理解 IAM 权限模型（用户、角色、策略）
  ⬜ 理解 S3 存储桶和对象的概念
  ...
```

#### **记录学习进度**
```
你: 我今天学习了 2 小时，完成了 AWS 账号注册和 IAM 基础学习。
    笔记：成功注册 Free Tier，设置了 $10 的账单警报。
    学到：理解了 IAM 用户、角色、策略的区别。

Claude: [调用 log_learning_progress 工具]
✅ 进度已保存！

📊 本周: 2 小时，完成 2 个目标
🔥 连续学习: 1 天
```

#### **检查完成度**
```
你: Week 1 完成了多少？

Claude: [调用 check_weekly_completion 工具]
📊 Week 1: AWS 基础概念

完成度：40% ⏳

已完成目标 (2/5)：
  ✅ 注册 AWS Free Tier 账号并设置账单警报
  ✅ 理解 IAM 权限模型（用户、角色、策略）

未完成目标 (3)：
  ⬜ 理解 S3 存储桶和对象的概念
  ⬜ 理解 Lambda 无服务器计算的工作原理
  ⬜ 手动在 AWS 控制台创建第一个 Lambda 函数
```

#### **获取智能建议**
```
你: 我下一步应该做什么？

Claude: [调用 suggest_next_step 工具]
💡 建议：开始今天的学习

原因：今天还没有学习记录

📖 建议目标：理解 S3 存储桶和对象的概念
⏱️ 预计时间：1-2 小时

🎬 开始行动：运行 `/learn-plan` 查看详细计划
```

## 📚 6 周学习路线

| 周 | 主题 | 预计时长 | 核心目标 |
|---|------|---------|---------|
| 1 | AWS 基础概念 | 10h | IAM, S3, Lambda 入门 |
| 2 | TypeScript + Lambda 本地开发 | 12h | AWS SDK, S3 集成 |
| 3 | AWS CDK 入门 | 10h | IaC, DynamoDB 部署 |
| 4 | Bedrock + Tool Use | 15h | Claude API, 工具调用 |
| 5 | CampusGeo Mini Project (Part 1) | 20h | Lambda + S3 + DynamoDB |
| 6 | CampusGeo Mini Project (Part 2) | 20h | 完整集成测试 |

**总计：87 小时（约 7-9 周，每周 10 小时）**

## 🔄 跨电脑工作流程

### **公司电脑（周一、周四）**
```bash
# 开始工作前
cd "h:/Dropbox/Academy/Claude Code/GIS Agent"
git pull

# 工作结束后
你: 我今天完成了 Lambda S3 集成，学习了 2 小时

# Git 提交
git add learning-coach/data/progress.json
git commit -m "chore: update learning progress - Week 2 Lambda S3"
git push
```

### **个人电脑（其他时间）**
```bash
# 开始工作前
git pull

你: 我下一步应该做什么？
Claude: [自动读取 progress.json]
  💡 建议：继续完成 Week 2 的 Lambda IAM 权限配置
  原因：你昨天在公司电脑上完成了 S3 集成...
```

## 🎓 完成标准

每周达到 **80% 完成度**即可进入下一周：
- 学习目标：70% 权重
- 实践项目：30% 权重

**示例：**
- Week 1 有 5 个目标 + 1 个实践
- 完成 4 个目标 + 实践 = (4/5) × 0.7 + 1 × 0.3 = 86% ✅ 可进入 Week 2

## 🛠️ 开发和调试

### 重新编译
```bash
cd learning-coach
npm run build
```

### 查看进度文件
```bash
cat learning-coach/data/progress.json
```

### 手动修改进度
如果需要更正进度，直接编辑 `data/progress.json`：
```json
{
  "currentWeek": 2,
  "weeklyProgress": {
    "week1": {
      "status": "completed",
      "completedObjectives": [...],
      "hoursSpent": 10,
      ...
    }
  }
}
```

## 📝 数据格式

### progress.json 结构
```typescript
{
  "currentWeek": 1,                    // 当前周（1-6）
  "startDate": "2026-06-23",           // 开始日期
  "weeklyProgress": {
    "week1": {
      "status": "in_progress",         // not_started | in_progress | completed
      "completedObjectives": [...],    // 完成的目标列表
      "hoursSpent": 5,                 // 累计学习时长
      "notes": [                       // 学习笔记
        {
          "date": "2026-06-23",
          "timestamp": "2026-06-23T10:30:00.000Z",
          "content": "完成了 AWS 账号注册",
          "learnings": "理解了 IAM 的作用"
        }
      ],
      "practiceCompleted": false       // 实践项目是否完成
    }
  },
  "streakDays": 3,                     // 连续学习天数
  "lastActiveDate": "2026-06-23"       // 最后学习日期
}
```

## 🎯 下一步计划

- [ ] 实现 GitHub Actions 智能邮件提醒
- [ ] 添加可视化进度图（SVG 或 Mermaid）
- [ ] Pomodoro 计时器集成
- [ ] 自动检测代码提交（关联实践项目）

## 📄 License

MIT
