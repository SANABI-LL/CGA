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
    args = parser.parse_args()

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

    output_dir = Path(args.output)
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
