"""
Fetch Steam Tunnel historical layers from ArcGIS Feature Server and upload to S3.

Layers:
  25 → Steam Tunnel_1901     → utility_steam_tunnel_1901.geojson
  24 → Steam Tunnel_1931     → utility_steam_tunnel_1931.geojson
  23 → Steam Tunnel_1984     → utility_steam_tunnel_1984.geojson
  22 → Steam Tunnel_2000-2011 → utility_steam_tunnel_2000_2011.geojson
"""

import json
import urllib.request
import boto3
import sys

BUCKET = "campusgeo-geodata-491117467175"
PROFILE = "GIS"
REGION = "us-east-1"
BASE_URL = "https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services/JULY_2021_Campus_GIS_Web_Map_WFL1/FeatureServer"

LAYERS = [
    (25, "utility_steam_tunnel_1901"),
    (24, "utility_steam_tunnel_1931"),
    (23, "utility_steam_tunnel_1984"),
    (22, "utility_steam_tunnel_2000_2011"),
]

QUERY_PARAMS = "where=1%3D1&outFields=*&f=geojson&outSR=4326"


def fetch_geojson(layer_id: int) -> dict:
    url = f"{BASE_URL}/{layer_id}/query?{QUERY_PARAMS}"
    print(f"  Fetching {url}")
    with urllib.request.urlopen(url, timeout=30) as resp:
        return json.loads(resp.read().decode())


def main():
    session = boto3.Session(profile_name=PROFILE, region_name=REGION)
    s3 = session.client("s3")

    for layer_id, s3_name in LAYERS:
        print(f"\n[Layer {layer_id}] -> {s3_name}.geojson")
        try:
            geojson = fetch_geojson(layer_id)
        except Exception as e:
            print(f"  ERROR fetching: {e}", file=sys.stderr)
            continue

        feature_count = len(geojson.get("features", []))
        print(f"  Features: {feature_count}")

        body = json.dumps(geojson, separators=(",", ":")).encode()
        key = f"layers/{s3_name}.geojson"
        s3.put_object(
            Bucket=BUCKET,
            Key=key,
            Body=body,
            ContentType="application/geo+json",
        )
        print(f"  Uploaded s3://{BUCKET}/{key}  ({len(body):,} bytes)")

    print("\nDone.")


if __name__ == "__main__":
    main()
