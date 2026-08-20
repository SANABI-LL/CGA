#!/usr/bin/env python3
"""
export_webmap_layers.py — export ArcGIS WebMap layers to S3 as GeoJSON.

Fetches the WebMap item JSON to discover all FeatureLayers, then queries
each FeatureServer endpoint (paginated) and uploads to S3.  Existing files
are NEVER overwritten: a hard-coded protection set plus an S3 HEAD check
both gate every upload.

Usage:
  python scripts/export_webmap_layers.py [--dry-run]
  python scripts/export_webmap_layers.py [--webmap WEBMAP_ID]
  python scripts/export_webmap_layers.py [--token YOUR_ARCGIS_TOKEN]
  python scripts/export_webmap_layers.py [--force LAYER_KEY]   # bypass S3 HEAD (not protection set)
  python scripts/export_webmap_layers.py [--profile AWS_PROFILE]
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone

import boto3
import requests
from botocore.exceptions import ClientError

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WEBMAP_ID   = '012f41f00d584e6f891d65a400b6b66e'
BUCKET      = 'campusgeo-geodata-491117467175'
PREFIX      = 'layers/'
REGION      = 'us-east-1'

WEBMAP_URL_TMPL = (
    'https://www.arcgis.com/sharing/rest/content/items/{webmap_id}/data?f=json'
)

PAGE_SIZE   = 1000   # ArcGIS default max; some services cap at 500 or 2000
TIMEOUT_S   = 30

# ---------------------------------------------------------------------------
# NO DELETE: this script only adds new objects to S3.
# It never deletes, truncates, or clears any existing S3 object.
# Overwrite protection is enforced by two independent gates:
#   1. NEVER_OVERWRITE hard-coded set (cannot be bypassed by any flag)
#   2. S3 HEAD check (bypassed only with --force KEY, still respects gate 1)
# ---------------------------------------------------------------------------

# Layers too large for Lambda to serve efficiently — skip on export.
SKIP_TOO_LARGE: set[str] = {
    'curbs.geojson',         # 168,900 features, 156 MB (Chicago-wide curb data)
    'city_building.geojson', # 16,476 features,  21 MB (Chicago-wide building footprints)
}

# Files that must never be overwritten, regardless of any flag.
# The utility_ prefix check is handled separately in code.
#
# NOTE: bike_racks.geojson is intentionally stored under that key (not the
# WebMap title "Existing Bike Rack" → existing_bike_rack.geojson).
# existing_bike_rack.geojson is also protected to avoid duplicate uploads.
NEVER_OVERWRITE: set[str] = {
    'buildings.geojson',
    'trees.geojson',
    'bike_racks.geojson',          # canonical key; WebMap title = "Existing Bike Rack"
    'existing_bike_rack.geojson',  # same data — block redundant upload
    'parking.geojson',
    'all-gender-restrooms.geojson',
    'leed-buildings.geojson',
    'Cafe__Market__Restaurant_and_Dining_Hall.geojson',
    'manifest.json',
    'emergency_phone.geojson',     # canonical key; WebMap title = "Emergency Phone"
}

HEADERS = {
    'User-Agent': 'CampusGeo-export/1.0 (academic research)',
    'Accept': 'application/json',
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def title_to_s3_key(title: str) -> str:
    """Convert a layer title to a snake_case S3 filename."""
    key = title.lower()
    key = re.sub(r'[^a-z0-9 _-]', '', key)
    key = re.sub(r'[\s_]+', '_', key.strip())
    key = key.strip('_-')
    return key + '.geojson'


def is_protected(key: str) -> tuple[bool, str]:
    """Return (should_skip, reason)."""
    if key in NEVER_OVERWRITE:
        return True, 'PROTECTED'
    if key.startswith('utility_'):
        return True, 'PROTECTED'
    if key in SKIP_TOO_LARGE:
        return True, 'TOO_LARGE'
    return False, ''


def s3_key_exists(s3, bucket: str, full_key: str) -> bool:
    try:
        s3.head_object(Bucket=bucket, Key=full_key)
        return True
    except ClientError as exc:
        if exc.response['Error']['Code'] in ('404', 'NoSuchKey'):
            return False
        raise


# ---------------------------------------------------------------------------
# ArcGIS helpers
# ---------------------------------------------------------------------------

def fetch_webmap_layers(webmap_id: str, token: str | None) -> list[dict]:
    """Return flat list of FeatureLayer dicts from a WebMap item."""
    url = WEBMAP_URL_TMPL.format(webmap_id=webmap_id)
    params: dict = {}
    if token:
        params['token'] = token

    resp = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT_S)
    resp.raise_for_status()
    data = resp.json()

    if 'error' in data:
        code = data['error'].get('code', '?')
        msg  = data['error'].get('message', '')
        raise RuntimeError(f'ArcGIS API error {code}: {msg}')

    raw_layers = data.get('operationalLayers', [])
    return _flatten_layers(raw_layers)


def _flatten_layers(layers: list[dict]) -> list[dict]:
    """Recursively flatten GroupLayers; keep only ArcGISFeatureLayer items."""
    result: list[dict] = []
    for layer in layers:
        ltype = layer.get('layerType', '')
        if ltype == 'GroupLayer':
            result.extend(_flatten_layers(layer.get('layers', [])))
        elif ltype == 'ArcGISFeatureLayer' and layer.get('url'):
            result.append(layer)
        # MapServiceLayer, TileLayer, etc. — skip silently
    return result


def fetch_all_features(layer_url: str, token: str | None) -> list[dict]:
    """Page through a FeatureServer layer and return all features."""
    features: list[dict] = []
    offset = 0

    while True:
        params: dict = {
            'where': '1=1',
            'outFields': '*',
            'f': 'geojson',
            'outSR': '4326',
            'returnGeometry': 'true',
            'resultOffset': offset,
            'resultRecordCount': PAGE_SIZE,
        }
        if token:
            params['token'] = token

        resp = requests.get(
            f'{layer_url.rstrip("/")}/query',
            params=params,
            headers=HEADERS,
            timeout=TIMEOUT_S,
        )
        resp.raise_for_status()
        data = resp.json()

        if 'error' in data:
            code = data['error'].get('code', '?')
            msg  = data['error'].get('message', '')
            raise RuntimeError(f'FeatureServer error {code}: {msg}')

        page = data.get('features', [])
        features.extend(page)

        exceeded = data.get('exceededTransferLimit', False)
        if len(page) < PAGE_SIZE and not exceeded:
            break
        if not page:
            break

        offset += len(page)
        time.sleep(0.1)   # polite pause between pages

    return features


def upload_to_s3(s3, bucket: str, full_key: str, features: list[dict], dry_run: bool) -> None:
    fc = {
        'type': 'FeatureCollection',
        'features': features,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
    }
    body = json.dumps(fc, separators=(',', ':'))

    if dry_run:
        kb = len(body) / 1024
        print(f'  DRY-RUN  -> s3://{bucket}/{full_key}  ({len(features)} features, {kb:.0f} KB)')
        return

    s3.put_object(
        Bucket=bucket,
        Key=full_key,
        Body=body.encode('utf-8'),
        ContentType='application/geo+json',
        Metadata={'exported_at': datetime.now(timezone.utc).isoformat()},
    )
    kb = len(body) / 1024
    print(f'  UPLOADED -> s3://{bucket}/{full_key}  ({len(features)} features, {kb:.0f} KB)')


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description='Export new ArcGIS WebMap layers to S3 as GeoJSON (no overwrites).',
    )
    parser.add_argument('--webmap',   default=WEBMAP_ID,  help='ArcGIS WebMap item ID')
    parser.add_argument('--token',    default=None,       help='ArcGIS token (if WebMap is not public)')
    parser.add_argument('--profile',  default='GIS',      help='AWS profile name (default: GIS)')
    parser.add_argument('--dry-run',  action='store_true', help='Print actions without uploading')
    parser.add_argument('--force',    default=None,       help='Skip S3 HEAD check for this key (still respects protection set)')
    args = parser.parse_args()

    print('=' * 65)
    print('CampusGeo  WebMap -> S3 GeoJSON Export')
    print('=' * 65)
    print(f'WebMap:   {args.webmap}')
    print(f'Bucket:   {BUCKET}')
    print(f'Profile:  {args.profile}')
    print(f'Mode:     {"DRY-RUN" if args.dry_run else "LIVE"}')
    print('=' * 65)

    # AWS client
    session = boto3.Session(profile_name=args.profile)
    s3 = session.client('s3', region_name=REGION)

    # 1. Discover layers
    print('\nFetching WebMap layer list...')
    try:
        layers = fetch_webmap_layers(args.webmap, args.token)
    except Exception as exc:
        print(f'ERROR: could not fetch WebMap JSON: {exc}')
        print('Tip: if this WebMap is private, pass --token YOUR_ARCGIS_TOKEN')
        return 1
    print(f'Found {len(layers)} FeatureLayers\n')

    counts = {'new': 0, 'skip_exists': 0, 'protected': 0, 'too_large': 0, 'error': 0}

    for layer in layers:
        title = layer.get('title', 'untitled')
        url   = layer.get('url', '')
        key   = title_to_s3_key(title)
        full  = PREFIX + key

        # --- protection / size check (hard gate, cannot be bypassed) ---
        skip, reason = is_protected(key)
        if skip:
            print(f'{reason:<10} {key!r}  ({title!r})')
            if reason == 'TOO_LARGE':
                counts['too_large'] += 1
            else:
                counts['protected'] += 1
            continue

        # --- S3 existence check (can be bypassed with --force KEY) ---
        if key != args.force:
            try:
                if s3_key_exists(s3, BUCKET, full):
                    print(f'SKIP       {key!r}  (already exists in S3)')
                    counts['skip_exists'] += 1
                    continue
            except Exception as exc:
                print(f'WARNING    {key!r}: S3 HEAD failed ({exc}), skipping as safety measure')
                counts['skip_exists'] += 1
                continue

        # --- fetch features ---
        print(f'FETCH      {key!r}  <- {url}')
        try:
            features = fetch_all_features(url, args.token)
        except Exception as exc:
            print(f'  ERROR: {exc}')
            counts['error'] += 1
            continue

        # --- upload ---
        try:
            upload_to_s3(s3, BUCKET, full, features, args.dry_run)
            counts['new'] += 1
        except Exception as exc:
            print(f'  ERROR uploading: {exc}')
            counts['error'] += 1

    print()
    print('=' * 65)
    print('Summary')
    print('=' * 65)
    print(f"  Uploaded:  {counts['new']}")
    print(f"  Skipped (too large): {counts['too_large']}")
    print(f"  Skipped (exists): {counts['skip_exists']}")
    print(f"  Protected: {counts['protected']}")
    print(f"  Errors:    {counts['error']}")
    print('=' * 65)

    if not args.dry_run and counts['new'] > 0:
        print(f'\nView: https://s3.console.aws.amazon.com/s3/buckets/{BUCKET}?prefix={PREFIX}')

    return 0 if counts['error'] == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
