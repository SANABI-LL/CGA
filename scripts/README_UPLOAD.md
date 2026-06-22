# GeoJSON 上传和更新指南

本文档说明如何更新和添加 GeoJSON 文件到 AWS S3。

---

## 📋 目录

1. [快速开始](#快速开始)
2. [方式对比](#方式对比)
3. [详细步骤](#详细步骤)
4. [自动化脚本](#自动化脚本)
5. [故障排除](#故障排除)

---

## 🚀 快速开始

### 更新单个文件（最常用）

```bash
# 上传更新后的建筑数据
aws s3 cp gis_output/geojson/Building_Information_2026.geojson \
  s3://campusgeo-geodata-491117467175/layers/buildings.geojson \
  --region us-east-1

# 验证上传
aws s3 ls s3://campusgeo-geodata-491117467175/layers/buildings.geojson \
  --region us-east-1 --human-readable
```

### 批量上传所有文件

```bash
# 使用提供的脚本（推荐）
python scripts/sync_geojson_to_s3.py

# 或使用 AWS CLI sync
aws s3 sync gis_output/geojson/ \
  s3://campusgeo-geodata-491117467175/layers/ \
  --region us-east-1 \
  --exclude "*.xml" --exclude "*.cpg"
```

---

## ⚖️ 方式对比

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **AWS CLI `cp`** | 简单直接 | 手动操作，易出错 | 单个文件更新 |
| **AWS CLI `sync`** | 自动检测变化 | 不更新 DynamoDB | 批量上传 |
| **Python 脚本** | 智能同步 + 元数据更新 | 需要 Python 环境 | 定期自动化 |
| **AWS Console** | 图形界面，直观 | 慢，不适合批量 | 偶尔手动上传 |
| **Windows 批处理** | 双击运行 | 功能有限 | Windows 快速操作 |

---

## 📖 详细步骤

### 方式 1：AWS CLI（推荐）

#### 前置条件

```bash
# 验证 AWS CLI 已安装且配置正确
aws --version
aws sts get-caller-identity
```

#### 单文件上传

```bash
# 基本语法
aws s3 cp <本地文件> s3://<bucket>/<key> --region us-east-1

# 示例：上传建筑数据
aws s3 cp gis_output/geojson/Building_Information_2026.geojson \
  s3://campusgeo-geodata-491117467175/layers/buildings.geojson \
  --region us-east-1

# 示例：上传树木数据
aws s3 cp gis_output/geojson/Main_Quad_Tree_Infor_Project.geojson \
  s3://campusgeo-geodata-491117467175/layers/trees.geojson \
  --region us-east-1

# 示例：上传停车场数据
aws s3 cp gis_output/geojson/Campus_Parking.geojson \
  s3://campusgeo-geodata-491117467175/layers/parking.geojson \
  --region us-east-1
```

#### 批量同步

```bash
# 同步整个目录（推荐）
aws s3 sync gis_output/geojson/ \
  s3://campusgeo-geodata-491117467175/layers/ \
  --region us-east-1 \
  --exclude "*.xml" \
  --exclude "*.cpg" \
  --exclude "*.parquet" \
  --delete  # 可选：删除 S3 中本地不存在的文件

# 查看将要同步的文件（预览模式）
aws s3 sync gis_output/geojson/ \
  s3://campusgeo-geodata-491117467175/layers/ \
  --region us-east-1 \
  --dryrun
```

#### 验证上传

```bash
# 列出所有文件
aws s3 ls s3://campusgeo-geodata-491117467175/layers/ \
  --region us-east-1 --human-readable

# 查看特定文件详情
aws s3api head-object \
  --bucket campusgeo-geodata-491117467175 \
  --key layers/buildings.geojson \
  --region us-east-1
```

---

### 方式 2：Python 脚本（推荐用于自动化）

#### 安装依赖

```bash
pip install boto3
```

#### 使用方法

```bash
# 智能同步（仅上传变化的文件）
python scripts/sync_geojson_to_s3.py

# 预览将要上传的文件（不实际执行）
python scripts/sync_geojson_to_s3.py --dry-run

# 强制上传所有文件（无论是否变化）
python scripts/sync_geojson_to_s3.py --force
```

#### 脚本功能

- ✅ MD5 哈希比对，仅上传变化的文件
- ✅ 自动更新 DynamoDB 元数据表
- ✅ 生成详细上传报告
- ✅ 支持预览模式
- ✅ 错误处理和重试

---

### 方式 3：Windows 批处理脚本

#### 使用方法

1. 双击 `scripts/upload_geojson.bat`
2. 查看将要上传的文件列表
3. 输入 `Y` 确认上传
4. 等待上传完成

#### 功能

- ✅ 图形化确认流程
- ✅ 自动排除非 GeoJSON 文件
- ✅ 显示上传结果
- ✅ 双击即可运行

---

### 方式 4：AWS Console（图形界面）

#### 步骤

1. 登录 [S3 Console](https://s3.console.aws.amazon.com/s3/buckets/campusgeo-geodata-491117467175?region=us-east-1)
2. 进入 `layers/` 文件夹
3. 点击 **Upload** 按钮
4. 拖拽文件或点击 **Add files**
5. 选择 GeoJSON 文件
6. （可选）展开 **Properties** → **Metadata** 添加自定义元数据
7. 点击 **Upload**

---

## 🤖 自动化脚本详解

### Python 脚本特性

#### 智能变化检测

```python
# 脚本会自动计算本地文件的 MD5
local_md5 = calculate_md5("gis_output/geojson/buildings.geojson")

# 与 S3 上的文件 ETag 比对
s3_etag = get_s3_etag("campusgeo-geodata-491117467175", "layers/buildings.geojson")

# 只有变化的文件才会上传
if local_md5 != s3_etag:
    upload_file(...)
```

#### 元数据同步

脚本会自动读取 `gis_output/core_layers.json`，并更新 DynamoDB：

```python
# 从元数据文件读取图层信息
{
  "layerId": "buildings-2026",
  "category": "建筑与设施",
  "priority": 1,
  "description": "主建筑信息表"
}

# 同步到 DynamoDB
table.put_item(Item={
    'layerId': 'buildings',
    'category': '建筑与设施',
    'priority': 1,
    's3Key': 'layers/buildings.geojson',
    'lastUpdated': '2026-06-22T18:52:00Z'
})
```

#### 上传报告示例

```
============================================================
CampusGeo GeoJSON S3 Sync
============================================================
Bucket:   campusgeo-geodata-491117467175
Region:   us-east-1
Source:   gis_output/geojson
Mode:     LIVE
============================================================

Found 23 GeoJSON files

Processing: Building_Information_2026.geojson
  → Status: modified
  ✓ Uploaded: layers/buildings.geojson (1.65 MB)
  ✓ Updated metadata: buildings

Processing: Campus_Building_Footprint.geojson
  ⊘ Skipped: unchanged

Processing: Main_Quad_Tree_Infor_Project.geojson
  → Status: new
  ✓ Uploaded: layers/trees.geojson (0.52 MB)
  ✓ Updated metadata: trees

============================================================
Summary
============================================================
Uploaded:  2
Skipped:   20
Failed:    0
============================================================
```

---

## 🔧 高级操作

### 启用 S3 版本控制

```bash
# 启用版本控制（保留所有历史版本）
aws s3api put-bucket-versioning \
  --bucket campusgeo-geodata-491117467175 \
  --versioning-configuration Status=Enabled \
  --region us-east-1

# 查看文件的所有版本
aws s3api list-object-versions \
  --bucket campusgeo-geodata-491117467175 \
  --prefix layers/buildings.geojson \
  --region us-east-1

# 下载特定版本
aws s3api get-object \
  --bucket campusgeo-geodata-491117467175 \
  --key layers/buildings.geojson \
  --version-id <VERSION_ID> \
  buildings_v1.geojson
```

### 设置生命周期规则

```bash
# 自动删除 90 天前的旧版本
aws s3api put-bucket-lifecycle-configuration \
  --bucket campusgeo-geodata-491117467175 \
  --lifecycle-configuration '{
    "Rules": [{
      "Id": "DeleteOldVersions",
      "Status": "Enabled",
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 90
      }
    }]
  }' \
  --region us-east-1
```

### 批量重命名文件

```bash
# 如果需要重命名 S3 上的文件
aws s3 mv s3://campusgeo-geodata-491117467175/layers/old-name.geojson \
           s3://campusgeo-geodata-491117467175/layers/new-name.geojson \
           --region us-east-1
```

---

## 🐛 故障排除

### 问题 1：权限被拒绝

```
Error: Access Denied (403)
```

**解决方案**：
```bash
# 验证 AWS 凭证
aws sts get-caller-identity

# 确认你有 S3 写权限
aws s3 ls s3://campusgeo-geodata-491117467175 --region us-east-1
```

### 问题 2：文件未更新

```
上传成功但看不到变化
```

**解决方案**：
```bash
# 清除浏览器缓存
# 或使用版本化 URL
aws s3 presign s3://campusgeo-geodata-491117467175/layers/buildings.geojson \
  --region us-east-1

# 验证 ETag（MD5）
aws s3api head-object \
  --bucket campusgeo-geodata-491117467175 \
  --key layers/buildings.geojson \
  --region us-east-1 \
  --query ETag
```

### 问题 3：文件过大上传失败

```
Error: Request timeout
```

**解决方案**：
```bash
# 使用分块上传（自动处理大文件）
aws s3 cp large-file.geojson s3://bucket/key \
  --region us-east-1 \
  --storage-class STANDARD \
  --metadata uploaded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

### 问题 4：Python 脚本缺少依赖

```
ModuleNotFoundError: No module named 'boto3'
```

**解决方案**：
```bash
# 安装 boto3
pip install boto3

# 或使用 conda
conda install -c conda-forge boto3
```

---

## 📅 定期更新工作流

### 每周数据更新流程

1. **准备数据**
   ```bash
   # 从 ArcGIS Pro 导出最新数据
   python convert_gdb.py
   ```

2. **验证转换**
   ```bash
   python verify_conversion.py
   ```

3. **预览变化**
   ```bash
   python scripts/sync_geojson_to_s3.py --dry-run
   ```

4. **执行上传**
   ```bash
   python scripts/sync_geojson_to_s3.py
   ```

5. **验证更新**
   ```bash
   # 在浏览器中查看
   https://s3.console.aws.amazon.com/s3/buckets/campusgeo-geodata-491117467175

   # 或使用 CLI
   aws s3 ls s3://campusgeo-geodata-491117467175/layers/ \
     --region us-east-1 --human-readable
   ```

---

## 📚 相关资源

- [AWS S3 CLI 参考](https://docs.aws.amazon.com/cli/latest/reference/s3/)
- [AWS S3 API 参考](https://docs.aws.amazon.com/cli/latest/reference/s3api/)
- [Boto3 S3 文档](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/s3.html)
- [GeoJSON 规范](https://datatracker.ietf.org/doc/html/rfc7946)

---

## ✅ 快速检查清单

上传前检查：
- [ ] GeoJSON 文件有效（使用 https://geojson.io 验证）
- [ ] 文件大小合理（< 10MB 推荐）
- [ ] 文件名遵循命名规范（小写，连字符）
- [ ] AWS 凭证已配置且有效
- [ ] 确认上传到正确的区域（us-east-1）

上传后验证：
- [ ] 文件出现在 S3 控制台
- [ ] 文件大小正确
- [ ] 可以通过预签名 URL 下载
- [ ] DynamoDB 元数据已更新（如果使用脚本）
- [ ] 前端应用可以读取新数据

---

**最后更新**: 2026-06-22  
**维护者**: CampusGeo Team
