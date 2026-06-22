# ArcGIS Pro 转换工具测试计划

## 测试环境

- **操作系统:** Windows 11 Enterprise
- **ArcGIS Pro:** 已安装 (Python 3.11.11)
- **项目路径:** `C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent`
- **输入数据:** `Data\Building Information.gdb` (308 features)

---

## 测试场景 1: 首次环境设置

### 步骤

```bash
cd "C:\Users\linyuliu89\Dropbox\Academy\Claude Code\GIS Agent"
setup_arcgis_env.bat
```

### 预期结果

1. 检测到 ArcGIS Pro Python:
   ```
   [SUCCESS] Found ArcGIS Pro Python: C:\Program Files\ArcGIS\Pro\bin\Python\...
   ```

2. 扫描 Python 包,显示缺失项:
   ```
   [MISSING] geopandas
   [MISSING] fiona
   [MISSING] shapely
   [MISSING] pyarrow
   ```

3. 通过 conda 或 pip 自动安装:
   ```
   [INFO] Installing via conda (recommended for ArcGIS Pro)...
   [SUCCESS] Packages installed via conda!
   ```

4. 创建标记文件:
   ```
   .arcgis_env_ready (文件存在)
   ```

5. 显示下一步提示

### 验证命令

```bash
# 检查标记文件
ls -lh .arcgis_env_ready

# 手动验证依赖
"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" -c "import geopandas; import fiona; print('✓ Dependencies OK')"
```

---

## 测试场景 2: 列出图层

### 步骤

```bash
convert_with_arcgis.bat --list-only
```

### 预期结果

```
Geodatabase contains 1 layer(s):
  [00] Building_Information_2026
       features: 308  |  geometry: MultiPolygon  |  crs: EPSG:3435
```

### 验证

- 图层名称正确
- 要素数量为 308
- 几何类型为 MultiPolygon
- 源坐标系为 EPSG:3435

---

## 测试场景 3: 转换所有图层

### 步骤

```bash
convert_with_arcgis.bat --all
```

### 预期结果

```
Reading layer: Building_Information_2026
   features: 308  |  fields: ['OBJECT_ID', 'LOC_ID', 'BD_ID', ...]
   Reprojecting: 3435 -> EPSG:4326 (WGS84)
   GeoJSON  -> gis_output\geojson\Building_Information_2026.geojson  (1675.9 KB)
   Parquet  -> gis_output\parquet\Building_Information_2026.parquet  (234.5 KB)

Manifest -> gis_output\layers_manifest.json  (1 layer(s) converted)

Done. 1/1 layer(s) converted into gis_output
```

### 验证文件

```bash
# 检查输出目录结构
ls -lh gis_output/geojson/*.geojson
ls -lh gis_output/parquet/*.parquet
ls -lh gis_output/layers_manifest.json

# 检查 GeoJSON 文件大小 (应约 1.7 MB)
du -h gis_output/geojson/Building_Information_2026.geojson

# 检查 manifest 内容
cat gis_output/layers_manifest.json | head -30
```

### 验证 GeoJSON 有效性

```bash
# 使用 Python 验证 JSON 格式
"C:\Program Files\ArcGIS\Pro\bin\Python\envs\arcgispro-py3\python.exe" -c "import json; data = json.load(open('gis_output/geojson/Building_Information_2026.geojson')); print(f'✓ Valid GeoJSON: {data['type']}, {len(data['features'])} features')"
```

预期输出:
```
✓ Valid GeoJSON: FeatureCollection, 308 features
```

---

## 测试场景 4: 验证转换结果

### 步骤

```bash
verify_conversion.bat
```

### 预期结果

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

[INFO] Total GeoJSON files: 1

Status: SUCCESS
```

---

## 测试场景 5: 重新转换 (覆盖测试)

### 步骤

```bash
# 第一次转换
convert_with_arcgis.bat --layer Building_Information_2026

# 记录时间戳
ls -lh gis_output/geojson/Building_Information_2026.geojson

# 等待 5 秒
sleep 5

# 第二次转换 (应覆盖)
convert_with_arcgis.bat --layer Building_Information_2026

