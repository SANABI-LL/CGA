#!/usr/bin/env python3
"""
convert_gdb.py
UChicago GIS Agent — File Geodatabase (.gdb) -> GeoJSON converter / ETL.

Converts the campus geodatabase into WGS84 GeoJSON (plus optional GeoParquet),
writes a metadata manifest aligned with the planned DynamoDB layer-metadata
schema, and can upload everything to S3. This is the Phase 1 ETL step that
replaces the live ArcGIS REST dependency with self-hosted data.

Usage
-----
    python convert_gdb.py --list-only
    python convert_gdb.py --layer Building_Information_2026
    python convert_gdb.py --all
    python convert_gdb.py --all --upload --bucket my-campusgeo-bucket

Paths default to the repo layout (./Data/<gdb> and ./gis_output) and can be
overridden with --gdb / --output. No machine-specific absolute paths.

Dependencies
------------
    pip install geopandas fiona pyarrow shapely boto3
    # or: conda install -c conda-forge geopandas fiona pyarrow shapely boto3
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

# ── Defaults (portable: resolved relative to this script's location) ─────────
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_GDB = SCRIPT_DIR / "Data" / "Building Information.gdb"
DEFAULT_LAYER = "Building_Information_2026"
DEFAULT_OUTPUT = SCRIPT_DIR / "gis_output"
DEFAULT_S3_PREFIX = "campus-gis"
# ─────────────────────────────────────────────────────────────────────────────

REQUIRED_PKGS = ["geopandas", "fiona", "shapely"]


def check_dependencies(need_parquet: bool, need_s3: bool) -> None:
    missing = []
    for pkg in REQUIRED_PKGS:
        try:
            __import__(pkg)
        except ImportError:
            missing.append(pkg)
    if need_parquet:
        try:
            __import__("pyarrow")
        except ImportError:
            missing.append("pyarrow")
    if need_s3:
        try:
            __import__("boto3")
        except ImportError:
            missing.append("boto3")
    if missing:
        print("Missing dependencies. Install with:")
        print(f"   pip install {' '.join(sorted(set(missing)))}")
        sys.exit(1)


def safe_name(name: str) -> str:
    """Filesystem- and S3-safe slug for a layer name."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", name)


def list_layers(gdb_path: str) -> list:
    import fiona

    layers = fiona.listlayers(gdb_path)
    print(f"\nGeodatabase contains {len(layers)} layer(s):")
    for i, name in enumerate(layers):
        try:
            with fiona.open(gdb_path, layer=name) as src:
                crs_str = str(src.crs) if src.crs else "unknown CRS"
                count = len(src)
                geom = src.schema.get("geometry", "no geometry")
            print(f"  [{i:02d}] {name}")
            print(f"       features: {count}  |  geometry: {geom}  |  crs: {crs_str[:60]}")
        except Exception as e:  # noqa: BLE001
            print(f"  [{i:02d}] {name}  (failed to read: {e})")
    return layers


def convert_layer(gdb_path: str, layer_name: str, output_dir: Path,
                  write_parquet: bool, s3_prefix: str) -> dict:
    import geopandas as gpd

    print(f"\nReading layer: {layer_name}")
    gdf = gpd.read_file(gdb_path, layer=layer_name)

    if gdf.empty:
        print("   Layer is empty -- skipped.")
        return {"layer": layer_name, "status": "empty"}

    print(f"   features: {len(gdf)}  |  fields: {list(gdf.columns)}")

    source_crs = str(gdf.crs) if gdf.crs is not None else None
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        print(f"   Reprojecting: {gdf.crs.to_epsg()} -> EPSG:4326 (WGS84)")
        gdf = gdf.to_crs(epsg=4326)
    elif gdf.crs is None:
        print("   No CRS detected -- assuming data is already WGS84.")

    slug = safe_name(layer_name)

    geojson_dir = output_dir / "geojson"
    geojson_dir.mkdir(parents=True, exist_ok=True)
    geojson_path = geojson_dir / f"{slug}.geojson"
    gdf.to_file(geojson_path, driver="GeoJSON")
    geojson_kb = geojson_path.stat().st_size / 1024
    print(f"   GeoJSON  -> {geojson_path}  ({geojson_kb:.1f} KB)")

    parquet_rel = None
    if write_parquet:
        parquet_dir = output_dir / "parquet"
        parquet_dir.mkdir(parents=True, exist_ok=True)
        parquet_path = parquet_dir / f"{slug}.parquet"
        gdf.to_parquet(parquet_path, index=False)
        parquet_kb = parquet_path.stat().st_size / 1024
        parquet_rel = str(parquet_path.relative_to(output_dir)).replace("\\", "/")
        print(f"   Parquet  -> {parquet_path}  ({parquet_kb:.1f} KB)")

    bounds = [round(float(v), 6) for v in gdf.total_bounds]
    geom_types = sorted({g.geom_type for g in gdf.geometry if g is not None})
    fields = {col: str(gdf[col].dtype) for col in gdf.columns if col != gdf.geometry.name}

    return {
        "layer": layer_name,
        "safe_name": slug,
        "status": "ok",
        "feature_count": int(len(gdf)),
        "geometry_types": geom_types,
        "source_crs": source_crs,
        "bbox_wgs84": bounds,
        "fields": fields,
        "geojson_rel": str(geojson_path.relative_to(output_dir)).replace("\\", "/"),
        "geojson_kb": round(geojson_kb, 1),
        "parquet_rel": parquet_rel,
        "s3_key": f"{s3_prefix}/geojson/{slug}.geojson",
    }


