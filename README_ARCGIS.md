# ArcGIS Pro 环境下的 Geodatabase 转换指南

本指南专为使用 **ArcGIS Pro** (非 OSGeo4W/QGIS) 的用户编写。通过三个批处理脚本,您可以轻松将 File Geodatabase 转换为 WGS84 GeoJSON 格式。

---

## 🚀 快速开始 (3 步,10 分钟内完成)

### 步骤 1: 环境设置 (一次性)

打开命令提示符或 PowerShell,切换到项目目录:

```bash
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent"
```

运行环境设置脚本:

```bash
setup_arcgis_env.bat
```

**脚本将自动:**
- 检测 ArcGIS Pro Python 环境 (标准路径: `C:\Program Files\ArcGIS\Pro\bin\Python\...`)
- 扫描已安装的 Python 包
- 使用 conda 或 pip 安装缺失的依赖 (geopandas, fiona, shapely, pyarrow)
- 创建 `.arcgis_env_ready` 标记文件

**预期输出:**
```
============================================================
  UChicago GIS Agent - ArcGIS Pro Environment Setup
============================================================

[STEP 1] Detecting ArcGIS Pro Python environment...

[SUCCESS] Found ArcGIS Pro Python: C:\Program Files\...

[STEP 2] Checking Python dependencies...
[OK] geopandas is installed
[OK] fiona is installed
[OK] shapely is installed
[OK] pyarrow is installed

[SUCCESS] All required packages are already installed!

Next steps:
1. Run: convert_with_arcgis.bat --list-only
```

---

### 步骤 2: 列出图层 (可选验证)

查看 Geodatabase 中包含的所有图层:

```bash
convert_with_arcgis.bat --list-only
```

**预期输出:**
```
Geodatabase contains 1 layer(s):
  [00] Building_Information_2026
       features: 308  |  geometry: MultiPolygon  |  crs: EPSG:3435
```

---

### 步骤 3: 转换为 GeoJSON

转换所有图层:

```bash
convert_with_arcgis.bat --all
```

**或**转换单个图层:

```bash
convert_with_arcgis.bat --layer Building_Information_2026
```

**预期输出:**
```
Reading layer: Building_Information_2026
   features: 308  |  fields: ['OBJECT_ID', 'LOC_ID', 'BD_ID', ...]
   Reprojecting: 3435 -> EPSG:4326 (WGS84)
   GeoJSON  -> gis_output\geojson\Building_Information_2026.geojson  (1675.9 KB)
   Parquet  -> gis_output\parquet\Building_Information_2026.parquet  (234.5 KB)

Manifest -> gis_output\layers_manifest.json  (1 layer(s) converted)

Done. 1/1 layer(s) converted into gis_output
```

---

### 步骤 4: 验证转换结果

运行验证脚本:

```bash
verify_conversion.bat
```

**预期输出:**
```
[SUCCESS] Conversion manifest loaded

Source: C:\Users\...\Building Information.gdb
Generated: 2026-06-04T15:46:54+00:00
Target CRS: EPSG:4326

============================================================
  Converted Layers: 1
============================================================

1. Building_Information_2026
   Features: 308
   File size: 1,675.9 KB
   Geometry: MultiPolygon
   Source CRS: EPSG:3435 -> EPSG:4326 (WGS84)
   Path: geojson/Building_Information_2026.geojson
```

---

## 📖 命令参考

### `convert_with_arcgis.bat` 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--list-only` | 仅列出图层,不转换 | `convert_with_arcgis.bat --list-only` |
| `--layer <名称>` | 转换指定图层 | `convert_with_arcgis.bat --layer Building_Information_2026` |
| `--all` | 批量转换所有图层 | `convert_with_arcgis.bat --all` |
| `--output <目录>` | 自定义输出目录 (默认: `gis_output`) | `convert_with_arcgis.bat --all --output D:\GeoData` |
| `--no-parquet` | 跳过 Parquet 格式输出 | `convert_with_arcgis.bat --all --no-parquet` |
| `--upload` | 转换后上传到 S3 (需配置 AWS CLI) | `convert_with_arcgis.bat --all --upload --bucket my-bucket` |
| `--bucket <桶名>` | S3 存储桶名称 (与 `--upload` 配合使用) | 见上一行 |
| `--prefix <前缀>` | S3 键前缀 (默认: `campus-gis`) | `convert_with_arcgis.bat --all --upload --bucket my-bucket --prefix gis-data` |

### 输出文件结构

```
gis_output/
├── geojson/
│   └── Building_Information_2026.geojson  (1.7 MB, WGS84 坐标)
├── parquet/
│   └── Building_Information_2026.parquet  (234 KB, 压缩格式)
└── layers_manifest.json                   (元数据清单)
```

