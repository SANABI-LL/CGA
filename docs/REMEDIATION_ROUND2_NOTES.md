# 安全整改 Round 2 — 大白话说明与项目状态

> 日期：2026-07-15 ｜ 对应提交：`0252b3d` ｜ 生产 Lambda：`campusgeo-query`（已部署并验证）

## 一、IT 在担心什么

**第一轮的担忧（已解决）：房子没锁门。**

- API 谁都能调用——陌生人可以随意消耗 Bedrock 账单，或把服务当免费算力用。
- 数据桶整个对公网开放，而里面不只是树和食堂，还有**地下管网图层**：可步行隧道、蒸汽管线、电力管道、ComEd 电缆井位置。这类设施信息公开是真正的安全隐患。
- 代码里写死了 AWS 账号 ID。

**第二轮的担忧（本次）：修锁的时候把门修歪了。**

- 上次 AI 辅助改代码时，AI **想当然地编造了一批字段名**（`BLDG_NAME`、`BLDG_NUM` 等——听起来合理，但数据里根本没有这些列），导致"查建筑"永远返回空。
- 更糟的是：查不到数据时，模型**凭记忆编造答案，且表现得像刚查出来的真实数据**。用户完全无法分辨——这比查询失败本身危险得多。
- 一批次要问题：报错会把内部细节（Zod 校验详情、S3 key）吐给外部；`__proto__`/`constructor` 这类输入会让工具返回错误结果或虚构结果；回答过长时 `done` 信号被截断闩锁吞掉，前端永远转圈。
- 警告：**CloudFront 保持禁用**——其默认行为仍是"把整个数据桶端出去"，一开启管网/隧道图层就会重新公开。必须先把 default behavior 改为仅服务 `/api/*`（或摘掉 S3 origin）。

## 二、怎么修的

1. **字段名全部对照真实数据重写**。`getBuildingInfo` 改为跨真实名称列匹配（`DISCRIPT1` / `OtherNames` / `Facility_Name` / `DISCRIPT2`），建筑代码走 `BD_ID` / `Building_Code` 精确匹配；输出映射到 `Year_Completed` / `Year_Opened`、`Gross_Area__s_f__`、`BLDG_HGT`，并恢复 `Architects` / `Heritage` / `Notes`。工具描述与字段允许列表同步清理（删除全部虚构字段）。前端 `useArcGISLayer` 的 outFields 同样已对照线上图层 schema 修正。
2. **每个工具配一条功能测试**（vitest，共 22 条，`backend/lambdas/ai-agent/tests/`）。buildings/trees/dining 直接以仓库内真实 GDB 转换产物作为 S3 夹具——以后再用不存在的字段，测试几秒内就红。运行：`pnpm --filter @campusgeo/ai-agent test`（离线可跑，无需 AWS）。
3. **报错对外只留通用文案**，细节进 CloudWatch/本地日志。
4. **五处名称字典改为 `Map`**，原型链键（`__proto__`、`constructor`）整类失效；补齐输入净化与短输入守卫。
5. **截断闩锁放行终止事件**：`done` / `citation_warning` / `error` 永远送达，前端不再卡死。
6. **引用校验改为"答案含引用即校验"**：模型凭记忆编造的文档页码引用会触发 `citation_warning`（legacy `/query` 路径也会在 JSON 响应中携带）。
7. **已部署并线上实测**：匿名与错误 key 均 403；"Show me Regenstein Library" 返回真实图层数据（1970 年、604,949 sq ft、SOM——均与源数据一致）；建筑代码查询（C03）命中同一建筑。部署前的旧代码备份在 `backend/lambdas/ai-agent/dist-deploy/backup-pre-round2-20260715.zip`。

## 三、项目当前状态

| 部分 | 状态 |
|---|---|
| 后端 API | ✅ 私有（需 API key）、最新修复已部署、预留并发 5 防滥用 |
| 数据 | ✅ 全部在私有 S3 桶（5 个基础图层 + 21 个管网图层），公网访问关闭 |
| 测试 | ✅ 22 条自动化测试，离线可跑 |
| 前端 | ⚠️ 无线上版本，仅本机 `pnpm dev`（可直连生产 API 交互） |
| CloudFront | 🔒 禁用中，待与 IT 重新配置 default behavior |
| 遗留 | P2 低风险项（见 IT 指南）+ 可选的"去 ESRI 化"（移除 query_arcgis_layer 对 ESRI 服务器的依赖） |

一句话：**后端"私有但完全可用"，前端"能用但只在本机"。**

## 四、日常开发与前端交互测试

**方式 B — 本地前端直连生产 API**（体验/验收用）：`apps/web/.env.local` 设 `VITE_API_URL=<API Gateway 端点>` 与 `VITE_API_SECRET=<key>`，然后 `pnpm dev` 开 5173。注意生产为 `BUFFERED=1`，回答整段到达而非逐字流式。`VITE_API_SECRET` 只能留在 `.env.local`（已 gitignore）——**带着它 build 的产物绝不能托管**（`VITE_` 前缀会打进 JS bundle）。

**方式 A — 全本地链路**（改后端代码时用）：终端 1 以 SSO 凭证启动 `pnpm dev:server`（环境变量可从 Lambda 配置拉取，不落盘），终端 2 `pnpm dev`，`.env.local` 的 `VITE_API_URL` 指回 `http://localhost:3001`。改 `tools/` 代码即时生效，且为真流式。

## 五、今后前端更新如何部署到 AWS

**当前还不能发布到公网**，卡在两件事：

1. **CloudFront 配置**（与 IT 协作）：新建独立的**前端专用 bucket**（只放 build 产物，与数据桶彻底分开），CloudFront default behavior 指向它（OAC 私有访问），`/api/*` 转发 API Gateway；数据桶从 CloudFront 摘除。
2. **鉴权方案**：公开托管前需解决"共享密钥打进 JS"的问题——正解是路线图 Phase 2 的登录（Google OAuth 验证 uchicago.edu + 后端发 token），过渡期可用邀请制限制。

CloudFront 修好后，日常更新固定三步：

```powershell
pnpm build                                                              # 1. 打包前端
aws s3 sync apps/web/dist s3://<前端桶> --delete --profile SOLSTICE     # 2. 上传
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*" # 3. 刷新缓存
```

（仓库现有 `deploy-ui.ps1` 为旧的单 HTML 流程，届时按新架构改造。）

过渡期：改前端 → 本机 5173 看效果（连生产 API，数据与交互均为真实）→ 满意即 git 提交。

---

*本文档由 Round 2 整改工作整理生成；技术细节见 `DEV_REMEDIATION_GUIDE_ROUND2.md`（IT 提供）与提交 `0252b3d`。*