def write_manifest(output_dir: Path, results: list, gdb_path: str) -> Path:
    """Manifest mirrors the planned DynamoDB layer-metadata schema."""
    manifest = {
        "source_gdb": str(gdb_path),
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "crs": "EPSG:4326",
        "layers": [r for r in results if r.get("status") == "ok"],
        "skipped": [r for r in results if r.get("status") != "ok"],
    }
    manifest_path = output_dir / "layers_manifest.json"
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"\nManifest -> {manifest_path}  ({len(manifest['layers'])} layer(s) converted)")
    return manifest_path


def upload_to_s3(output_dir: Path, bucket: str, prefix: str) -> None:
    import boto3

    print(f"\nUploading to s3://{bucket}/{prefix}/")
    s3 = boto3.client("s3")

    content_types = {
        ".geojson": "application/geo+json",
        ".parquet": "application/octet-stream",
        ".json": "application/json",
    }

    uploaded = 0
    for fp in sorted(output_dir.rglob("*")):
        if not fp.is_file():
            continue
        rel = fp.relative_to(output_dir)
        s3_key = f"{prefix}/{rel}".replace("\\", "/")
        ctype = content_types.get(fp.suffix, "application/octet-stream")
        try:
            s3.upload_file(
                str(fp), bucket, s3_key,
                ExtraArgs={"ContentType": ctype, "CacheControl": "public, max-age=3600"},
            )
            print(f"   uploaded s3://{bucket}/{s3_key}")
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            print(f"   FAILED   {fp.name}: {e}")

    print(f"\nUpload complete: {uploaded} file(s).")


