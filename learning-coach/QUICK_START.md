# Learning Coach 快速开始指南

## 🎉 恭喜！Learning Coach 系统已经部署成功

你现在可以立即开始使用它来追踪你的 AWS 学习进度。

---

## ✅ 系统状态检查

已完成的配置：
- ✅ MCP 服务器已编译（`learning-coach/dist/`）
- ✅ MCP 配置已添加（`.claude/mcp_settings.json`）
- ✅ 初始进度文件已创建（`learning-coach/data/progress.json`）
- ✅ 6 周课程大纲已配置
- ✅ 代码已推送到 GitHub

---

## 🚀 立即开始使用

### Step 1: 重启 Claude Code

**重要：** 你需要重启 Claude Code 才能加载新的 MCP 服务器。

**Windows：**
```
关闭当前 Claude Code 窗口
重新打开 Claude Code
```

**或者：**
```
按 Ctrl+Shift+P
输入 "Reload Window"
```

### Step 2: 验证 MCP 加载

重启后，在 Claude Code 中输入：

```
你: Learning Coach 系统加载了吗？
```

如果成功加载，Claude 应该能够识别并使用以下工具：
- `log_learning_progress`
- `get_weekly_plan`
- `check_weekly_completion`
- `suggest_next_step`

### Step 3: 查看第一周的学习计划

```
你: 查看 Week 1 的学习计划
```

**预期输出：**
```
📚 Week 1: AWS 基础概念

⏱️ 预计时长：10 小时
✅ 已完成：0/10 小时 (0%)

🎯 学习目标：
  ⬜ 注册 AWS Free Tier 账号并设置账单警报
  ⬜ 理解 IAM 权限模型（用户、角色、策略）
  ⬜ 理解 S3 存储桶和对象的概念
  ⬜ 理解 Lambda 无服务器计算的工作原理
  ⬜ 手动在 AWS 控制台创建第一个 Lambda 函数

🔨 实践项目：
  在 AWS 控制台创建一个 Lambda 函数，返回 'Hello from Lambda'
  状态：⬜ 待完成

📖 学习资源：
  - [video] AWS Cloud Practitioner Essentials
    https://aws.amazon.com/training/digital/aws-cloud-practitioner-essentials/
  - [doc] Lambda 入门指南
    https://docs.aws.amazon.com/lambda/latest/dg/getting-started.html
  - [doc] IAM 用户指南
    https://docs.aws.amazon.com/IAM/latest/UserGuide/introduction.html
```

### Step 4: 记录你的第一次学习

假设你今天完成了 AWS 账号注册，学习了 1 小时：

```
你: 我今天学习了 1 小时，完成了 AWS Free Tier 账号注册。
    笔记：成功注册账号，设置了 $10 的账单警报。
    学到：理解了 AWS Free Tier 的 12 个月免费期限。
```

**预期输出：**
```
✅ 进度已保存！

📊 本周: 1 小时，完成 1 个目标
🔥 连续学习: 1 天
```

### Step 5: 获取下一步建议

```
你: 我下一步应该做什么？
```

**预期输出：**
```
💡 建议：继续完成本周目标

原因：Week 1 完成度 20%，距离 80% 还差 60%

📖 下一个目标：理解 IAM 权限模型（用户、角色、策略）
⏱️ 预计时间：1-2 小时

🎬 继续行动：运行 `/learn-plan` 查看详细计划
```

---

## 📅 典型的一天学习流程

### 早上（开始学习前）
```
你: 我下一步应该做什么？

Claude: [分析进度]
  💡 建议：开始今天的学习
  📖 建议目标：理解 Lambda 无服务器计算的工作原理
  ⏱️ 预计时间：1-2 小时
```