**`layers_manifest.json` 示例:**
```json
{
  "source_gdb": "C:\\...\\Building Information.gdb",
  "generated_at": "2026-06-04T15:46:54+00:00",
  "crs": "EPSG:4326",
  "layers": [
    {
      "layer": "Building_Information_2026",
      "safe_name": "Building_Information_2026",
      "status": "ok",
      "feature_count": 308,
      "geometry_types": ["MultiPolygon"],
      "source_crs": "EPSG:3435",
      "bbox_wgs84": [-105.82, 32.78, -87.59, 42.57],
      "fields": { ... },
      "geojson_rel": "geojson/Building_Information_2026.geojson",
      "geojson_kb": 1675.9,
      "s3_key": "campus-gis/geojson/Building_Information_2026.geojson"
    }
  ]
}
```

---

## 🔧 故障排除

### 问题 1: "ArcGIS Pro Python not found"

**症状:**
```
[ERROR] ArcGIS Pro Python not found at standard location:
  Expected: C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe
```

**解决方案:**

1. **确认 ArcGIS Pro 已安装**
   - 打开 ArcGIS Pro 应用程序,确保可以正常启动

2. **查找 Python 路径**
   - 在 ArcGIS Pro 中: Project → Python → Manage Environments
   - 或在文件资源管理器中搜索 `arcgispro-py3\python.exe`

3. **手动指定路径**
   - 运行 `setup_arcgis_env.bat`
   - 当提示输入路径时,粘贴完整的 Python 路径,例如:
     ```
     D:\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe
     ```
   - 路径将保存到 `.arcgis_python_path` 文件中

---

### 问题 2: "geopandas not found" 或依赖安装失败

**症状:**
```
ModuleNotFoundError: No module named 'geopandas'
```

**解决方案:**

1. **重新运行环境设置**
   ```bash
   setup_arcgis_env.bat
   ```

2. **检查网络连接**
   - conda 和 pip 需要互联网连接下载包
   - 如果在离线环境,参考下方"离线安装"

3. **以管理员身份运行**
   - 右键点击 `setup_arcgis_env.bat` → "以管理员身份运行"
   - 某些系统需要管理员权限安装 Python 包

4. **手动安装**
   - 打开命令提示符,运行:
     ```bash
     "C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" -m pip install geopandas fiona shapely pyarrow
     ```

---

### 问题 3: 转换失败 "Failed to open geodatabase"

**症状:**
```
ERROR converting Building_Information_2026: Failed to open geodatabase
```

**可能原因与解决方案:**

1. **Geodatabase 正在被 ArcGIS Pro 使用**
   - 关闭所有 ArcGIS Pro 窗口
   - 检查任务管理器中是否有 `ArcGISPro.exe` 进程
   - 重新运行转换脚本

2. **Geodatabase 文件损坏**
   - 在 ArcGIS Pro 中打开 `Data\Building Information.gdb`,验证是否能正常加载
   - 使用 ArcGIS Pro 的 "Compact" 工具修复数据库

3. **路径包含特殊字符**
   - 确保项目路径不包含中文、空格以外的特殊字符
   - 如需中文路径,确保脚本以 UTF-8 编码运行 (脚本已包含 `chcp 65001`)

---

### 问题 4: 磁盘空间不足

**症状:**
```
OSError: [Errno 28] No space left on device
```

**解决方案:**

