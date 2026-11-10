#!/usr/bin/env python3
"""
etl_shuttle_passiogo.py — export UChicago shuttle stops and routes from Passio GO
to S3 as GeoJSON layers.

Usage:
  python scripts/etl_shuttle_passiogo.py [--dry-run]

Writes:
  s3://{BUCKET}/layers/shuttle_stops.geojson   — Point, one per physical stop
  s3://{BUCKET}/layers/shuttle_routes.geojson  — LineString, one per active route

Run this weekly (or after major schedule changes) to keep the static layers fresh.
The get_shuttle_arrivals Lambda tool falls back to the live Passio GO API if these
files are absent, so missing them is not a hard failure.
"""

import argparse
import json
import urllib.request
import boto3
import sys

PASSIO_BASE = 'https://passiogo.com'
SYSTEM_ID = '1068'
BUCKET = 'campusgeo-geodata-491117467175'
PREFIX = 'layers/'
AWS_PROFILE = 'GIS'


def post_json(path: str, payload: dict) -> object:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        PASSIO_BASE + path, data=data,
        headers={'Content-Type': 'application/json', 'User-Agent': 'CampusGeo-ETL/1.0'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def fetch_stops_and_routes() -> tuple[dict, dict]:
    """Returns (stops_raw, routes_raw)."""
    stops_raw = post_json('/mapGetData.php?getStops=2', {'s0': SYSTEM_ID, 'sA': 1})
    routes_raw = post_json('/mapGetData.php?getRoutes=1', {'systemSelected0': SYSTEM_ID, 'amount': 1})
    return stops_raw, routes_raw


def build_stops_geojson(stops_raw: dict) -> dict:
    """
    Deduplicate stops by stopId. A stop can appear multiple times in the API
    response (once per route that serves it). Merge their routeIds/routeNames.
    """
    stops_dict = stops_raw.get('stops', {})
    merged: dict[str, dict] = {}

    for entry in stops_dict.values():
        stop_id = str(entry.get('stopId', ''))
        if not stop_id:
            continue
        if stop_id not in merged:
            merged[stop_id] = {
                'StopId': stop_id,
                'Name': str(entry.get('name', '')),
                'RouteId': str(entry.get('routeId', '')),
                'RouteName': str(entry.get('routeName', '')),
                'RouteShortName': str(entry.get('routeShortname', '')),
                'lat': float(entry.get('latitude', 0)),
                'lon': float(entry.get('longitude', 0)),
                # For stops served by multiple routes: accumulate
                '_route_ids': [str(entry.get('routeId', ''))],
                '_route_names': [str(entry.get('routeName', ''))],
            }
        else:
            rid = str(entry.get('routeId', ''))
            if rid and rid not in merged[stop_id]['_route_ids']:
                merged[stop_id]['_route_ids'].append(rid)
                merged[stop_id]['_route_names'].append(str(entry.get('routeName', '')))

    features = []
    for s in merged.values():
        if not s['lat'] and not s['lon']:
            continue
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [s['lon'], s['lat']]},
            'properties': {
                'StopId': s['StopId'],
                'Name': s['Name'],
                'RouteId': s['RouteId'],
                'RouteName': s['RouteName'],
                'RouteShortName': s['RouteShortName'],
                'AllRouteIds': ','.join(s['_route_ids']),
                'AllRouteNames': ','.join(s['_route_names']),
            },
        })

    print(f"  Stops: {len(features)} unique physical stops")
    return {'type': 'FeatureCollection', 'features': features}