# 检查时间戳是否更新
ls -lh gis_output/geojson/Building_Information_2026.geojson
```

### 验证

- 文件时间戳已更新
- 文件大小保持一致 (~1.7 MB)
- manifest 更新时间字段已更新

---

## 测试场景 6: 错误处理 (未设置环境)

### 步骤

```bash
# 删除标记文件模拟未设置环境
rm .arcgis_env_ready

# 尝试转换
convert_with_arcgis.bat --all
```

### 预期结果

```
[ERROR] Environment not configured!

Please run setup_arcgis_env.bat first to install required Python packages.
```

### 恢复

```bash
setup_arcgis_env.bat
```

---

## 测试场景 7: 在线验证 (geojson.io)

### 步骤

1. 打开浏览器,访问 https://geojson.io/
2. 拖拽 `gis_output\geojson\Building_Information_2026.geojson` 到网页
3. 观察地图

### 预期结果

- 地图自动缩放到芝加哥大学校园区域
- 显示 308 个建筑多边形
- 点击任意建筑显示属性 (LOC_ID, DISCRIPT1, ADDRESS, etc.)
- 坐标系为 WGS84 (经纬度)

### 验证边界框

根据 manifest:
```json
"bbox_wgs84": [-105.820542, 32.780263, -87.586599, 42.570607]
```

地图应覆盖此范围 (美国中西部)。

---

## 测试场景 8: ArcGIS Pro 验证 (可选)

### 步骤

1. 打开 ArcGIS Pro
2. Map → Add Data → Data
3. 浏览到 `gis_output\geojson\Building_Information_2026.geojson`
4. 添加到地图

### 预期结果

- 图层名称: `Building_Information_2026`
- 坐标系: WGS 1984 (EPSG:4326)
- 要素数量: 308
- 属性表包含所有原始字段

---

## 测试场景 9: 跳过 Parquet 输出

### 步骤

```bash
# 清空输出目录
rm -rf gis_output/

# 转换但跳过 Parquet
convert_with_arcgis.bat --all --no-parquet
```

### 预期结果

```
   GeoJSON  -> gis_output\geojson\Building_Information_2026.geojson  (1675.9 KB)
   (Parquet 行未出现)
```

### 验证

```bash
# Parquet 目录不应存在
ls gis_output/parquet/ 2>&1 | grep "No such file"

# 但 GeoJSON 应存在
ls gis_output/geojson/Building_Information_2026.geojson
```

---

## 性能基准

| 操作 | 预期耗时 | 说明 |
|------|----------|------|
| 环境设置 (首次) | 3–5 分钟 | 包括下载和安装 geopandas/fiona |
| 列出图层 | < 5 秒 | 读取 geodatabase 元数据 |
| 转换单图层 (308 features) | 10–20 秒 | 包括坐标投影和 I/O |
| 验证脚本 | < 2 秒 | 解析 JSON manifest |

---

## 回归测试检查清单

运行完整测试套件:

```bash
# 1. 清理环境
rm -rf gis_output/ .arcgis_env_ready

# 2. 环境设置
setup_arcgis_env.bat

# 3. 列出图层
convert_with_arcgis.bat --list-only

# 4. 完整转换
convert_with_arcgis.bat --all

# 5. 验证
verify_conversion.bat

# 6. 在线检查
# 手动: 打开 geojson.io 验证
```

**预期总耗时:** 5–10 分钟 (首次运行含安装)

---

## 已知限制

1. **ArcGIS Pro 路径硬编码**
   - 假设标准安装路径: `C:\Program Files\ArcGIS\Pro`
   - 非标准安装需手动指定路径

2. **Geodatabase 锁定**
   - 如果 ArcGIS Pro 正在使用 .gdb,转换会失败
   - 解决: 关闭 ArcGIS Pro 后重试

3. **大文件性能**
   - 超过 10MB 的 GeoJSON 可能加载缓慢
   - 建议使用 Parquet 格式或简化几何

---

## 下一步测试 (Phase 1 完成后)

- [ ] S3 上传功能 (`--upload --bucket`)
- [ ] Lambda 集成测试 (S3 + Turf.js 查询)
- [ ] 前端地图加载 S3 GeoJSON

---

**测试完成日期:** 待执行  
**测试人员:** 待定  
**测试环境版本:**
- ArcGIS Pro: 3.x
- Python: 3.11.11
- geopandas: (待安装后确认)