1. **清理磁盘空间**
   - 删除 `gis_output\` 中旧的转换结果
   - 转换大型 geodatabase 前,确保至少有 2GB 可用空间

2. **使用自定义输出目录**
   - 指定其他磁盘的输出路径:
     ```bash
     convert_with_arcgis.bat --all --output D:\GIS_Output
     ```

3. **跳过 Parquet 输出**
   - Parquet 文件通常占用空间较小,但如不需要:
     ```bash
     convert_with_arcgis.bat --all --no-parquet
     ```

---

### 问题 5: 字符编码错误 (乱码)

**症状:**
- 终端显示中文乱码
- 包含中文字段名的 geodatabase 转换失败

**解决方案:**

1. **使用 UTF-8 编码的终端**
   - 脚本已包含 `chcp 65001`,应自动设置 UTF-8
   - 如仍有问题,在 PowerShell 中运行:
     ```powershell
     [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
     ```

2. **在 VSCode 终端中运行**
   - VSCode 终端默认使用 UTF-8 编码
   - 推荐使用 VSCode 内置终端而非 CMD

---

## 🌐 在线验证 GeoJSON

转换完成后,可在以下平台验证:

### 方法 1: geojson.io (推荐)

1. 打开 https://geojson.io/
2. 拖拽 `gis_output\geojson\Building_Information_2026.geojson` 到网页
3. 应看到校园建筑轮廓显示在地图上

### 方法 2: ArcGIS Pro

1. 打开 ArcGIS Pro
2. Map → Add Data → Data → 选择 `.geojson` 文件
3. 验证坐标系为 **WGS 1984 (EPSG:4326)**

### 方法 3: QGIS (如已安装)

1. Layer → Add Layer → Add Vector Layer
2. 选择 GeoJSON 文件
3. 检查属性表和空间参考

---

## ☁️ 上传到 AWS S3 (可选)

完成本地转换后,可上传到 S3 用于 Lambda 查询:

### 前提条件

1. **安装 AWS CLI**
   - 下载: https://aws.amazon.com/cli/
   - 验证: `aws --version`

2. **配置 AWS 凭证**
   ```bash
   aws configure
   ```
   - 输入 Access Key ID、Secret Access Key、默认区域 (如 `us-east-1`)

### 上传命令

```bash
convert_with_arcgis.bat --all --upload --bucket uchicago-gis-data --prefix campus-gis
```

**说明:**
- `--bucket uchicago-gis-data`: S3 存储桶名称 (需提前创建)
- `--prefix campus-gis`: S3 键前缀,文件将存储在 `campus-gis/geojson/` 路径下

**上传的文件:**
```
s3://uchicago-gis-data/campus-gis/
├── geojson/
│   └── Building_Information_2026.geojson
├── parquet/
│   └── Building_Information_2026.parquet
└── layers_manifest.json
```

---

## 📚 与其他文档的关系

本指南专为 **ArcGIS Pro** 用户设计,替代以下基于 OSGeo4W 的方法:

- ~~`Data\README_CONVERSION.md`~~ (依赖 OSGeo4W Shell)
- ~~`Data\convert_gdb_to_geojson.bat`~~ (依赖 ogr2ogr 命令)

**推荐使用:**
- ✅ `README_ARCGIS.md` (本文档)
- ✅ `setup_arcgis_env.bat`
- ✅ `convert_with_arcgis.bat`
- ✅ `verify_conversion.bat`

**项目路线图:**
参考 [`CLAUDE.md`](CLAUDE.md) 中的 **Phase 1: Foundation** 部分,本工具集完成了:
- [x] Geodatabase → GeoJSON ETL 脚本
- [x] 上传 GeoJSON 到 S3 (可选)
- [ ] Lambda 工具重写 (下一步)
- [ ] DynamoDB 元数据管理 (下一步)

---

## ❓ 常见问题 (FAQ)

### Q1: 是否需要 ArcGIS Pro 许可证?

**A:** 是的。脚本使用 ArcGIS Pro 自带的 Python 环境,需要有效的 ArcGIS Pro 安装。如果您没有许可证,可考虑:
- 申请 ArcGIS Pro 学生版 (UChicago 可能提供)
- 使用 OSGeo4W + GDAL (参考原 `Data\README_CONVERSION.md`)

---

### Q2: 转换速度慢怎么办?

**A:** 大型 geodatabase 转换可能需要几分钟。优化方法:
- 转换单个图层而非 `--all`
- 使用 SSD 存储输入和输出数据
- 跳过 Parquet 输出 (`--no-parquet`)
- 简化几何 (需修改 `convert_gdb.py`,添加 `gdf.simplify()`)

---

### Q3: 可以转换 Shapefile 或其他格式吗?

**A:** `convert_gdb.py` 专为 File Geodatabase (`.gdb`) 设计,但 `geopandas` 也支持:
- Shapefile (`.shp`)
- GeoPackage (`.gpkg`)
- KML/KMZ

修改 `--gdb` 参数即可:
```bash
convert_with_arcgis.bat --gdb "Data\my_data.shp" --layer my_layer
```

---

### Q4: 输出的 GeoJSON 文件太大?

**A:** 解决方案:
1. **使用 Parquet 格式** (默认启用)
   - Parquet 压缩率高,适合大数据集
   - Lambda 可直接读取 Parquet (需集成 Apache Arrow)

2. **简化几何**
   - 修改 `convert_gdb.py`,在 L109 后添加:
     ```python
     gdf['geometry'] = gdf['geometry'].simplify(tolerance=0.0001)
     ```

3. **过滤字段**
   - 删除不需要的属性列:
     ```python
     gdf = gdf[['geometry', 'LOC_ID', 'DISCRIPT1']]  # 仅保留必要字段
     ```

---

### Q5: 如何批量转换多个 Geodatabase?

**A:** 创建一个循环脚本 `batch_convert.bat`:

```batch
@echo off
for %%G in (Data\*.gdb) do (
    echo Converting %%G...
    convert_with_arcgis.bat --gdb "%%G" --all --output "gis_output\%%~nG"
)
echo All conversions complete!
pause
```

---

## 🤝 需要帮助?

遇到问题请提供以下信息:

1. **错误截图** (包括完整终端输出)
2. **运行的完整命令**
3. **ArcGIS Pro 版本**
   ```bash
   "C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" --version
   ```
4. **Geodatabase 信息**
   - 文件大小
   - 图层数量
   - 是否在 ArcGIS Pro 中能正常打开

---

**最后更新:** 2026-06-04  
**脚本版本:** 1.0  
**兼容性:** ArcGIS Pro 2.8+ (Python 3.7+)  
**作者:** UChicago GIS Intelligence Project