### 晚上（学习结束后）
```
你: 我今天学习了 2 小时，完成了 Lambda 基础概念学习和第一个 Lambda 函数创建。
    笔记：在控制台创建了 hello-lambda，通过 Function URL 测试成功。
    学到：理解了 Execution Role 的作用，Lambda 需要 IAM 权限才能访问其他 AWS 服务。

Claude: [记录进度]
  ✅ 进度已保存！
  📊 本周: 5 小时，完成 4 个目标
  🔥 连续学习: 3 天
```

### 周末（检查进度）
```
你: Week 1 完成了多少？

Claude: [检查完成度]
  📊 Week 1: AWS 基础概念
  完成度：80% ✅
  
  💡 建议：
  🎉 Week 1 完成度 80%，已达标！
  可以运行 `/learn-start-week 2` 进入下一周。
```

---

## 🔄 跨电脑工作示例

### 场景：周一在公司电脑完成学习

**公司电脑（AWS Bedrock Claude）：**
```bash
# 开始工作
cd "h:/Dropbox/Academy/Claude Code/GIS Agent"
git pull

你: 我下一步应该做什么？
Claude: 💡 建议：继续完成 Week 2 的 Lambda S3 集成

[学习 2 小时后...]

你: 我今天完成了 Lambda 从 S3 读取文件，学习了 2 小时。

# 结束工作前
git add learning-coach/data/progress.json
git commit -m "chore: update learning progress - Week 2 Lambda S3"
git push
```

### 场景：周二在个人电脑继续

**个人电脑（claude.ai）：**
```bash
# 开始工作
git pull  # 自动拉取昨天的进度

你: 我下一步应该做什么？
Claude: [读取 progress.json]
  💡 建议：继续完成本周目标
  
  原因：Week 2 完成度 50%
  📖 下一个目标：理解 Lambda 的 IAM 权限配置
  
  （你昨天在公司电脑上完成了 S3 集成，今天可以继续 IAM 权限部分）
```

✅ **无缝切换！** Learning Coach 自动读取 Git 同步的进度，知道你的学习历史。

---

## 🛠️ 故障排除

### 问题 1: MCP 服务器未加载

**症状：** Claude 无法识别学习追踪相关的请求

**解决：**
1. 检查 `.claude/mcp_settings.json` 是否存在
2. 确认路径正确（绝对路径）
3. 重启 Claude Code
4. 运行 `node learning-coach/dist/index.js` 测试服务器

### 问题 2: "Cannot find module" 错误

**症状：** MCP 服务器启动失败

**解决：**
```bash
cd learning-coach
npm install
npm run build
```

### 问题 3: 进度文件损坏

**症状：** 读取进度时出错

**解决：**
```bash
# 备份当前进度
cp learning-coach/data/progress.json learning-coach/data/progress.backup.json

# 恢复默认进度
cat > learning-coach/data/progress.json << 'EOF'
{
  "currentWeek": 1,
  "startDate": "2026-06-23",
  "weeklyProgress": {
    "week1": {
      "status": "not_started",
      "completedObjectives": [],
      "hoursSpent": 0,
      "notes": [],
      "practiceCompleted": false
    }
  },
  "streakDays": 0,
  "lastActiveDate": ""
}
EOF
```

---

## 🎯 下一步行动

### 今天（15 分钟）
1. ✅ 重启 Claude Code
2. ✅ 测试 Learning Coach 工具
3. ✅ 查看 Week 1 学习计划

### 明天开始
1. 📚 开始 Week 1 的学习（AWS 基础概念）
2. 📝 每天记录学习进度
3. 🔥 保持连续学习天数

### 本周目标
- 完成 Week 1 的 80% 目标（4/5 个目标 + 实践）
- 累计学习 8-10 小时
- 成功创建第一个 Lambda 函数

---

## 📖 更多资源

- **完整文档：** [learning-coach/README.md](README.md)
- **课程大纲：** [learning-coach/src/curriculum.ts](src/curriculum.ts)
- **进度数据：** [learning-coach/data/progress.json](data/progress.json)

---

**准备好了吗？立即重启 Claude Code 并开始你的 AWS 学习之旅！** 🚀
