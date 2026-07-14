---
name: campusgeo-deploy
description: 部署 CampusGeo 后端到生产环境(Lambda esbuild 打包、分层验证)。当要部署、上线、更新后端、修改 agent 工具后发布时使用。前端开发期不公开托管(IT 安全要求 2026-07)。
---

# CampusGeo 生产部署流程

> **⚠️ 安全状态(2026-07-14)**:IT 安全审查后开发环境已被账户级临时禁用。恢复前提:
> Lambda 配置 `API_SECRET`(共享密钥门禁,handler 已实现,未配置则一律 403)、
> `GEOJSON_BUCKET`(代码已去除硬编码兜底,不配置则查询报错)、`ALLOWED_ORIGIN`。
> **前端(print-flow.html)在开发期不再公开托管** —— 不上传 S3、不经 CloudFront 分发;
> 本地开发用 `pnpm dev`(apps/web)或本地打开 print-flow.html。恢复公开上线需先由 IT
> 在 CloudFront 边缘配置 Basic Auth(CloudFront Function),再恢复本文件的前端部署段
> (见 git 历史 2026-07-14 之前版本)。

## 生产架构(2026-07 现状,先读懂再动手)

```
用户 → https://du0vacooj41k3.cloudfront.net/ (分发 E3J65QFHW23IJZ; 前端已下线,根对象待清理)
  └─ /api/* → API Gateway blfi6fqdnc → Lambda campusgeo-query (缓冲模式 BUFFERED=1, 需 x-api-key)
       后端源码 = backend/lambdas/ai-agent/ (TypeScript)。campusgeo-lambda/ 是已退役旧版,勿动勿部署!
```

凭证:`AWS_PROFILE=SOLSTICE`(SSO,token 常过期 → `aws sso login --profile SOLSTICE`,需用户浏览器授权)。

## 后端部署(改了 agent.ts / tools / handler / digest 之后)

```bash
cd backend/lambdas/ai-agent
pnpm --filter @campusgeo/ai-agent exec tsc --noEmit   # 必过
pnpm dlx esbuild handler.ts --bundle --platform=node --target=node20 --format=esm \
  --outfile=dist/index.mjs --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
cd dist && powershell -Command "Compress-Archive -Path index.mjs -DestinationPath lambda.zip -Force"
aws lambda update-function-code --function-name campusgeo-query --zip-file fileb://lambda.zip
aws lambda wait function-updated --function-name campusgeo-query
```

环境变量(update-function-configuration 时必须整组带全,漏一个就丢配置):
`GEOJSON_BUCKET / GEODATA_BUCKET / EMBED_MODEL_ID / BEDROCK_MODEL_ID / BEDROCK_REGION=us-east-2 / BUFFERED=1 / API_SECRET / ALLOWED_ORIGIN`

## 前端部署 —— 已停用(IT 安全要求,2026-07)

**不要把 print-flow.html 或任何原型文件(`*.jsx`、prototype HTML)上传到 S3 / CloudFront。**
开发期前端只在本地运行。仓库内四处 print-flow.html 副本(根目录、`ui_kits/campusgeo/`、
`design/ui_kits/campusgeo/`、`design_handoff_campusgeo_agent/`)以**根目录为权威副本**互相同步。
改动 print-flow.html 时仍须做 JSX 语法校验:抽出 `<script type="text/babel">` 内容,用
`node_modules/.pnpm/esbuild@*/node_modules/@esbuild/win32-x64/esbuild.exe file.jsx --outfile=check.js` 编译,报错即中止。

## 分层验证(出问题时逐层隔离)

1. 直连 API Gateway(需密钥):`curl -X POST https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com/query -H "x-api-key: $API_SECRET" -d '{"q":"..."}'`(旧契约,一次性 JSON);**无 x-api-key 应得 403**
2. 经 CloudFront:`curl -X POST https://du0vacooj41k3.cloudfront.net/api/agent -H "x-api-key: $API_SECRET" -d '{"query":"..."}'`(SSE 文本,缓冲一次到达)
3. 本地前端:`pnpm dev` + `pnpm dev:server`,`.env.local` 配 `VITE_API_URL` 与(打到远端时)`VITE_API_SECRET`
4. 回归三件套:FAR 问题(文字视图)、utilities near Cobb Hall(方框裁剪+图例)、how many trees(全量计数)

## 铁律(每条都对应一次生产事故)

- **模型永远不收全量几何**:大要素工具必须返回 `_modelSummary`(模型读摘要,地图经 mapUpdate 收全量);曾发生 5491 棵树 290 万 token 爆上下文
- **载荷上限按几何类型分级**:点要素 6000、线/面 300(mapCapFor);多工具合并按 4.5MB 字节预算轮流取——统一低上限会误伤点要素("只显示 300 棵树"),不轮流会整体切掉靠后的系统
- **工具描述只写能力不写数据**:硬编码"539 trees"曾让模型照抄旧数字拒调工具
- **字段名新旧兼容**:S3 数据 schema 与代码期望曾脱节(Common_Nam vs CommonName)导致过滤恒空且无报错;读属性一律走候选字段列表(firstString 模式)
- **权限墙绕行手册**:建不了 IAM → 桶策略(资源侧,同账号单边生效)/ 应用推理配置文件;SCP 封 Function URL → 只能走 API Gateway;详见 memory production-architecture
- **Claude Design 的文件永远不能直接上传**:其底稿可能过期,直传会回滚权威版功能;只做增量移植
- API Gateway 集成超时 30s 硬上限,超长 agent 查询会 504(已知残留风险)
