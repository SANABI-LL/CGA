# CampusGeo 前端测试指南

**最后更新**: 2026-06-25

本文档说明如何测试最新的 React 前端与 S3 + Lambda 后端的连通性。

---

## 🎯 目标

验证以下数据流：

```
用户浏览器 (React 应用)
    ↓ 查询："How many trees?"
后端 API (localhost:3001)
    ↓ Claude AI 决定调用工具
Lambda queryTrees 工具
    ↓ 读取 S3
s3://campusgeo-geodata-491117467175/layers/trees.geojson
    ↓ 返回 5488 棵树的 GeoJSON
前端地图
    ↓ 渲染金色标记
```

---

## 📋 前置条件

### 1. 后端运行中

```bash
# Terminal 1
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent\backend\dev-server"
pnpm dev

# 应该看到：
# CampusGeo dev server listening at http://localhost:3001
```

### 2. 前端配置正确

文件：`apps/web/.env.local`
```bash
VITE_API_URL=http://localhost:3001
```

✅ **已创建此文件**

---

## 🚀 启动前端

### 方式 1：React 开发服务器（推荐）

```bash
# Terminal 2
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent\apps\web"
pnpm dev

# 应该看到：
# ➜  Local:   http://localhost:5173/
# ➜  Network: use --host to expose
```

**访问**: http://localhost:5173

### 方式 2：静态测试页面

直接在浏览器打开：
```
file:///C:/Users/linyuliu89/Dropbox/Academy/Claude%20Code/GIS%20Agent/test-frontend.html
```

⚠️ **注意**：`CampusGeo Print-a-Map.html` 是**静态原型**，没有后端连接代码，无法测试 S3/Lambda。

---

## 🧪 测试步骤

### 1. 打开前端

浏览器访问：http://localhost:5173

### 2. 查看界面

应该看到：
- **左侧边栏**：搜索框 + 图层面板
- **右侧地图**：ArcGIS 地图视图
- **顶部**：CampusGeo logo

### 3. 输入查询

在搜索框输入：
```
How many trees are on campus?
```

按回车或点击搜索按钮。

### 4. 观察响应

**预期行为**：

1. **Loading 状态**：显示"查询中..."或加载动画
2. **工具调用通知**：Console 应显示：
   ```
   [CampusGeo AI] Tool: query_trees
   ```
3. **地图更新**：地图上出现金色标记（5488 个树木位置）
4. **AI 回答面板**：显示类似：
   ```
   Based on the tree inventory data, there are 5,488 trees documented
   on campus...
   ```

### 5. 验证数据

打开浏览器开发者工具（F12）：

**Console 标签**：
```javascript
[CampusGeo AI] Query: How many trees are on campus?
[CampusGeo AI] Event: tool_call {toolName: "query_trees"}
[CampusGeo AI] Event: tool_result {mapUpdate: {...}}
[CampusGeo AI] Map update: 5488 features
[CampusGeo AI] Query complete
```

**Network 标签**：
- 应该看到：`POST http://localhost:3001/api/agent`
- Status: `200 OK`
- Type: `text/event-stream`

---

## ✅ 成功标准

| 检查项 | 状态 |
|--------|------|
| 前端加载正常（无 React 错误） | ⬜ |
| 搜索框可用 | ⬜ |
| 查询发送到后端（Network 请求成功） | ⬜ |
| SSE 流式响应正常（多个 `data:` 事件） | ⬜ |
| Console 显示 `tool_call` 和 `tool_result` | ⬜ |
| 地图显示标记（金色点） | ⬜ |
| AI 回答显示在面板中 | ⬜ |
| 回答内容正确（5488 棵树） | ⬜ |

**全部 ✓ = 前后端连通性验证成功！**

---

## 🐛 常见问题

### 问题 1：前端启动失败

```
Error: Cannot find module '@campusgeo/...'
```

**解决**：
```bash
# 回到项目根目录重新安装
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent"
pnpm install
```

### 问题 2：CORS 错误

```
Access to fetch at 'http://localhost:3001' from origin 'http://localhost:5173'
has been blocked by CORS
```

**解决**：检查后端 `dev-server/server.ts` 是否设置了 CORS：
```typescript
'Access-Control-Allow-Origin': '*'
```

✅ **已配置**（默认允许所有来源）

### 问题 3：API 请求 404

```
POST http://localhost:3001/api/agent -> 404 Not Found
```

**解决**：
1. 确认后端运行：`curl http://localhost:3001/health`
2. 检查 `.env.local` 中的 `VITE_API_URL`

### 问题 4：地图不显示标记

**可能原因**：
- GeoJSON 返回了但地图渲染失败
- ArcGIS API 未加载完成

**调试**：
```javascript
// 在 Console 输入
window.mapView  // 应该返回 ArcGIS MapView 实例
```

### 问题 5：S3 读取失败

```
tool_result: {"error": "The bucket you are attempting to access..."}
```

**解决**：已修复（queryTrees.ts 已更新 S3 配置）

---

## 📊 测试查询示例

### 基础查询

```
How many trees?
Show me buildings
Where is Regenstein Library?
```

### 过滤查询

```
Show me maple trees
Find mature oak trees
Which trees are in poor condition?
```

### 位置查询

```
Show trees near Main Quad
Buildings around Harper Library
```

### 其他图层

```
Where are all-gender restrooms?
Show LEED certified buildings
Find bike racks
```

---

## 🔧 开发调试

### 查看前端日志

```bash
# Terminal 2 (pnpm dev 运行的窗口)
# 应该看到 Vite 的实时日志
```

### 查看后端日志

```bash
# Terminal 1 (pnpm dev 运行的窗口)
# 每个查询应该输出：
# [agent] User query: How many trees?
# [agent] Tool call: query_trees
# [agent] Tool result: {...}
```

### 查看 S3 数据

```bash
# 下载查看
aws s3 cp s3://campusgeo-geodata-491117467175/layers/trees.geojson /tmp/trees.geojson --region us-east-1

# 统计特征数
cat /tmp/trees.geojson | python -c "import sys, json; print(len(json.load(sys.stdin)['features']))"
# 输出: 5488
```

---

## 📁 相关文件

| 文件 | 用途 |
|------|------|
| [apps/web/.env.local](apps/web/.env.local) | 前端 API 配置 |
| [apps/web/src/api/agent.ts](apps/web/src/api/agent.ts) | SSE 客户端 |
| [apps/web/src/components/search/QueryBar.tsx](apps/web/src/components/search/QueryBar.tsx) | 搜索框组件 |
| [apps/web/src/components/map/MapView.tsx](apps/web/src/components/map/MapView.tsx) | 地图渲染 |
| [backend/dev-server/server.ts](backend/dev-server/server.ts) | 后端开发服务器 |
| [backend/lambdas/ai-agent/tools/campus/queryTrees.ts](backend/lambdas/ai-agent/tools/campus/queryTrees.ts) | S3 读取工具 |
| [test-frontend.html](test-frontend.html) | 简单测试页面 |

---

## ✅ 下一步

测试成功后：

1. **创建新工具**：为 `all-gender-restrooms.geojson` 和 `leed-buildings.geojson` 创建查询工具
2. **部署到 AWS**：Phase 1 完成后部署到生产环境
3. **添加认证**：Phase 2 集成 Cognito User Pools

---

**测试愉快！如有问题请查看上面的故障排除部分。**
