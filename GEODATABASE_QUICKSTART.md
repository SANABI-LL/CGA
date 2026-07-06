# Geodatabase 转 GeoJSON 快速参考

## 🚀 最快 3 步（首次使用）

```powershell
# 1. 环境设置（仅首次）
.\setup_arcgis_env.bat

# 2. 查看有哪些图层
.\convert_with_arcgis.bat --list-only

# 3. 转换所有图层
.\convert_with_arcgis.bat --all
```

**完成！** 输出在 `gis_output\geojson\` 目录。

---

## 📋 常用命令

### 查看图层列表
```powershell
.\convert_with_arcgis.bat --list-only
```

### 转换所有图层
```powershell
.\convert_with_arcgis.bat --all
```

### 转换单个图层
```powershell
.\convert_with_arcgis.bat --layer Building_Information_2026
```

### 转换并上传到 S3
```powershell
.\convert_with_arcgis.bat --all --upload --bucket campusgeo-geodata-491117467175 --prefix layers
```

### 验证转换结果
```powershell
.\verify_conversion.bat
```

---

## 📂 输出文件结构

```
gis_output/
├── geojson/
│   └── Building_Information_2026.geojson  (1.7 MB, WGS84)
├── parquet/
│   └── Building_Information_2026.parquet  (234 KB, 压缩格式)
└── layers_manifest.json                   (元数据清单)
```

---

## 🔧 故障排除

### "ArcGIS Pro Python not found"
```powershell
# 手动指定 Python 路径
# 运行 setup_arcgis_env.bat 后，按提示输入路径
# 例如: C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe
```

### Geodatabase 正在使用
```powershell
# 1. 关闭所有 ArcGIS Pro 窗口
# 2. 检查任务管理器是否有 ArcGISPro.exe 进程
# 3. 重新运行转换命令
```

### 转换失败
```powershell
# 1. 确保 Geodatabase 在 Data\ 目录下
# 2. 检查文件名是否正确（默认: "Building Information.gdb"）
# 3. 尝试重新运行环境设置
.\setup_arcgis_env.bat
```

---

## 🌐 验证 GeoJSON

### 方式 1：在线验证（推荐）
1. 打开 https://geojson.io/
2. 拖拽 `gis_output\geojson\建筑物.geojson` 到网页
3. 查看地图是否正确显示

### 方式 2：在 ArcGIS Pro 中打开
1. Map → Add Data → Data
2. 选择 `.geojson` 文件
3. 确认坐标系为 WGS 1984 (EPSG:4326)

---

## ☁️ 上传到 S3 用于生产环境

### 一键转换并上传
```powershell
.\convert_with_arcgis.bat --all `
  --upload `
  --bucket campusgeo-geodata-491117467175 `
  --prefix layers
```

### 手动上传已转换的文件
```powershell
aws s3 sync gis_output\geojson\ `
  s3://campusgeo-geodata-491117467175/layers/ `
  --profile campusgeo-deployer
```

---

## 📊 命令参数完整列表

| 参数 | 说明 | 示例 |
|------|------|------|
| `--list-only` | 仅列出图层 | `--list-only` |
| `--all` | 转换所有图层 | `--all` |
| `--layer <名称>` | 转换指定图层 | `--layer Building_Info` |
| `--output <目录>` | 自定义输出目录 | `--output D:\GeoData` |
| `--no-parquet` | 跳过 Parquet 格式 | `--no-parquet` |
| `--upload` | 上传到 S3 | `--upload` |
| `--bucket <名称>` | S3 存储桶名称 | `--bucket my-bucket` |
| `--prefix <前缀>` | S3 键前缀 | `--prefix campus-gis` |

---

## 🔄 典型工作流程

### 场景 1：本地开发测试
```powershell
# 1. 转换
.\convert_with_arcgis.bat --all

# 2. 验证
.\verify_conversion.bat

# 3. 在 geojson.io 查看
start https://geojson.io/
# 拖拽 gis_output\geojson\*.geojson
```

### 场景 2：更新生产数据
```powershell
# 1. 转换并上传
.\convert_with_arcgis.bat --all `
  --upload `
  --bucket campusgeo-geodata-491117467175 `
  --prefix layers

# 2. 更新 Lambda 环境变量（如需要）
aws lambda update-function-configuration `
  --function-name campusgeo-query `
  --environment Variables="{GEODATA_BUCKET=campusgeo-geodata-491117467175}" `
  --profile campusgeo-deployer

# 3. 测试 API 端点
curl -X POST https://blfi6fqdnc.execute-api.us-east-1.amazonaws.com `
  -H "Content-Type: application/json" `
  -d '{"query": "Show me all buildings"}'
```

### 场景 3：批量处理多个数据库
```powershell
# 逐个转换不同的 geodatabase
.\convert_with_arcgis.bat --gdb "Data\Buildings.gdb" --all --output "gis_output\buildings"
.\convert_with_arcgis.bat --gdb "Data\Trees.gdb" --all --output "gis_output\trees"
.\convert_with_arcgis.bat --gdb "Data\Roads.gdb" --all --output "gis_output\roads"
```

---

## 📚 相关文档

- **完整文档**: `README_ARCGIS.md`（包含详细故障排除）
- **Python 脚本**: `convert_gdb.py`（核心转换逻辑）
- **验证脚本**: `verify_conversion.bat`（检查输出质量）
- **项目路线图**: `CLAUDE.md` → Phase 1: Foundation

---

## ⚙️ 关键文件位置

```
C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent\
├── setup_arcgis_env.bat          # 首次环境设置
├── convert_with_arcgis.bat       # 主转换脚本
├── verify_conversion.bat         # 验证输出
├── convert_gdb.py                # Python 核心逻辑
├── Data\
│   └── Building Information.gdb  # 源 geodatabase
└── gis_output\                   # 输出目录（自动创建）
    ├── geojson\
    ├── parquet\
    └── layers_manifest.json
```

---

## 🎯 检查清单（首次使用）

- [ ] 已安装 ArcGIS Pro
- [ ] 运行 `setup_arcgis_env.bat` 成功
- [ ] 看到 `.arcgis_env_ready` 文件
- [ ] `convert_with_arcgis.bat --list-only` 能显示图层
- [ ] 转换成功生成 GeoJSON
- [ ] 在 geojson.io 验证坐标正确（芝加哥大学校区）

---

## 💡 性能优化提示

### 加速转换
- 使用 SSD 存储数据
- 只转换需要的图层（不用 `--all`）
- 跳过 Parquet（`--no-parquet`）

### 减小文件大小
- 简化几何（编辑 `convert_gdb.py`）
- 删除不需要的字段
- 使用 Parquet 而非 GeoJSON（压缩率更高）

---

**最后更新**: 2026-07-06  
**兼容性**: ArcGIS Pro 2.8+ (Python 3.7+)