def build_routes_geojson(routes_raw: list, stops_raw: dict) -> dict:
    """
    Build route LineStrings from routePoints in the stops response.
    routePoints is a dict of {routeId: [[lon, lat], ...]} (or similar).
    Falls back to route metadata only (no geometry) if routePoints is absent.
    """
    route_points = stops_raw.get('routePoints', {})

    # Filter to active routes (archive == '0')
    active_routes = [r for r in (routes_raw if isinstance(routes_raw, list) else [])
                     if str(r.get('archive', '1')) == '0']

    # Build a lookup from route id → route metadata
    route_meta: dict[str, dict] = {}
    for r in active_routes:
        rid = str(r.get('id', r.get('myid', '')))
        route_meta[rid] = r

    features = []
    for rid, points in route_points.items():
        meta = route_meta.get(str(rid), {})
        # routePoints values may be a list of [lat, lon] or list of {lat, lng}
        coords = []
        if isinstance(points, list):
            # routePoints format: [[{lat, lng}, ...], ...]  (list of segments)
            for segment in points:
                if isinstance(segment, list):
                    for p in segment:
                        if isinstance(p, dict):
                            lat = p.get('lat', p.get('latitude', 0))
                            lon = p.get('lng', p.get('longitude', 0))
                            if lat and lon:
                                coords.append([float(lon), float(lat)])
                elif isinstance(segment, dict):
                    lat = segment.get('lat', segment.get('latitude', 0))
                    lon = segment.get('lng', segment.get('longitude', 0))
                    if lat and lon:
                        coords.append([float(lon), float(lat)])

        if len(coords) < 2:
            continue

        features.append({
            'type': 'Feature',
            'geometry': {'type': 'LineString', 'coordinates': coords},
            'properties': {
                'RouteId': str(rid),
                'Name': str(meta.get('name', rid)),
                'ShortName': str(meta.get('shortName', '')),
                'Color': str(meta.get('groupColor', meta.get('color', '#843c39'))),
            },
        })

    # Add routes that have no polyline (just as metadata features with null geometry)
    for rid, meta in route_meta.items():
        if not any(f['properties']['RouteId'] == rid for f in features):
            features.append({
                'type': 'Feature',
                'geometry': None,
                'properties': {
                    'RouteId': rid,
                    'Name': str(meta.get('name', rid)),
                    'ShortName': str(meta.get('shortName', '')),
                    'Color': str(meta.get('groupColor', meta.get('color', '#843c39'))),
                },
            })

    print(f"  Routes: {len(features)} ({sum(1 for f in features if f['geometry'])} with geometry)")
    return {'type': 'FeatureCollection', 'features': features}


def upload_layer(s3_client, key: str, fc: dict, dry_run: bool) -> None:
    body = json.dumps(fc, separators=(',', ':')).encode()
    size = len(body)
    full_key = PREFIX + key
    if dry_run:
        print(f"  [DRY-RUN] would upload {full_key} ({size:,} bytes, {len(fc['features'])} features)")
        return
    s3_client.put_object(
        Bucket=BUCKET,
        Key=full_key,
        Body=body,
        ContentType='application/geo+json',
    )
    print(f"  Uploaded {full_key} ({size:,} bytes, {len(fc['features'])} features)")


def main() -> None:
    parser = argparse.ArgumentParser(description='Export Passio GO shuttle data to S3')
    parser.add_argument('--dry-run', action='store_true', help='Print what would be uploaded without uploading')
    args = parser.parse_args()

    print('Fetching Passio GO data ...')
    try:
        stops_raw, routes_raw = fetch_stops_and_routes()
    except Exception as e:
        print(f'ERROR: could not fetch Passio GO data: {e}', file=sys.stderr)
        sys.exit(1)

    stops_fc = build_stops_geojson(stops_raw)
    routes_fc = build_routes_geojson(routes_raw, stops_raw)

    session = boto3.Session(profile_name=AWS_PROFILE)
    s3 = session.client('s3', region_name='us-east-1')

    print('Uploading to S3 ...')
    upload_layer(s3, 'shuttle_stops.geojson', stops_fc, args.dry_run)
    upload_layer(s3, 'shuttle_routes.geojson', routes_fc, args.dry_run)
    print('Done.')


if __name__ == '__main__':
    main()
