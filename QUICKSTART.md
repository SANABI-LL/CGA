# CampusGeo Phase 1 快速开始指南

本指南帮助你完成 Phase 1 剩余任务：数据架构重构（ArcGIS → S3 自托管）。

## 当前进度 ✓

- [x] **Step 1**: 创建 `core_layers.json`（11 个核心图层配置）
- [x] **Step 5**: 修改 `convert_gdb.py` 支持元数据生成
- [x] **Step 6**: 生成 `layers_metadata.json`（DynamoDB 元数据）
- [x] **Step 7**: 生成 `dynamodb_batch_import.json`（DynamoDB 导入格式）

## 下一步：AWS 配置与部署

### Step 2: 安装 AWS CLI 和 CDK（约 15 分钟）

#### 2.1 安装 AWS CLI v2

下载并安装 Windows MSI 安装包：
```
https://awscli.amazonaws.com/AWSCLIV2.msi
```

验证安装：
```bash
aws --version
# 应输出：aws-cli/2.x.x ...
```

#### 2.2 配置 AWS Credentials

运行配置向导：
```bash
aws configure
```

输入以下信息：
- **AWS Access Key ID**: 从 AWS IAM 控制台获取
- **AWS Secret Access Key**: 与 Access Key 一起生成
- **Default region name**: `us-east-1`（推荐）
- **Default output format**: `json`

验证配置：
```bash
aws sts get-caller-identity
# 应返回你的 AWS 账户 ID 和用户信息
```

#### 2.3 安装 AWS CDK CLI

```bash
npm install -g aws-cdk
```

验证安装：
```bash
cdk --version
# 应输出：2.x.x (build ...)
```

#### 2.4 Bootstrap CDK（仅首次）

```bash
cd infra/cdk
cdk bootstrap
# 这会在 AWS 创建 CDKToolkit CloudFormation 栈
```

---

### Step 3: 部署 AWS 基础设施（约 10 分钟）

#### 3.1 创建 S3 Bucket 和 DynamoDB 表

```bash
cd infra/cdk
cdk deploy DataStack
```

这会创建：
- S3 bucket: `campusgeo-geodata-{account-id}`
- DynamoDB 表: `campusgeo-geojson-layers`（图层元数据）
- DynamoDB 表: `campusgeo-query-history`（用户查询历史，Phase 2 使用）

等待约 3–5 分钟部署完成。

#### 3.2 上传核心图层到 S3

```bash
cd h:/Dropbox/Academy/Claude Code/GIS Agent
python convert_gdb.py --upload-core-only --bucket campusgeo-geodata-YOUR_ACCOUNT_ID
```

替换 `YOUR_ACCOUNT_ID` 为你的 AWS 账户 ID（从 `aws sts get-caller-identity` 获取）。

这会上传：
- 11 个核心 GeoJSON 文件到 `s3://campusgeo-geodata-{account}/layers/`
- `layers_metadata.json` 到 `s3://campusgeo-geodata-{account}/metadata/`

#### 3.3 导入图层元数据到 DynamoDB

```bash
cd gis_output
aws dynamodb batch-write-item --request-items file://dynamodb_batch_import.json
```

验证导入：
```bash
aws dynamodb scan --table-name campusgeo-geojson-layers --max-items 5
```

应返回 5 条图层元数据记录。

---

### Step 4: 验证端到端数据流（约 5 分钟）

#### 4.1 检查 S3 对象

```bash
aws s3 ls s3://campusgeo-geodata-YOUR_ACCOUNT_ID/layers/
# 应列出 11 个 .geojson 文件

aws s3 ls s3://campusgeo-geodata-YOUR_ACCOUNT_ID/metadata/
# 应看到 layers_metadata.json
```

#### 4.2 查询 DynamoDB 表

```bash
# 获取单个图层元数据
aws dynamodb get-item \
  --table-name campusgeo-geojson-layers \
  --key '{"layerId": {"S": "buildings-2026"}}'

# 按类别查询（使用 GSI）
aws dynamodb query \
  --table-name campusgeo-geojson-layers \
  --index-name category-index \
  --key-condition-expression "category = :cat" \
  --expression-attribute-values '{":cat": {"S": "建筑与设施"}}'
```

