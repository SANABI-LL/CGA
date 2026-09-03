#!/usr/bin/env python3
"""
join_subarea_to_buildings.py
============================
ETL: pre-compute SubArea for each campus building by centroid-in-polygon test,
then write the result back to S3.

After this runs, `query_building_attributes(field="subarea", operator="=", value="B")`
works as a fast attribute-based alternative to the spatial_query tool.

Usage:
    python scripts/join_subarea_to_buildings.py [--dry-run]

Requires:
    pip install boto3 shapely
    OR run inside ArcGIS Pro conda env (has shapely via geopandas)

AWS profile: GIS (same as all other CampusGeo ETL scripts)
"""

import json
import sys
import argparse
import boto3
from botocore.exceptions import ClientError

BUCKET = 'campusgeo-geodata-491117467175'
BUILDINGS_KEY = 'layers/buildings.geojson'
SUBAREA_KEY   = 'layers/Subarea.geojson'

# ── point-in-polygon (ray casting) ──────────────────────────────────────────

def point_in_ring(px, py, ring):
    """Ray-casting test: is (px, py) inside ring (list of [lng, lat] pairs)?"""
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        if (yi > py) != (yj > py):
            if px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                inside = not inside
        j = i
    return inside

def polygon_centroid(coordinates):
    """Average of exterior ring coordinates → approximate centroid."""
    if not coordinates or not coordinates[0]:
        return None
    ring = coordinates[0]
    lng = sum(c[0] for c in ring) / len(ring)
    lat = sum(c[1] for c in ring) / len(ring)
    return lng, lat

def feature_centroid(geom):
    """Return (lng, lat) centroid for any geometry type."""
    t = geom['type']
    if t == 'Point':
        c = geom.get('coordinates', [])
        return (c[0], c[1]) if len(c) >= 2 else None
    if t == 'Polygon':
        return polygon_centroid(geom.get('coordinates', []))
    if t == 'MultiPolygon':
        coords = geom.get('coordinates', [])
        return polygon_centroid(coords[0]) if coords else None
    if t == 'LineString':
        coords = geom.get('coordinates', [])
        if not coords:
            return None
        mid = coords[len(coords) // 2]
        return mid[0], mid[1]
    return None

def centroid_in_polygon(geom, poly_rings_list):
    """Test building geometry centroid against list of polygon ring sets."""
    c = feature_centroid(geom)
    if c is None:
        return None
    cx, cy = c
    for rings in poly_rings_list:
        if point_in_ring(cx, cy, rings[0]):  # exterior ring
            return True
    return False

# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true',
                        help='Print stats but do not upload to S3')
    args = parser.parse_args()

    s3 = boto3.Session(profile_name='GIS').client('s3', region_name='us-east-1')

    # Download both layers
    print(f'Downloading {BUILDINGS_KEY} …', flush=True)
    buildings_gj = json.loads(s3.get_object(Bucket=BUCKET, Key=BUILDINGS_KEY)['Body'].read())
    print(f'Downloading {SUBAREA_KEY} …', flush=True)
    subarea_gj = json.loads(s3.get_object(Bucket=BUCKET, Key=SUBAREA_KEY)['Body'].read())

    buildings = buildings_gj.get('features', [])
    subareas  = subarea_gj.get('features', [])
    print(f'Buildings: {len(buildings)}, Subareas: {len(subareas)}')

    # Build subarea lookup: letter → list of polygon ring sets
    subarea_polygons = {}
    for f in subareas:
        letter = f.get('properties', {}).get('SubArea')
        if not letter:
            continue
        geom = f.get('geometry', {})
        rings_list = []
        if geom['type'] == 'Polygon':
            rings_list.append(geom['coordinates'])
        elif geom['type'] == 'MultiPolygon':
            rings_list.extend(geom['coordinates'])
        if letter not in subarea_polygons:
            subarea_polygons[letter] = []
        subarea_polygons[letter].extend(rings_list)

    print(f'Subareas loaded: {sorted(subarea_polygons.keys())}')

    # Assign SubArea to each building
    counts = {'assigned': 0, 'no_match': 0, 'no_geom': 0}
    for f in buildings:
        geom = f.get('geometry')
        if not geom:
            f.setdefault('properties', {})['SubArea'] = None
            counts['no_geom'] += 1
            continue

        assigned = None
        for letter, rings_list in subarea_polygons.items():
            if centroid_in_polygon(geom, rings_list):
                assigned = letter
                break

        f['properties']['SubArea'] = assigned
        if assigned:
            counts['assigned'] += 1
        else:
            counts['no_match'] += 1

    total = len(buildings)
    print(f'\nResults: {counts["assigned"]}/{total} assigned, '
          f'{counts["no_match"]} outside all subareas, '
          f'{counts["no_geom"]} missing geometry')

    # Sample check
    for f in buildings[:3]:
        name = f['properties'].get('DISCRIPT1', '?')
        sa   = f['properties'].get('SubArea', '?')
        print(f'  {name} → SubArea={sa}')

    if args.dry_run:
        print('\n[DRY-RUN] Not uploading to S3.')
        return

    updated = json.dumps(buildings_gj, separators=(',', ':'))
    s3.put_object(
        Bucket=BUCKET,
        Key=BUILDINGS_KEY,
        Body=updated.encode(),
        ContentType='application/geo+json',
    )
    print(f'\nUploaded {len(updated):,} bytes → s3://{BUCKET}/{BUILDINGS_KEY}')
    print('Done. Run the nightly digest or invalidate CloudFront to propagate.')

if __name__ == '__main__':
    main()
