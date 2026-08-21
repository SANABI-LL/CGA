# CampusGeo 开发流程 Skill

Claude Code 与 Claude Design 的分工与切换方式。基于 CampusGeo 项目 2026-08 的实际经验总结。

---

## 四步循环

### 第 1 步 — Claude Code：跑通功能
- 定位需求、写工具（tools）、接 Bedrock、验证数据能从 S3 取出来
- 前端只做能点通的最简原型，不投入任何视觉成本
- **本步的产出物不是界面，是契约**：SSE 事件类型、`mapUpdate` 的结构、每个工具返回的字段名。写进 `docs/FRONTEND_INTEGRATION.md`

### 第 2 步 — Claude Design：建前端界面
不要把原型 HTML 导出过来"优化"——那些结构是为跑通逻辑写的，改它比重写慢。正确做法：

- 把契约给 Design（repo 链接即可，Design 能直接读 `docs/FRONTEND_INTEGRATION.md`、`handler.ts`、`agent.ts`、各 `tools/campus/*.ts`）
- 原型 HTML 只作参考，用途是说明"这些功能要有"
- Design 从设计系统重新搭界面，视觉决策依据本项目根目录的 `CLAUDE.md`

### 第 3 步 — 接通后端并调试
在 Design 里直连真实 Lambda，这是最有价值的一步：能看到浏览器**真正收到了什么**。

分工按"层"划，不按"bug"划：
- 数据、过滤逻辑、AI 回答内容、工具定义 → Claude Code
- 布局、交互、地图渲染样式、打印排版 → Claude Design

**反直觉但重要**：bug 先拿到 Design 定位往往更快，定位完拿结论去 Code 修。实例：
- "1930 年前建筑"返回全部建筑 → Design 查出 `parseFloat(x || '0')` 让缺失年份变成 0，`0 < 1930` 恒真
- 地图空白 → Design 查出 `mapUpdate.features` 是裸数组而非 FeatureCollection
- Internal error → Design 定位到 `queryS3Layer` 的 fail-open 分支抛异常

### 第 4 步 — 回流（最容易被忽略）
Design 产出的是独立 HTML，**不会自动变成 repo 里的 React 组件**。不做这一步，两边就在分叉。三种处理方式，按项目性质选：

| 方式 | 适用 |
|---|---|
| 直接用打包的独立 HTML | 演示、内部分享 |
| 让 Claude Code 照 Design 实现重写 `apps/web` 组件 | 要长期维护的产品 |
| 只把 Design 当设计探索，定稿后一次性搬过去 | 视觉还在反复的阶段 |

选第二种时，让 Design 先生成一份交接文档（配色 token、间距、交互状态、地图图层配置、打印排版参数）。

---

## Claude Design 的能力边界

**能做**：读 GitHub 仓库、直连后端 API 调试、在浏览器里看到真实响应、诊断前后端问题、打包独立 HTML

**不能做**：
- push 到 GitHub（只读）
- 跑你们的 build
- 看 CloudWatch 日志
- 跑 WebGL —— 预览沙箱屏蔽了 MapLibre 的 worker，**所有地图相关效果必须由你在真实浏览器里确认一次**

---

## 安全约束（不可违反）

- `backend-config.local.js` 含明文 API key，**永不进 git**
- 打包产物（`CampusGeo Landing.html`）内联了同一个 key，**不进公开仓库**
- CORS 白名单只拦浏览器跨域，拦不住 curl；真正的门禁是 `API_SECRET`（fail-closed）
- 需要新增可访问来源时，**追加白名单条目**，不要放开成 `*`（依据 `docs/worklog/2026-07-15.md` 的收紧决定）
- 图层原始列（`FCI` / `RI` / `RICOST` / `F2026`–`F2035` 成本预测）不应下发到浏览器，新工具要像 `getBuildingInfo.ts` 的 `pickBuildingProps` 一样做白名单

---

## 每轮切换的检查清单

**Code → Design 时带上**：改动了哪些工具、新增/变更的字段名、`features` 的确切结构（FeatureCollection 还是数组）

**Design → Code 时带上**：定位到的根因（文件 + 行为）、期望的返回结构、需要后端配合的改动说明（Design 会写成 md 文件，如 `bug-year-filter.md`、`lambda-cors-patch.md`）

**每次 Design 改完地图相关功能后**：自己在浏览器点一次，确认渲染正常