#### 4.3 下载 S3 文件测试

```bash
aws s3 cp s3://campusgeo-geodata-YOUR_ACCOUNT_ID/layers/Building_Information_2026.geojson ./test.geojson

# 检查文件大小
ls -lh test.geojson
# 应为约 1.7MB
```

---

## 完成 Phase 1 数据架构重构 🎉

**成功标准确认清单**：

- [ ] `aws s3 ls` 能看到 11 个 GeoJSON 文件 + 1 个 metadata 文件
- [ ] `aws dynamodb scan` 能看到 11 条图层元数据
- [ ] S3 存储成本 < $0.10/月（查看 AWS Billing）
- [ ] DynamoDB 免费套餐内（5GB 存储，40K 读取/写入单位）

**下一阶段**：重写 Lambda 工具（`backend/lambdas/ai-agent/agent.ts`），从 ArcGIS REST API 切换到 S3 + Turf.js 空间查询。

---

## 故障排查

### 问题 1: AWS CLI 报错 `Unable to locate credentials`

**解决方案**：
```bash
aws configure
# 重新输入 Access Key 和 Secret Key
```

### 问题 2: CDK Bootstrap 失败 `CREATE_FAILED: CDKToolkit`

**原因**：AWS 账户权限不足或已存在旧版本 CDKToolkit 栈。

**解决方案**：
```bash
# 检查现有栈
aws cloudformation list-stacks --stack-status-filter CREATE_COMPLETE

# 如果看到 CDKToolkit，先删除
aws cloudformation delete-stack --stack-name CDKToolkit

# 等待删除完成（约 2 分钟）
aws cloudformation wait stack-delete-complete --stack-name CDKToolkit

# 重新 bootstrap
cdk bootstrap
```

### 问题 3: DynamoDB batch-write-item 失败 `ValidationException`

**原因**：表不存在或 JSON 格式错误。

**解决方案**：
```bash
# 确认表已创建
aws dynamodb describe-table --table-name campusgeo-geojson-layers

# 如果表不存在
cd infra/cdk
cdk deploy DataStack --require-approval never
```

### 问题 4: S3 上传失败 `Access Denied`

**原因**：IAM 用户权限不足。

**解决方案**：在 AWS IAM 控制台为用户添加策略 `AmazonS3FullAccess`（开发阶段）。生产环境应使用更细粒度的权限。

---

## 参考资料

- **AWS CLI 文档**: https://docs.aws.amazon.com/cli/latest/userguide/
- **AWS CDK Python 示例**: https://docs.aws.amazon.com/cdk/v2/guide/
- **DynamoDB Batch Write**: https://docs.aws.amazon.com/cli/latest/reference/dynamodb/batch-write-item.html
- **S3 CLI 命令**: https://docs.aws.amazon.com/cli/latest/reference/s3/

---

## 文件清单

| 文件路径 | 用途 | 状态 |
|---------|------|------|
| `gis_output/core_layers.json` | 核心图层配置 | ✓ 已创建 |
| `gis_output/layers_metadata.json` | 图层元数据（原始 JSON） | ✓ 已生成 |
| `gis_output/dynamodb_batch_import.json` | DynamoDB 导入格式 | ✓ 已生成 |
| `convert_gdb.py` | GDB 转换 + 元数据生成 | ✓ 已扩展 |
| `scripts/convert_metadata_to_dynamodb.py` | JSON → DynamoDB 转换 | ✓ 已创建 |
| `infra/cdk/stacks/DataStack.ts` | CDK 基础设施定义 | ⏳ 待修改（添加 layers 表）|

---

**当前时间**：2026-06-06  
**Phase 1 进度**：~75% → ~90%（+15%）  
**预估剩余工时**：5–10 小时（Lambda 重写 + 本地测试）

---

## 旧版转换指南（归档）

如需使用 ArcGIS Pro 环境进行 GDB 转换（已完成），参见 [README_ARCGIS.md](README_ARCGIS.md)。
