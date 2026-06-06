#!/usr/bin/env python3
"""
convert_metadata_to_dynamodb.py
将 layers_metadata.json 转换为 DynamoDB batch-write-item 格式。

Usage:
    python scripts/convert_metadata_to_dynamodb.py

Output:
    gis_output/dynamodb_batch_import.json
"""

import json
from pathlib import Path


def json_to_dynamodb_type(value):
    """将 Python 值转换为 DynamoDB 类型标注格式。"""
    if value is None:
        return {"NULL": True}
    elif isinstance(value, bool):
        return {"BOOL": value}
    elif isinstance(value, int):
        return {"N": str(value)}
    elif isinstance(value, float):
        return {"N": str(value)}
    elif isinstance(value, str):
        return {"S": value}
    elif isinstance(value, list):
        # 数组类型
        if not value:
            return {"L": []}
        # 检查是否为数字数组
        if all(isinstance(v, (int, float)) for v in value):
            return {"L": [{"N": str(v)} for v in value]}
        # 字符串数组
        if all(isinstance(v, str) for v in value):
            return {"L": [{"S": v} for v in value]}
        # 混合类型数组
        return {"L": [json_to_dynamodb_type(v) for v in value]}
    elif isinstance(value, dict):
        # Map 类型
        return {"M": {k: json_to_dynamodb_type(v) for k, v in value.items()}}
    else:
        return {"S": str(value)}


def convert_metadata_to_dynamodb(metadata_path: Path, table_name: str = "campusgeo-geojson-layers") -> dict:
    """
    转换元数据为 DynamoDB batch-write 格式。

    Args:
        metadata_path: layers_metadata.json 路径
        table_name: DynamoDB 表名

    Returns:
        DynamoDB batch-write-item 请求体
    """
    with open(metadata_path, "r", encoding="utf-8") as f:
        metadata_list = json.load(f)

    put_requests = []
    for item in metadata_list:
        # 转换为 DynamoDB Item 格式
        dynamodb_item = {}
        for key, value in item.items():
            dynamodb_item[key] = json_to_dynamodb_type(value)

        put_requests.append({"PutRequest": {"Item": dynamodb_item}})

    return {table_name: put_requests}


def main():
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    metadata_path = project_root / "gis_output" / "layers_metadata.json"
    output_path = project_root / "gis_output" / "dynamodb_batch_import.json"

    if not metadata_path.exists():
        print(f"ERROR: {metadata_path} not found")
        print("Run: python convert_gdb.py --generate-metadata")
        return 1

    print(f"Converting {metadata_path}...")
    batch_request = convert_metadata_to_dynamodb(metadata_path)

    table_name = list(batch_request.keys())[0]
    item_count = len(batch_request[table_name])

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(batch_request, f, indent=2, ensure_ascii=False)

    print(f"Generated {output_path}")
    print(f"  {item_count} items ready for DynamoDB table '{table_name}'")
    print(f"\nTo import:")
    print(f"  aws dynamodb batch-write-item --request-items file://{output_path.name}")

    return 0


if __name__ == "__main__":
    exit(main())
