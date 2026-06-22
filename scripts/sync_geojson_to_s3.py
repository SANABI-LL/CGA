#!/usr/bin/env python3
"""
CampusGeo GeoJSON S3 Sync Script
===================================
自动同步 GeoJSON 文件到 S3，并更新 DynamoDB 元数据

功能：
1. 检测本地 GeoJSON 文件变化
2. 上传到 S3（仅上传变化的文件）
3. 更新 DynamoDB 图层元数据表
4. 生成上传报告

使用：
    python scripts/sync_geojson_to_s3.py
    python scripts/sync_geojson_to_s3.py --force  # 强制上传所有文件
    python scripts/sync_geojson_to_s3.py --dry-run  # 预览，不实际上传
"""

import json
import os
import hashlib
import sys
from pathlib import Path
from datetime import datetime
import boto3
from botocore.exceptions import ClientError

# 配置
BUCKET_NAME = 'campusgeo-geodata-491117467175'
REGION = 'us-east-1'
SOURCE_DIR = 'gis_output/geojson'
METADATA_FILE = 'gis_output/core_layers.json'
DYNAMODB_TABLE = 'campusgeo-geojson-layers'

# 初始化 AWS 客户端
s3_client = boto3.client('s3', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table = dynamodb.Table(DYNAMODB_TABLE)


def calculate_md5(file_path):
    """计算文件 MD5 哈希"""
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def get_s3_etag(bucket, key):
    """获取 S3 文件的 ETag（相当于 MD5）"""
    try:
        response = s3_client.head_object(Bucket=bucket, Key=key)
        return response['ETag'].strip('"')
    except ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None
        raise


def needs_upload(local_path, s3_key):
    """检查文件是否需要上传"""
    local_md5 = calculate_md5(local_path)
    s3_etag = get_s3_etag(BUCKET_NAME, s3_key)

    if s3_etag is None:
        return True, "new"
    elif local_md5 != s3_etag:
        return True, "modified"
    else:
        return False, "unchanged"


def upload_file(local_path, s3_key, dry_run=False):
    """上传单个文件到 S3"""
    file_size = os.path.getsize(local_path)

    if dry_run:
        print(f"  [DRY-RUN] Would upload: {local_path} -> s3://{BUCKET_NAME}/{s3_key}")
        return True

    try:
        s3_client.upload_file(
            local_path,
            BUCKET_NAME,
            s3_key,
            ExtraArgs={
                'ContentType': 'application/geo+json',
                'Metadata': {
                    'uploaded_at': datetime.utcnow().isoformat(),
                    'source_file': os.path.basename(local_path)
                }
            }
        )
        print(f"  ✓ Uploaded: {s3_key} ({file_size / 1024 / 1024:.2f} MB)")
        return True
    except Exception as e:
        print(f"  ✗ Failed: {s3_key} - {str(e)}")
        return False


def update_dynamodb_metadata(layer_id, metadata, dry_run=False):
    """更新 DynamoDB 图层元数据"""
    if dry_run:
        print(f"  [DRY-RUN] Would update DynamoDB: {layer_id}")
        return True

    try:
        table.put_item(Item={
            'layerId': layer_id,
            'category': metadata.get('category', 'Unknown'),
            'priority': metadata.get('priority', 99),
            'sourceFile': metadata.get('sourceFile', ''),
            'description': metadata.get('description', ''),
            'lastUpdated': datetime.utcnow().isoformat(),
            's3Key': f"layers/{layer_id}.geojson"
        })
        print(f"  ✓ Updated metadata: {layer_id}")
        return True
    except Exception as e:
        print(f"  ✗ Failed metadata update: {layer_id} - {str(e)}")
        return False


def load_metadata_mapping():
    """加载元数据映射"""
    if not os.path.exists(METADATA_FILE):
        print(f"Warning: Metadata file not found: {METADATA_FILE}")
        return {}

    with open(METADATA_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    # 创建 sourceFile -> layer 的映射
    mapping = {}
    for layer in data.get('layers', []):
        source = layer.get('sourceFile', '')
        if source:
            mapping[source] = layer

    return mapping


def main():
    """主函数"""
    import argparse

    parser = argparse.ArgumentParser(description='Sync GeoJSON files to S3')
    parser.add_argument('--force', action='store_true', help='Force upload all files')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without uploading')
    args = parser.parse_args()

    print("=" * 60)
    print("CampusGeo GeoJSON S3 Sync")
    print("=" * 60)
    print(f"Bucket:   {BUCKET_NAME}")
    print(f"Region:   {REGION}")
    print(f"Source:   {SOURCE_DIR}")
    print(f"Mode:     {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)
    print()

    # 加载元数据
    metadata_map = load_metadata_mapping()

    # 扫描本地文件
    source_path = Path(SOURCE_DIR)
    if not source_path.exists():
        print(f"Error: Source directory not found: {SOURCE_DIR}")
        return 1

    geojson_files = list(source_path.glob('*.geojson'))
    print(f"Found {len(geojson_files)} GeoJSON files\n")

    # 统计
    stats = {'uploaded': 0, 'skipped': 0, 'failed': 0}

    # 处理每个文件
    for file_path in geojson_files:
        file_name = file_path.name
        print(f"Processing: {file_name}")

        # 确定 S3 key（简化文件名）
        simple_name = file_name.replace('_', '-').lower()
        # 特殊映射
        name_map = {
            'building-information-2026.geojson': 'buildings.geojson',
            'campus-building-footprint.geojson': 'building-footprints.geojson',
            'cafe--market--restaurant-and-dining-hall.geojson': 'dining.geojson',
            'main-quad-tree-infor-project.geojson': 'trees.geojson',
            'all-gender-restroom.geojson': 'restrooms.geojson',
        }
        s3_key = f"layers/{name_map.get(simple_name, simple_name)}"

        # 检查是否需要上传
        if not args.force:
            should_upload, status = needs_upload(str(file_path), s3_key)
            if not should_upload:
                print(f"  ⊘ Skipped: {status}")
                stats['skipped'] += 1
                continue
            else:
                print(f"  → Status: {status}")

        # 上传文件
        if upload_file(str(file_path), s3_key, args.dry_run):
            stats['uploaded'] += 1

            # 更新元数据
            layer_id = Path(s3_key).stem
            if file_name in metadata_map:
                update_dynamodb_metadata(layer_id, metadata_map[file_name], args.dry_run)
        else:
            stats['failed'] += 1

        print()

    # 输出报告
    print("=" * 60)
    print("Summary")
    print("=" * 60)
    print(f"Uploaded:  {stats['uploaded']}")
    print(f"Skipped:   {stats['skipped']}")
    print(f"Failed:    {stats['failed']}")
    print("=" * 60)

    if not args.dry_run and stats['uploaded'] > 0:
        print("\nView uploaded files:")
        print(f"https://s3.console.aws.amazon.com/s3/buckets/{BUCKET_NAME}?region={REGION}&prefix=layers/")

    return 0 if stats['failed'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
