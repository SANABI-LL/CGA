# 内测分享：邮箱登录 + 测试/正式环境分离

**状态：** IT 已放行（2026-11-10 邮件，Information Assurance 无额外审核要求；限流留到 Phase 2）。
**范围：** 5–10 名内部员工，`@uchicago.edu` 邮箱。
**登录方式：** Amazon Cognito 自带的邮箱登录，全部在 AWS 内完成，不需要 IT 做 SAML 登记。学校 SSO 作为日后升级项（见文末）。

本文件取代 `PLAN-sharing-tier2-sso.md`。

---

## 1. 目标形态

```
同事浏览器 ─▶ CloudFront（网站，固定网址）
     │  未登录 → 跳转 Cognito 登录页 → 登录后带回短期令牌（60 分钟）
     └─ 提问 ─▶ 正式 API（网关先验令牌）─▶ campusgeo-query:prod ─▶ Bedrock / S3

Claude Design 预览 ─▶ 测试 API（X-Api-Key）─▶ campusgeo-query:staging ─▶ Bedrock / S3
```

- 正式网站的页面里没有任何密钥。只有链接、没有账号，什么也看不到。
- 账号只能由管理员创建，不开放自助注册。**Cognito 的用户列表就是白名单**，不需要另外的白名单文件。
- 链接被转发没有用：对方没有账号，登录不了。
- 每条请求带登录人的邮箱，日志能查到是谁问的。

## 2. 同事的使用过程

1. Linyu 在 Cognito 控制台添加同事的邮箱。
2. 同事收到一封邀请信，里面有网址和临时密码（7 天内有效）。
3. 首次登录时设置自己的密码，之后用邮箱 + 密码登录。

## 3. 后端任务（Claude Code；先进 git，再部署）

### 3.1 Cognito User Pool
- 登录名为邮箱；**关闭自助注册**（`AllowAdminCreateUserOnly = true`）。
- 密码策略：至少 12 位。邀请信模板里写上正式网址。
- App client：公开客户端，Authorization Code + PKCE，不设 client secret。
- 开启 Hosted UI 域名。回调地址和登出地址：CloudFront 网址、`http://localhost:5173`。
- 令牌有效期：ID / access token 60 分钟；refresh token 7 天。

### 3.2 两套 API，同一个 Lambda

Lambda 的环境变量不能按别名区分（发布版本时会连同环境变量一起冻结），而 HTTP API 的 CORS 是按 API 配置的。所以用两个 API 来区分环境，不依赖环境变量：

| | 测试环境 | 正式环境 |
|---|---|---|
| API | 现有的 `campusgeo-api` | 新建 `campusgeo-api-prod` |
| 指向的 Lambda 别名 | `staging`（指向 `$LATEST`） | `prod`（指向已发布的版本号） |
| 鉴权 | `X-Api-Key`（换一个新值） | Cognito JWT authorizer，挂在全部路由上 |
| CORS 允许来源 | Claude Design 预览域名、localhost | 仅 CloudFront 域名 |
| CORS 允许请求头 | `Content-Type, X-Api-Key` | `Content-Type, Authorization` |
| 谁在用 | Claude Design 预览、本地开发 | 同事的网站 |
| 何时更新 | 随时 | 回归问题集通过后 |

- 正式 API 的路由与现有的一致：`POST /api/agent`、`GET /api/plans/index`、`GET /api/plans/{bdId}/{file}`。
- JWT authorizer：issuer 为用户池地址，audience 为 App client ID。前端发送的是 **ID token**（里面有 `email`）。如果后端更想用 access token，请告知前端。
- 数据桶暂时共用。数据管线（平面图、图层）的改动同样先在测试环境验证。

### 3.3 handler 的鉴权逻辑
```ts
const claims = event.requestContext.authorizer?.jwt?.claims
if (claims) {
  // 正式 API：网关已验证令牌。记录是谁在问。
  user = String(claims.email)
} else {
  // 测试 API：沿用 X-Api-Key 校验。
  if (!apiKeyMatches(event)) return json(403, { error: 'Forbidden' })
  user = 'staging'
}
```
- 每条请求的日志带上 `user` 和 request id。
- 现有的 `API_SECRET` 一直内联在页面里，必须换新值。新值只放在 Claude Design 项目的 `backend-config.local.js` 里，不进入发布给同事的文件。
- 更新环境变量时带上全部变量（`update-function-configuration --environment` 是整体替换）。

### 3.4 网站托管
- 私有 S3 桶 + CloudFront（Origin Access Control），默认根对象为 `index.html`。
- 每次发布保留上一版 HTML，便于回滚。

### 3.5 账单与告警
- AWS Budgets 设月度预算提醒。
- CloudWatch 告警：`prod` 别名出现 5xx 或 Lambda 错误时发邮件给 Linyu。
- 限流按 IT 意见放到 Phase 2。

