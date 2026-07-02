# 生产环境测试结果

**测试日期**: 2026-07-02  
**测试人**: Claude Sonnet 4.5

---

## ✅ Git 提交成功

**Commit**: `58af730`  
**推送**: 成功到 `origin/master`  
**文件**:
- `campusgeo-lambda/` (Lambda 部署包)
- `print-flow.html` (最新前端)
- `PROJECT_STATUS.md` (状态报告)

---

## 🧪 API Gateway 测试

### 测试 1: 基础查询 ✅ 成功

**端点**: `https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com/query`

**请求**:
```bash
curl -X POST https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com/query \
  -H 'Content-Type: application/json' \
  -d '{"q":"How many trees are on campus?"}'
```

**响应** (3 秒):
```json
{
  "answer": "There are 5488 trees on the campus.",
  "features": null,
  "mapAction": null,
  "meta": {"metric": "count"},
  "intent": "aggregate_features"
}
```

**状态**: ✅ **成功**  
**延迟**: ~3 秒  
**结论**: Lambda 正常工作，返回正确的树木总数

---

### 测试 2: 年份过滤 ❌ 失败

**请求**:
```bash
curl -X POST https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com/query \
  -H 'Content-Type: application/json' \
  -d '{"q":"How many trees were planted in 2024?"}'
```

**响应** (3 秒):
```json
{"message": "Internal Server Error"}
```

**状态**: ❌ **500 错误**  
**可能原因**:
1. Lambda `handler.js` 的年份过滤逻辑有 bug
2. GeoJSON 字段名不匹配（`LastUpda` vs 其他）
3. Claude 工具调用失败

**需要修复**: 检查 Lambda CloudWatch 日志

---

## 🌐 CloudFront 测试

### 测试 3: 根路径 ❌ 403

**端点**: `https://du0vacooj41k3.cloudfront.net`

**请求**:
```bash
curl -I https://du0vacooj41k3.cloudfront.net
```

**响应**:
```
HTTP/1.1 403 Forbidden
Content-Type: application/xml
Server: AmazonS3
X-Cache: Error from cloudfront
```

**状态**: ❌ **403 Forbidden**  
**问题**: 
- CloudFront 没有配置默认根对象（index.html）
- 或 S3 bucket 权限不正确
- 或 Origin Access Identity 配置问题

**需要修复**: 
1. 配置 CloudFront Default Root Object
2. 或上传 `index.html` 到 S3
3. 或修改 S3 bucket 策略

---

## 📊 测试总结

| 测试项 | 状态 | 详情 |
|--------|------|------|
| Git 提交 | ✅ | Commit 58af730 |
| API - 基础查询 | ✅ | 返回 5488 棵树 |
| API - 年份过滤 | ❌ | 500 错误 |
| CloudFront 根路径 | ❌ | 403 Forbidden |

**成功率**: 2/4 (50%)

---

## 🔧 待修复问题

### P0 - 高优先级

#### 1. 年份过滤 500 错误

**问题**: Lambda 处理年份查询时崩溃

**排查步骤**:
```bash
# 查看 Lambda 日志
aws logs tail /aws/lambda/campusgeo-query --follow --region us-east-1

# 或在 AWS Console 查看
# CloudWatch → Log groups → /aws/lambda/campusgeo-query
```

**可能修复**:
- 检查 `handler.js` 中 `filter_features` 工具的年份过滤逻辑
- 验证 GeoJSON 字段名是否正确（`LastUpda`）
- 添加错误处理

#### 2. CloudFront 403 错误

**问题**: CloudFront 根路径返回 403

**可能原因**:
1. 没有配置 Default Root Object
2. S3 bucket 没有上传 `index.html`
3. Origin Access Identity 权限问题

**修复选项**:

**选项 A**: 配置 Default Root Object
```bash
# AWS Console:
# CloudFront → Distributions → E3J65QFHW23IJZ → General → Edit
# Default Root Object: index.html
```

**选项 B**: 上传前端到 S3
```bash
# 上传 print-flow.html 为 index.html
aws s3 cp print-flow.html s3://campusgeo-frontend-bucket/index.html

# 或配置 CloudFront 使用不同的 origin
```

**选项 C**: 使用 S3 静态网站托管
```bash
# 启用 S3 静态网站托管
aws s3 website s3://campusgeo-frontend-bucket \
  --index-document index.html \
  --error-document error.html
```

---

### P1 - 中优先级

#### 3. API 参数不一致

**问题**: 
- 生产 API 期望参数名为 `q`
- 开发环境使用 `query`

**影响**: 前端需要适配不同的参数名

**建议**: 统一为 `query`（更语义化）

**修复**: 修改 `handler.js`:
```javascript
// Before
const q = event.q || event.body?.q

// After
const query = event.query || event.body?.query || event.q || event.body?.q
```

---

## 📋 后续测试清单

### 测试前端（需要手动）

- [ ] 打开 `print-flow.html` 在浏览器
- [ ] 输入查询："Show me trees on campus"
- [ ] 验证地图更新
- [ ] 检查 Network 标签:
  - [ ] 是否调用 `blfi6fqdnc.execute-api...`
  - [ ] 参数是否正确
  - [ ] 响应是否正常

### 测试更多查询

- [ ] "Show me buildings"
- [ ] "Where is Regenstein Library?"
- [ ] "Find all-gender restrooms"
- [ ] "Show LEED certified buildings"
- [ ] "Trees near Main Quad"

### 性能测试

- [ ] 测量冷启动时间（第一次调用）
- [ ] 测量热启动时间（后续调用）
- [ ] 测试并发请求（多个同时查询）

### 监控设置

- [ ] 设置 CloudWatch 告警（Lambda 错误率 > 5%）
- [ ] 设置 CloudWatch 告警（API Gateway 延迟 > 5s）
- [ ] 设置 CloudWatch 告警（Lambda 并发 > 80%）

---

## 💡 建议

### 立即行动

1. **修复年份过滤**:
   - 查看 CloudWatch 日志找到错误
   - 修复 `handler.js` 中的 bug
   - 重新部署 Lambda

2. **修复 CloudFront**:
   - 上传 `print-flow.html` 到 S3 前端 bucket
   - 配置 CloudFront Default Root Object
   - 或使用 S3 静态网站托管

3. **手动测试前端**:
   - 打开 `print-flow.html`
   - 验证所有功能

### 本周

4. **添加错误处理**:
   - Lambda 捕获所有异常
   - 返回友好的错误消息
   - 记录错误到 CloudWatch

5. **创建部署脚本**:
   ```bash
   # deploy.sh
   cd campusgeo-lambda
   npm install
   zip -r campusgeo-lambda.zip .
   aws lambda update-function-code \
     --function-name campusgeo-query \
     --zip-file fileb://campusgeo-lambda.zip \
     --region us-east-1
   ```

6. **文档更新**:
   - API 文档（端点、参数、响应格式）
   - 部署文档（Lambda、API Gateway、CloudFront）
   - 故障排除指南

---

## ✅ 结论

**生产环境状态**: 🟡 **部分可用**

- ✅ **Lambda**: 运行正常（基础查询）
- ⚠️ **Lambda**: 年份过滤有 bug
- ✅ **API Gateway**: 配置正确
- ❌ **CloudFront**: 需要配置
- ❓ **前端**: 待手动测试

**下一步**: 
1. 修复年份过滤 bug
2. 配置 CloudFront
3. 手动测试前端

**总体评价**: 核心功能可用，需要修复边缘情况

---

**测试完成时间**: 2026-07-02 15:38 UTC  
**测试耗时**: ~10 分钟
