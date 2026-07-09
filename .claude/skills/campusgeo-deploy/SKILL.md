---
name: campusgeo-deploy
description: 部署 CampusGeo 前后端到生产环境(Lambda esbuild 打包、print-flow.html 上传、CloudFront 缓存失效、四处副本同步、分层验证)。当要部署、上线、更新前端或后端、修改 agent 工具后发布时使用。
---

# CampusGeo 生产部署流程

## 生产架构(2026-07 现状,先读懂再动手)

```
用户 → https://du0vacooj41k3.cloudfront.net/ (分发 E3J65QFHW23IJZ, 根对象=print-flow.html)
  ├─ 静态: S3 campusgeo-geodata-491117467175 根部 (print-flow.html 是唯一正式前端)
  └─ /api/* → API Gateway blfi6fqdnc → Lambda campusgeo-query (缓冲模式 BUFFERED=1)
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
`GEOJSON_BUCKET / GEODATA_BUCKET / EMBED_MODEL_ID / BEDROCK_MODEL_ID / BEDROCK_REGION=us-east-2 / BUFFERED=1`

## 前端部署(改了 print-flow.html 之后)

1. **改动方式**:对当前线上版本做锚点式补丁(python 脚本,`assert count==1` 防锚点漂移),永远不要整页重写
2. **JSX 语法校验(唯一防线,不可省)**:抽出 `<script type="text/babel">` 内容,用
   `node_modules/.pnpm/esbuild@*/node_modules/@esbuild/win32-x64/esbuild.exe file.jsx --outfile=check.js` 编译,报错即中止
3. 上传:`aws s3 cp <file> s3://campusgeo-geodata-491117467175/print-flow.html --content-type "text/html" --cache-control "no-cache"`
4. 失效缓存:`aws cloudfront create-invalidation --distribution-id E3J65QFHW23IJZ --paths "/*"`(路径 `/` 不合法,用 `/*`)
5. **同步四处仓库副本**(以线上为准的纪律):根目录、`ui_kits/campusgeo/`、`design/ui_kits/campusgeo/`、`design_handoff_campusgeo_agent/` 的 print-flow.html 全部覆盖为部署版

## 分层验证(出问题时逐层隔离)

1. 直连 API Gateway:`curl -X POST https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com/query -d '{"q":"..."}'`(旧契约,一次性 JSON)
2. 经 CloudFront:`curl -X POST https://du0vacooj41k3.cloudfront.net/api/agent -d '{"query":"..."}'`(SSE 文本,缓冲一次到达)
3. 浏览器 Ctrl+Shift+R 硬刷新;F12 Network 确认 /query POST 200(走 fallback = 没连上 API)
4. 回归三件套:FAR 问题(文字视图)、utilities near Cobb Hall(方框裁剪+图例)、how many trees(全量计数)

## 铁律(每条都对应一次生产事故)

- **模型永远不收全量几何**:大要素工具必须返回 `_modelSummary`(模型读摘要,地图经 mapUpdate 收全量);曾发生 5491 棵树 290 万 token 爆上下文
- **载荷上限按几何类型分级**:点要素 6000、线/面 300(mapCapFor);多工具合并按 4.5MB 字节预算轮流取——统一低上限会误伤点要素("只显示 300 棵树"),不轮流会整体切掉靠后的系统
- **工具描述只写能力不写数据**:硬编码"539 trees"曾让模型照抄旧数字拒调工具
- **字段名新旧兼容**:S3 数据 schema 与代码期望曾脱节(Common_Nam vs CommonName)导致过滤恒空且无报错;读属性一律走候选字段列表(firstString 模式)
- **权限墙绕行手册**:建不了 IAM → 桶策略(资源侧,同账号单边生效)/ 应用推理配置文件;SCP 封 Function URL → 只能走 API Gateway;详见 memory production-architecture
- **Claude Design 的文件永远不能直接上传**:其底稿可能过期,直传会回滚权威版功能;只做增量移植
- API Gateway 集成超时 30s 硬上限,超长 agent 查询会 504(已知残留风险)