def generate_layer_metadata(geojson_path: Path, layer_config: dict) -> dict:
    """
    从 GeoJSON 文件提取元数据，符合 DynamoDB layer-metadata 表结构。

    Args:
        geojson_path: GeoJSON 文件路径
        layer_config: core_layers.json 中的图层配置

    Returns:
        符合 DynamoDB schema 的元数据字典
    """
    with open(geojson_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    features = data.get("features", [])

    if not features:
        return {
            "layerId": layer_config["id"],
            "displayName": layer_config["description"],
            "category": layer_config["category"],
            "s3Key": f"layers/{layer_config['sourceFile']}",
            "geometryType": "Unknown",
            "fieldsSchema": {},
            "bbox": [0, 0, 0, 0],
            "featureCount": 0,
            "lastUpdated": dt.datetime.now(dt.timezone.utc).isoformat(),
            "priority": layer_config["priority"],
            "tags": [layer_config["category"].lower()],
        }

    # 计算边界框
    coords = []
    geom_types = set()
    for feature in features:
        geom = feature.get("geometry")
        if not geom:
            continue
        geom_type = geom.get("type")
        geom_types.add(geom_type)

        if geom_type == "Point":
            coords.append(geom["coordinates"])
        elif geom_type == "LineString":
            coords.extend(geom["coordinates"])
        elif geom_type == "Polygon":
            for ring in geom["coordinates"]:
                coords.extend(ring)
        elif geom_type == "MultiPolygon":
            for polygon in geom["coordinates"]:
                for ring in polygon:
                    coords.extend(ring)
        elif geom_type == "MultiLineString":
            for line in geom["coordinates"]:
                coords.extend(line)
        elif geom_type == "MultiPoint":
            coords.extend(geom["coordinates"])

    if coords:
        lons = [c[0] for c in coords]
        lats = [c[1] for c in coords]
        bbox = [
            round(min(lons), 6),
            round(min(lats), 6),
            round(max(lons), 6),
            round(max(lats), 6),
        ]
    else:
        bbox = [0, 0, 0, 0]

    # 提取字段 schema（从第一个 feature 推断类型）
    fields_schema = {}
    if features:
        sample_props = features[0].get("properties", {})
        for key, value in sample_props.items():
            if value is None:
                fields_schema[key] = {"type": "string"}
            elif isinstance(value, bool):
                fields_schema[key] = {"type": "boolean"}
            elif isinstance(value, int):
                fields_schema[key] = {"type": "number"}
            elif isinstance(value, float):
                fields_schema[key] = {"type": "number"}
            elif isinstance(value, str):
                fields_schema[key] = {"type": "string"}
            else:
                fields_schema[key] = {"type": "string"}

    # 确定主要几何类型（取最常见的）
    primary_geom_type = list(geom_types)[0] if geom_types else "Unknown"

    return {
        "layerId": layer_config["id"],
        "displayName": layer_config["description"],
        "category": layer_config["category"],
        "s3Key": f"layers/{layer_config['sourceFile']}",
        "geometryType": primary_geom_type,
        "fieldsSchema": fields_schema,
        "bbox": bbox,
        "featureCount": len(features),
        "lastUpdated": dt.datetime.now(dt.timezone.utc).isoformat(),
        "priority": layer_config["priority"],
        "tags": [layer_config["category"].lower()],
    }


def generate_metadata_from_core_layers(output_dir: Path, core_layers_path: Path) -> Path:
    """
    读取 core_layers.json，为每个核心图层生成 DynamoDB 元数据。

    Args:
        output_dir: GeoJSON 输出目录（gis_output/）
        core_layers_path: core_layers.json 配置文件路径

    Returns:
        生成的 layers_metadata.json 文件路径
    """
    if not core_layers_path.exists():
        print(f"\nERROR: core_layers.json not found at {core_layers_path}")
        sys.exit(1)

    with open(core_layers_path, "r", encoding="utf-8") as f:
        core_layers_config = json.load(f)

    layers = core_layers_config.get("layers", [])
    if not layers:
        print("\nWARNING: No layers defined in core_layers.json")
        return None

    print(f"\nGenerating metadata for {len(layers)} core layers...")
    metadata_list = []

    geojson_dir = output_dir / "geojson"
    for layer_config in layers:
        source_file = layer_config["sourceFile"]
        geojson_path = geojson_dir / source_file

        if not geojson_path.exists():
            print(f"   WARNING: {source_file} not found, skipping")
            continue

        print(f"   Processing {source_file}...")
        try:
            metadata = generate_layer_metadata(geojson_path, layer_config)
            metadata_list.append(metadata)
            print(f"      {metadata['featureCount']} features, bbox: {metadata['bbox']}")
        except Exception as e:  # noqa: BLE001
            print(f"      ERROR: {e}")

    # 输出元数据文件
    metadata_path = output_dir / "layers_metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata_list, f, indent=2, ensure_ascii=False)

    print(f"\nMetadata generated: {metadata_path}")
    print(f"   {len(metadata_list)}/{len(layers)} layers processed successfully")

    return metadata_path


def upload_core_layers_to_s3(output_dir: Path, core_layers_path: Path,
                             bucket: str, metadata_path: Path = None) -> None:
    """
    仅上传 core_layers.json 中定义的核心图层到 S3。

    Args:
        output_dir: GeoJSON 输出目录
        core_layers_path: core_layers.json 配置文件路径
        bucket: S3 bucket 名称
        metadata_path: layers_metadata.json 文件路径（可选）
    """
    import boto3

    if not core_layers_path.exists():
        print(f"\nERROR: core_layers.json not found at {core_layers_path}")
        sys.exit(1)

    with open(core_layers_path, "r", encoding="utf-8") as f:
        core_layers_config = json.load(f)

    layers = core_layers_config.get("layers", [])
    print(f"\nUploading {len(layers)} core layers to s3://{bucket}/")

    s3 = boto3.client("s3")
    geojson_dir = output_dir / "geojson"
    uploaded = 0

    for layer_config in layers:
        source_file = layer_config["sourceFile"]
        local_path = geojson_dir / source_file

        if not local_path.exists():
            print(f"   SKIP: {source_file} not found locally")
            continue

        s3_key = f"layers/{source_file}"
        try:
            s3.upload_file(
                str(local_path),
                bucket,
                s3_key,
                ExtraArgs={
                    "ContentType": "application/geo+json",
                    "CacheControl": "public, max-age=3600",
                },
            )
            size_kb = local_path.stat().st_size / 1024
            print(f"   ✓ {s3_key}  ({size_kb:.1f} KB)")
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            print(f"   ✗ {source_file}: {e}")

    # 上传元数据文件
    if metadata_path and metadata_path.exists():
        try:
            s3.upload_file(
                str(metadata_path),
                bucket,
                "metadata/layers_metadata.json",
                ExtraArgs={
                    "ContentType": "application/json",
                    "CacheControl": "public, max-age=3600",
                },
            )
            print(f"   ✓ metadata/layers_metadata.json")
            uploaded += 1
        except Exception as e:  # noqa: BLE001
            print(f"   ✗ metadata upload failed: {e}")

    print(f"\nUpload complete: {uploaded} file(s) uploaded to S3")


def main() -> None:
    parser = argparse.ArgumentParser(description="UChicago GIS Agent -- GDB to GeoJSON converter")
    parser.add_argument("--gdb", default=str(DEFAULT_GDB), help="Path to the .gdb directory")
    parser.add_argument("--layer", default=DEFAULT_LAYER, help="Single layer name to convert")
    parser.add_argument("--all", action="store_true", help="Convert every layer in the geodatabase")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output directory")
    parser.add_argument("--list-only", action="store_true", help="List layers and exit")
    parser.add_argument("--no-parquet", action="store_true", help="Skip GeoParquet output")
    parser.add_argument("--upload", action="store_true", help="Upload output to S3 after conversion")
    parser.add_argument("--bucket", default="", help="Target S3 bucket (required with --upload)")
    parser.add_argument("--prefix", default=DEFAULT_S3_PREFIX, help="S3 key prefix")

    # 新增参数：元数据生成和核心图层上传
    parser.add_argument("--generate-metadata", action="store_true",
                       help="Generate DynamoDB metadata from core_layers.json")
    parser.add_argument("--core-layers", default="gis_output/core_layers.json",
                       help="Path to core_layers.json config file")
    parser.add_argument("--upload-core-only", action="store_true",
                       help="Upload only core layers defined in core_layers.json (not all files)")

    args = parser.parse_args()

    output_dir = Path(args.output)

    # 独立功能：仅生成元数据（不执行转换）
    if args.generate_metadata:
        check_dependencies(need_parquet=False, need_s3=False)
        core_layers_path = Path(args.core_layers)
        generate_metadata_from_core_layers(output_dir, core_layers_path)
        return

    # 独立功能：仅上传核心图层（不执行转换）
    if args.upload_core_only:
        check_dependencies(need_parquet=False, need_s3=True)
        if not args.bucket:
            print("\n--upload-core-only requires --bucket")
            sys.exit(1)
        core_layers_path = Path(args.core_layers)
        metadata_path = output_dir / "layers_metadata.json"
        upload_core_layers_to_s3(output_dir, core_layers_path, args.bucket, metadata_path)
        return

    # 常规转换流程
    check_dependencies(need_parquet=not args.no_parquet, need_s3=args.upload)

    gdb_path = args.gdb
    if not Path(gdb_path).exists():
        print(f"Geodatabase not found: {gdb_path}")
        print("Pass --gdb with the correct path, or place the .gdb under ./Data/.")
        sys.exit(1)

    available = list_layers(gdb_path)

    if args.list_only:
        return

    if args.all:
        targets = available
    else:
        if args.layer not in available:
            print(f"\nLayer '{args.layer}' not found. Available: {available}")
            sys.exit(1)
        targets = [args.layer]

    results = []
    for layer in targets:
        try:
            results.append(
                convert_layer(gdb_path, layer, output_dir,
                              write_parquet=not args.no_parquet, s3_prefix=args.prefix)
            )
        except Exception as e:  # noqa: BLE001
            print(f"   ERROR converting {layer}: {e}")
            results.append({"layer": layer, "status": "error", "error": str(e)})

    write_manifest(output_dir, results, gdb_path)

    converted_ok = [r for r in results if r.get("status") == "ok"]
    if args.upload:
        if not args.bucket:
            print("\n--upload requires --bucket")
            sys.exit(1)
        if not converted_ok:
            print("\nNothing converted successfully; skipping upload.")
        else:
            upload_to_s3(output_dir, args.bucket, args.prefix)

    print(f"\nDone. {len(converted_ok)}/{len(targets)} layer(s) converted into {output_dir}")


if __name__ == "__main__":
    main()