### 3.6 交给前端的值
- Cognito Hosted UI 域名
- App client ID
- 正式 API 地址
- CloudFront 网址（即回调地址）
- 测试 API 的新 `X-Api-Key`（私下给，不要写进文档）

### 可能的卡点
SSO 权限策略之前拦过 `iam:PassRole`。建 Cognito、CloudFront、新 API 以及给 Lambda 加调用权限（`lambda:AddPermission`）都可能被拦。被拦就请 AWS 账号管理员代建。如果新建 API 行不通，退路是在现有 API 上建两个阶段，用 stage variables 区分别名和鉴权方式。

## 4. 前端任务（在 Claude Design 项目里做）

拿到 3.6 的值后开始：

1. 新增登录层 `auth.js`，在 fetch 层工作，页面代码不动。配置里有 `auth` 时启用：
   ```js
   // 发布给同事的配置，不含任何密钥
   window.CAMPUSGEO_CONFIG = {
     apiBase: 'https://<prod-api>',
     auth: { domain: '<hosted-ui-domain>', clientId: '<app-client-id>', redirectUri: 'https://<cloudfront>/' },
   }
   ```
   - 未登录：跳转 Cognito 登录页（PKCE）。
   - 回调：用 code 换令牌，存 `sessionStorage`。
   - 每个后端请求带 `Authorization: Bearer <id token>`。
   - 令牌过期：用 refresh token 续期，失败则重新登录。
   - 后端返回 401：清掉令牌，重新登录。
2. 页眉显示登录人邮箱和退出按钮。
3. 两个状态页：登录中；登录失败或会话过期。
4. 健康检查：正式环境下把 "API key" 一行换成 "Sign-in"。
5. Claude Design 预览继续用 `backend-config.local.js`（测试 API + 新的 key），不走登录。
6. 导出 standalone HTML 时只带正式配置，不带 `backend-config.local.js`。

## 5. 发布流程（每次更新都按这个顺序）

1. 在 Claude Design 改前端；后端改动进 git，部署到 `staging`。
2. 在测试页跑一遍回归问题集，全部通过才继续。
3. 发布后端：给 Lambda 发布一个新版本号，把 `prod` 别名指过去。
4. 发布前端：导出 standalone HTML，上传到 S3 替换旧文件，刷新 CloudFront 缓存。
5. 用自己的账号打开正式网址，抽查两三个问题。
6. 同事刷新页面即可看到新版。

两条规则：
- **先发后端，再发前端。** 前后端之间的接口有变化时（例如新增字段），后端必须对旧前端保持兼容。
- **出问题先回滚，再排查。** 后端：把 `prod` 别名指回上一个版本号。前端：把上一版 HTML 重新上传。每次发布记下版本号和日期。

## 6. 管理用户

- **加人：** Cognito 控制台 → Users → Create user，填邮箱，选择发送邀请信。只添加 `@uchicago.edu` 邮箱。
- **删人：** 禁用或删除该用户。已签发的令牌最长 60 分钟后失效。
- **临时密码过期：** 在控制台重新发送邀请。
- **有人离职：** 账号不会自动失效，需要手动删除。

## 7. 上线前自测清单

- 未登录打开正式网址 → 跳到 Cognito 登录页
- 登录页上没有"注册"入口
- 已添加的账号 → 提问、地图、平面图、导出 PDF 正常
- 不带令牌 curl 正式 API 的 `/api/agent` 和 `/api/plans/index` → 401
- 用旧的 `API_SECRET` 请求测试 API → 403
- 正式网站的页面源码和网络请求里搜不到任何密钥
- 来自 Claude Design 预览域名的请求被正式 API 的 CORS 拒绝
- 在 `staging` 部署一次改动后，正式网站行为不变
- CloudWatch 日志里能看到提问人的邮箱
- 删除一个测试账号后，该账号无法再登录

## 8. 给 IT 的备案（建议发一句）

IT 放行所依据的整改说明如果写的是"学校 SSO"，改用邮箱登录最好告知一声：

> For the pilot we will use Amazon Cognito sign-in with administrator-created accounts (self sign-up disabled, @uchicago.edu addresses only), and move to University SSO in a later phase. The page carries no shared key, and every request is tied to a signed-in user.

## 9. 日后升级到学校 SSO

同一个 Cognito 用户池可以直接加学校 Shibboleth 作为 SAML 登录方式，前端和 API 都不用改。

- 需要 IT 把 CampusGeo 登记为 SAML 应用。我们提供 Cognito 的 Entity ID 和 ACS 地址，IT 提供 IdP metadata 地址。需要的属性：邮箱、CNetID、姓名。
- SSO 下任何学校账号都能完成登录，所以届时要加回白名单检查（Cognito 的 pre-sign-up 触发器，或在 Lambda 里对照名单）。
- 好处：同事不用另记密码；离职后账号自动失效。
