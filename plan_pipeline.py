#!/usr/bin/env python3
"""
plan_pipeline.py — CAD floor-plan (.dxf) → georeferenced GeoJSON

Usage:
    python plan_pipeline.py uploads/A06_01.dxf
    python plan_pipeline.py uploads/A06_01.dxf uploads/A06_02.dxf
    python plan_pipeline.py uploads/A06_01.dxf --dry-run
    python plan_pipeline.py uploads/A06_01.dxf --upload --bucket campusgeo-geodata-491117467175 --profile GIS
    python plan_pipeline.py uploads/A06_01.dxf --force-transform

Input convention:
    uploads/{BD_ID}_{floor}.dxf  (e.g. uploads/A06_01.dxf)
    BD_ID must match BD_ID property in buildings.geojson.

Output:
    plans/{BD_ID}/transform.json          (one per building, computed from GROS$)
    plans/{BD_ID}/{floor}.geojson         (linework FeatureCollection)
    plans/{BD_ID}/{floor}.rooms.geojson   (room polygons + attributes)
    plans/{BD_ID}/{floor}.gross.geojson   (building outline, single polygon)
    plans/index.json                       (which buildings have plans)

Environment:
    Run inside the ArcGIS Pro conda env (has shapely, pyproj, numpy).
    Install ezdxf separately: pip install ezdxf
"""

import argparse
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

try:
    import ezdxf
    from ezdxf.path import make_path
except ImportError:
    sys.exit("ezdxf not found — run: pip install ezdxf")

try:
    from pyproj import Transformer
except ImportError:
    sys.exit("pyproj not found — run: pip install pyproj")

try:
    from shapely.geometry import LineString, MultiLineString, Point, Polygon, mapping, shape
    from shapely.ops import linemerge, nearest_points
except ImportError:
    sys.exit("shapely not found — run: pip install shapely")


# ---------------------------------------------------------------------------
# Layer classification
# ---------------------------------------------------------------------------

# Exact layer name → (cls, tier) or None (handled specially, not linework)
_EXACT: dict[str, Optional[tuple[str, str]]] = {
    'A-WALL':        ('wall',      'primary'),
    'A-Wall-Fill':   ('wall',      'primary'),
    'A-DOOR':        ('door',      'primary'),
    'A-GLAZ':        ('glazing',   'primary'),
    'A-Glaz-Mcut':   ('glazing',   'primary'),
    'A-FLOR-STRS':   ('stair',     'primary'),
    'A-Flor-Hral':   ('stair',     'primary'),
    'S-COLS':        ('structure', 'primary'),
    'S-Beam':        ('structure', 'primary'),
    'A-FURN':        ('furniture', 'detail'),
    'P-FIXT':        ('furniture', 'detail'),
    'A-FLOR-CASE':   ('furniture', 'detail'),
    'A-Flor-Eqpm':   ('furniture', 'detail'),
    'GROS$':         None,
    'RM$':           None,
    'RM$TXT':        None,
}

# Prefix matches (checked after exact match fails)
_PREFIX: list[tuple[str, str, str]] = [
    ('A-WALL',      'wall',      'primary'),
    ('A-DOOR',      'door',      'primary'),
    ('A-GLAZ',      'glazing',   'primary'),
    ('A-Glaz',      'glazing',   'primary'),
    ('A-FLOR',      'stair',     'primary'),
    ('A-Flor',      'stair',     'primary'),
    ('S-',          'structure', 'primary'),
    ('A-FURN',      'furniture', 'detail'),
    ('P-FIXT',      'furniture', 'detail'),
    ('A-FLOR-CASE', 'furniture', 'detail'),
    ('A-Flor-Eqpm', 'furniture', 'detail'),
]

_DROP_EXACT = frozenset({'MISC', 'C-SITE', 'DEFPOINTS', 'Defpoints', '0', 'VIEWPORT'})
_DROP_PREFIX = ('X-', '70', '71', '72', '73', 'C-SITE', 'VIEWPORT')


def classify_layer(name: str) -> Optional[tuple[str, str]] | str:
    """
    Return (cls, tier), 'drop' (discard entirely), or None (skip silently).
    """
    if name in _DROP_EXACT:
        return 'drop'
    for prefix in _DROP_PREFIX:
        if name.startswith(prefix):
            return 'drop'
    if name in _EXACT:
        return _EXACT[name]   # None → handled elsewhere; tuple → linework
    for prefix, cls, tier in _PREFIX:
        if name.upper().startswith(prefix.upper()):
            return (cls, tier)
    return ('other', 'secondary')


# ---------------------------------------------------------------------------
# DXF parsing
# ---------------------------------------------------------------------------

FLATTEN_DIST = 0.5   # inches — tolerance for ezdxf curve flattening


def _pts_from_entity(entity) -> list[tuple[float, float]]:
    """Return a list of (x, y) vertices in DXF units (inches for campus DXFs)."""
    try:
        p = make_path(entity)
        return [(v.x, v.y) for v in p.flattening(FLATTEN_DIST)]
    except Exception:
        pass
    dxf_type = entity.dxftype()
    if dxf_type == 'LINE':
        s, e = entity.dxf.start, entity.dxf.end
        return [(s.x, s.y), (e.x, e.y)]
    if dxf_type in ('LWPOLYLINE', 'POLYLINE'):
        pts = [(v[0], v[1]) for v in entity.get_points()]
        if entity.is_closed and pts and pts[0] != pts[-1]:
            pts.append(pts[0])
        return pts
    return []


def parse_dxf(filepath: str) -> dict:
    """
    Parse a DXF file and return structured data:
      gros        : list[(x,y)] in inches — GROS$ outline (closed)
      rooms       : list[dict(pts, insertion)] — RM$ polygons
      rm_texts    : list[dict(insertion, text)] — RM$TXT MTEXT labels
      linework    : dict[(layer, cls, tier) → list[list[(x,y)]]]
      unknown_layers : set[str]
    """
    doc = ezdxf.readfile(filepath)
    msp = doc.modelspace()

    # Explode all INSERT blocks into world coords
    for ent in list(msp.query('INSERT')):
        try:
            ent.explode()
        except Exception:
            pass

    result: dict = {
        'gros': None,
        'rooms': [],
        'rm_texts': [],
        'linework': {},
        'unknown_layers': set(),
    }

    for ent in msp:
        layer = getattr(ent.dxf, 'layer', '0') or '0'

        # ── Special layers (handled before classify) ─────────────────────
        if layer == 'GROS$':
            if ent.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
                pts = _pts_from_entity(ent)
                if len(pts) >= 3:
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    result['gros'] = pts
            continue

        if layer == 'RM$':
            if ent.dxftype() in ('LWPOLYLINE', 'POLYLINE'):
                pts = _pts_from_entity(ent)
                if len(pts) >= 3:
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    result['rooms'].append({'pts': pts, 'insertion': pts[0]})
            continue

        if layer == 'RM$TXT':
            if ent.dxftype() == 'MTEXT':
                ins = ent.dxf.insert
                result['rm_texts'].append({'insertion': (ins.x, ins.y), 'text': ent.text})
            elif ent.dxftype() == 'TEXT':
                ins = ent.dxf.insert
                result['rm_texts'].append({'insertion': (ins.x, ins.y), 'text': ent.dxf.text})
            continue

        # ── Classify ─────────────────────────────────────────────────────
        cls_result = classify_layer(layer)
        if cls_result == 'drop':
            continue
        if cls_result is None:
            continue

        cls, tier = cls_result

        # Log unknown layers that fell through to 'other'
        if cls == 'other':
            result['unknown_layers'].add(layer)

        pts = _pts_from_entity(ent)
        if len(pts) < 2:
            continue

        key = (layer, cls, tier)
        result['linework'].setdefault(key, []).append(pts)

    return result


# ---------------------------------------------------------------------------
# MTEXT parsing
# ---------------------------------------------------------------------------

_P_SEP = re.compile(r'\\[Pp]|\^M\^J|\^M|\^J|\r\n|\r|\n')
_FORMAT_CODES = re.compile(r'\\[^;]*;|[{}]')

# Synonym expansion for room-index tags ─────────────────────────────────────
_SYNONYM_MAP: list[tuple[re.Pattern, list[str]]] = [
    (re.compile(r'mother|lactation|nursing', re.I),
     ['mothers', 'lactation', 'nursing', 'nursing room', 'mothers room', 'lactation room']),
    (re.compile(r'^rrs[wmu]', re.I),
     ['restroom', 'bathroom', 'toilet', 'washroom']),
    (re.compile(r'restroom|bathroom|toilet|washroom', re.I),
     ['restroom', 'bathroom', 'toilet', 'washroom']),
    (re.compile(r'^el[-_]', re.I),
     ['elevator', 'lift']),
    (re.compile(r'^st[-_]', re.I),
     ['stair', 'stairs', 'stairwell']),
    (re.compile(r'classroom|lecture|seminar', re.I),
     ['classroom', 'lecture', 'seminar']),
    (re.compile(r'lab(?:oratory)?', re.I),
     ['lab', 'laboratory']),
    (re.compile(r'office', re.I),
     ['office']),
    (re.compile(r'study|reading room', re.I),
     ['study', 'reading', 'reading room']),
    (re.compile(r'kitchen|pantry|break room|lounge', re.I),
     ['kitchen', 'pantry', 'break room', 'lounge']),
    (re.compile(r'storage|janitor|mechanical|electrical|utility', re.I),
     ['storage', 'utility', 'back-of-house']),
]


def _expand_tags(room: str, use: str) -> list[str]:
    combined = f"{room} {use}"
    tags: list[str] = []
    for pattern, synonyms in _SYNONYM_MAP:
        if pattern.search(combined):
            for s in synonyms:
                if s not in tags:
                    tags.append(s)
    return tags


def parse_mtext(raw: str) -> dict:
    """
    Parse room MTEXT label: `{number}\\P-\\P{use}\\P{area_sf}`.
    Returns dict with keys: room, use, areaSf (float).
    """
    text = _FORMAT_CODES.sub('', raw)
    parts = [p.strip() for p in _P_SEP.split(text)]
    parts = [p for p in parts if p and p != '-']

    out: dict = {}
    if len(parts) >= 1:
        out['room'] = parts[0]
    if len(parts) >= 2:
        out['use'] = parts[1]
    if len(parts) >= 3:
        m = re.search(r'[\d]+(?:\.\d+)?', parts[2].replace(',', ''))
        if m:
            try:
                out['areaSf'] = float(m.group())
            except ValueError:
                pass
    return out


# ---------------------------------------------------------------------------
# Registration: align GROS$ to GIS footprint via PCA + ICP
# ---------------------------------------------------------------------------

EPSG_GIS   = 4326
EPSG_LOCAL = 3435    # Illinois East ftUS — feet, same as DXF after /12
FTUS_TO_M  = 0.3048006096012192


def _densify(pts: list[tuple[float, float]], spacing: float) -> np.ndarray:
    """Densify a polygon boundary at `spacing` units."""
    result = []
    for i in range(len(pts) - 1):
        p0, p1 = np.array(pts[i]), np.array(pts[i + 1])
        n = max(1, int(np.linalg.norm(p1 - p0) / spacing))
        for j in range(n):
            result.append(p0 + (p1 - p0) * j / n)
    result.append(np.array(pts[-1]))
    return np.array(result)


def _apply(pts: np.ndarray, scale: float, theta: float, tx: float, ty: float) -> np.ndarray:
    """Apply 2D similarity transform to an Nx2 array."""
    c, s = math.cos(theta), math.sin(theta)
    R = np.array([[c, -s], [s, c]])
    return scale * (pts @ R.T) + np.array([tx, ty])


def _solve_similarity(src: np.ndarray, tgt: np.ndarray) -> tuple[float, float, float, float]:
    """
    Closed-form 2D similarity transform (scale, theta, tx, ty) via SVD.
    src and tgt are Nx2 arrays of corresponding points.
    """
    sc = src.mean(axis=0)
    tc = tgt.mean(axis=0)
    sd = src - sc
    td = tgt - tc

    H = sd.T @ td
    U, s_vals, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:
        Vt[-1, :] *= -1
        R = Vt.T @ U.T

    src_var = np.sum(sd ** 2)
    scale = float(np.sum(s_vals) / src_var) if src_var > 0 else 1.0
    theta = float(math.atan2(R[1, 0], R[0, 0]))
    tx = float(tc[0] - scale * (R[0, 0] * sc[0] + R[0, 1] * sc[1]))
    ty = float(tc[1] - scale * (R[1, 0] * sc[0] + R[1, 1] * sc[1]))
    return scale, theta, tx, ty


def _pca_init(src: np.ndarray, tgt: np.ndarray) -> tuple[float, float, float, float]:
    """
    PCA-based initial alignment. Tries all 4 sign combinations of principal axes
    and returns the one with the smallest mean distance to the target boundary.
    """
    def axes(pts):
        d = pts - pts.mean(axis=0)
        cov = d.T @ d / len(pts)
        vals, vecs = np.linalg.eigh(cov)
        idx = np.argsort(vals)[::-1]
        return vecs[:, idx]

    src_ax = axes(src)
    tgt_ax = axes(tgt)
    tgt_line = LineString(tgt.tolist())

    best: Optional[tuple] = None
    best_d = float('inf')

    for sx in [1, -1]:
        for sy in [1, -1]:
            sa = src_ax * np.array([sx, sy])
            R = tgt_ax @ sa.T

            src_span = np.ptp(src @ src_ax[:, 0])
            tgt_span = np.ptp(tgt @ tgt_ax[:, 0])
            scale = (tgt_span / src_span) if src_span > 0 else 1.0

            sc, tc = src.mean(axis=0), tgt.mean(axis=0)
            tx = tc[0] - scale * (R[0, 0] * sc[0] + R[0, 1] * sc[1])
            ty = tc[1] - scale * (R[1, 0] * sc[0] + R[1, 1] * sc[1])
            theta = math.atan2(R[1, 0], R[0, 0])

            # Sample 100 points to evaluate this candidate
            src_t = _apply(src, scale, theta, tx, ty)
            sample = src_t[np.linspace(0, len(src_t) - 1, min(100, len(src_t)), dtype=int)]
            d = np.mean([Point(p.tolist()).distance(tgt_line) for p in sample])

            if d < best_d:
                best_d = d
                best = (scale, theta, tx, ty)

    return best


def _icp(
    src: np.ndarray,
    tgt: np.ndarray,
    init: tuple[float, float, float, float],
    n_iter: int = 30,
) -> tuple[tuple[float, float, float, float], np.ndarray]:
    """
    ICP with similarity transform. src/tgt in feet (EPSG:3435).
    Returns final transform and per-point residuals in feet.
    """
    scale, theta, tx, ty = init
    tgt_closed = np.vstack([tgt, tgt[:1]])
    tgt_line = LineString(tgt_closed.tolist())

    for _ in range(n_iter):
        src_t = _apply(src, scale, theta, tx, ty)

        # Correspondences: for each transformed src pt, find nearest tgt boundary pt
        corr_src, corr_tgt = [], []
        for i, pt in enumerate(src_t):
            _, near = nearest_points(Point(pt.tolist()), tgt_line)
            corr_src.append(src[i])          # ORIGINAL source point
            corr_tgt.append([near.x, near.y])

        new_transform = _solve_similarity(np.array(corr_src), np.array(corr_tgt))
        scale, theta, tx, ty = new_transform

        # Convergence check on a subsample
        check = _apply(src[:50], scale, theta, tx, ty)
        mean_d = np.mean([Point(p.tolist()).distance(tgt_line) for p in check])
        if mean_d < 0.001:
            break

    final = _apply(src, scale, theta, tx, ty)
    residuals = np.array([Point(p.tolist()).distance(tgt_line) for p in final])
    return (scale, theta, tx, ty), residuals


def register(
    gros_in: list[tuple[float, float]],
    footprint,   # shapely geometry, WGS84
    bd_id: str,
    floor_id: str,
) -> dict:
    """
    Align the GROS$ polygon (inches) to the GIS footprint.
    Returns a dict matching the transform.json schema.
    Raises ValueError if scale is outside 0.90–1.10 (units error).
    """
    # 1. CAD inches → feet
    gros_ft = [(x / 12.0, y / 12.0) for x, y in gros_in]

    # 2. Project footprint WGS84 → EPSG:3435 ftUS
    to_3435 = Transformer.from_crs(EPSG_GIS, EPSG_LOCAL, always_xy=True)
    if footprint.geom_type == 'MultiPolygon':
        footprint = max(footprint.geoms, key=lambda g: g.area)
    fp_coords = list(footprint.exterior.coords)
    fp_3435 = list(zip(*to_3435.transform([c[0] for c in fp_coords],
                                           [c[1] for c in fp_coords])))

    # 3. Densify both at 1 ft spacing
    src_dense = _densify(gros_ft, spacing=1.0)
    tgt_dense = _densify(fp_3435, spacing=1.0)

    # 4. PCA initial alignment, then ICP refine
    init = _pca_init(src_dense, tgt_dense)
    (scale, theta, tx, ty), residuals_ft = _icp(src_dense, tgt_dense, init)

    # 5. Scale sanity check
    if not (0.90 <= scale <= 1.10):
        if 10 < scale < 14:
            hint = f'scale ≈ {scale:.2f} ≈ 12 — GROS$ vertices may still be in inches; check $INSUNITS'
        elif 0.28 < scale < 0.32:
            hint = f'scale ≈ {scale:.4f} ≈ 0.3048 — possible feet/metres mismatch'
        else:
            hint = f'scale = {scale:.4f} — unexpected unit conversion'
        raise ValueError(f'{bd_id} floor {floor_id}: registration failed ({hint}). Aborting.')

    residuals_m = residuals_ft * FTUS_TO_M
    return {
        'bdId': bd_id,
        'sourceFloor': floor_id,
        'units': 'in',
        'epsg': EPSG_LOCAL,
        'similarity': {
            'scale':       round(scale, 6),
            'rotationDeg': round(math.degrees(theta), 4),
            'tx':          round(tx, 3),
            'ty':          round(ty, 3),
        },
        'residualMeanM': round(float(residuals_m.mean()), 3),
        'residualP95M':  round(float(np.percentile(residuals_m, 95)), 3),
        'status': 'auto',
    }


# ---------------------------------------------------------------------------
# Coordinate transformation helpers
# ---------------------------------------------------------------------------

def _to_wgs84(pts_in: list[tuple[float, float]], transform: dict) -> list[tuple[float, float]]:
    """
    Transform (x, y) in DXF inches → WGS84 (lng, lat).
    Applies: inches→feet → similarity → EPSG:3435 → WGS84.
    """
    sim = transform['similarity']
    scale = sim['scale']
    theta = math.radians(sim['rotationDeg'])
    tx, ty = sim['tx'], sim['ty']

    arr_ft = np.array([(x / 12.0, y / 12.0) for x, y in pts_in])
    arr_3435 = _apply(arr_ft, scale, theta, tx, ty)

    to_wgs = Transformer.from_crs(EPSG_LOCAL, EPSG_GIS, always_xy=True)
    lngs, lats = to_wgs.transform(arr_3435[:, 0], arr_3435[:, 1])
    return list(zip(lngs.tolist(), lats.tolist()))


# ---------------------------------------------------------------------------
# GeoJSON emission
# ---------------------------------------------------------------------------

def emit_linework(parsed: dict, transform: dict, floor_id: str, bd_id: str) -> dict:
    """Merge same-cls linework segments, transform, emit FeatureCollection."""
    cls_lines: dict[tuple[str, str], list] = {}

    for (_, cls, tier), pts_list in parsed['linework'].items():
        key = (cls, tier)
        for pts in pts_list:
            if len(pts) < 2:
                continue
            coords = _to_wgs84(pts, transform)
            cls_lines.setdefault(key, []).append(LineString(coords))

    features = []
    for (cls, tier), lines in cls_lines.items():
        merged = linemerge(lines)
        geoms = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        for geom in geoms:
            if not geom.is_empty and len(geom.coords) >= 2:
                features.append({
                    'type': 'Feature',
                    'geometry': mapping(geom),
                    'properties': {'cls': cls, 'tier': tier, 'floor': floor_id, 'bdId': bd_id},
                })

    return {'type': 'FeatureCollection', 'features': features,
            'generatedAt': _now_iso(), 'bdId': bd_id, 'floor': floor_id}


def emit_rooms(parsed: dict, transform: dict, floor_id: str, bd_id: str) -> dict:
    """Build room polygons, match each to its MTEXT label by containment."""
    polys: list[Polygon] = []
    for r in parsed['rooms']:
        if len(r['pts']) < 3:
            continue
        coords = _to_wgs84(r['pts'], transform)
        try:
            poly = Polygon(coords)
            if poly.is_valid and not poly.is_empty:
                polys.append(poly)
        except Exception:
            pass

    # Assign text labels by point-in-polygon
    attrs_by_poly: list[Optional[dict]] = [None] * len(polys)
    for ti in parsed['rm_texts']:
        ins_wgs = _to_wgs84([ti['insertion']], transform)
        if not ins_wgs:
            continue
        pt = Point(ins_wgs[0])
        for i, poly in enumerate(polys):
            if attrs_by_poly[i] is not None:
                continue   # already assigned
            if poly.contains(pt) or poly.distance(pt) < 1e-7:
                attrs_by_poly[i] = parse_mtext(ti['text'])
                break

    features = []
    for poly, attrs in zip(polys, attrs_by_poly):
        props: dict = {'floor': floor_id, 'bdId': bd_id}
        if attrs:
            props.update(attrs)
        features.append({'type': 'Feature', 'geometry': mapping(poly), 'properties': props})

    return {'type': 'FeatureCollection', 'features': features,
            'generatedAt': _now_iso(), 'bdId': bd_id, 'floor': floor_id}


def emit_gross(parsed: dict, transform: dict, floor_id: str, bd_id: str) -> dict:
    """Emit the GROS$ building outline as a single Polygon feature."""
    if not parsed['gros']:
        return {'type': 'FeatureCollection', 'features': []}
    coords = _to_wgs84(parsed['gros'], transform)
    try:
        poly = Polygon(coords)
        return {
            'type': 'FeatureCollection',
            'features': [{'type': 'Feature', 'geometry': mapping(poly),
                          'properties': {'floor': floor_id, 'bdId': bd_id}}],
            'generatedAt': _now_iso(),
        }
    except Exception:
        return {'type': 'FeatureCollection', 'features': []}


# ---------------------------------------------------------------------------
# Index
# ---------------------------------------------------------------------------

def update_index(out_dir: Path, bd_id: str, floor_id: str, residual_p95_m: float) -> None:
    idx_path = out_dir / 'index.json'
    index: dict = json.loads(idx_path.read_text()) if idx_path.exists() else {}

    bld = index.setdefault(bd_id, {'floors': [], 'default': floor_id, 'residualP95M': residual_p95_m})
    if floor_id not in bld['floors']:
        bld['floors'].append(floor_id)
        bld['floors'].sort()
    bld['residualP95M'] = round(min(bld.get('residualP95M', residual_p95_m), residual_p95_m), 3)

    idx_path.write_text(json.dumps(index, indent=2))


# ---------------------------------------------------------------------------
# Load buildings footprint
# ---------------------------------------------------------------------------

def load_footprint(buildings_path: str, bd_id: str):
    """Return a shapely geometry for the building, or None."""
    with open(buildings_path) as f:
        fc = json.load(f)
    for feat in fc.get('features', []):
        if feat.get('properties', {}).get('BD_ID') == bd_id:
            return shape(feat['geometry'])
    return None


def load_building_name(buildings_path: str, bd_id: str) -> str:
    """Return building display name from buildings.geojson for a BD_ID."""
    with open(buildings_path) as f:
        fc = json.load(f)
    for feat in fc.get('features', []):
        props = feat.get('properties', {})
        if props.get('BD_ID') == bd_id:
            return (props.get('DISCRIPT1') or props.get('BLD_COMMN')
                    or props.get('NAME') or bd_id)
    return bd_id


def build_rooms_index(rooms_fc: dict, bd_id: str, floor_id: str, building_name: str) -> list[dict]:
    """Build flat room-index entries from a rooms FeatureCollection."""
    entries: list[dict] = []
    for feat in rooms_fc.get('features', []):
        props = feat.get('properties', {})
        room = str(props.get('room', '')).strip()
        use  = str(props.get('use',  '')).strip()
        if not room:
            continue
        entry: dict = {
            'bdId':     bd_id,
            'building': building_name,
            'floor':    floor_id,
            'room':     room,
            'use':      use,
        }
        if 'areaSf' in props:
            entry['areaSf'] = props['areaSf']
        geom = feat.get('geometry')
        if geom:
            try:
                poly = shape(geom)
                c = poly.centroid
                entry['centroid'] = [round(c.x, 7), round(c.y, 7)]
            except Exception:
                pass
        tags = _expand_tags(room, use)
        if tags:
            entry['tags'] = tags
        entries.append(entry)
    return entries


def update_rooms_index(out_dir: Path, new_entries: list[dict], bd_id: str, floor_id: str) -> None:
    """Replace (bdId, floor) entries in rooms_index.json with new_entries."""
    idx_path = out_dir / 'rooms_index.json'
    existing: list[dict] = json.loads(idx_path.read_text()) if idx_path.exists() else []
    kept = [e for e in existing if not (e.get('bdId') == bd_id and e.get('floor') == floor_id)]
    kept.extend(new_entries)
    idx_path.write_text(json.dumps(kept, indent=2, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Main processing loop
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def process_dxf(
    dxf_path_str: str,
    buildings_path: str,
    out_dir: Path,
    dry_run: bool = False,
    force_transform: bool = False,
) -> dict:
    p = Path(dxf_path_str)
    m = re.match(r'^([A-Za-z][A-Za-z0-9]*)_(\w+)$', p.stem)
    if not m:
        raise ValueError(f"Filename '{p.name}' must be {{BD_ID}}_{{floor}}.dxf  (e.g. A06_01.dxf)")
    bd_id, floor_id = m.group(1).upper(), m.group(2)

    print(f"\n── {bd_id} / floor {floor_id} ──────────────────────────")
    print(f"  Input : {p}")

    # Parse
    print("  Parsing DXF …")
    parsed = parse_dxf(str(p))
    print(f"  Entities: {sum(len(v) for v in parsed['linework'].values())} linework  "
          f"{len(parsed['rooms'])} room polygons  "
          f"{len(parsed['rm_texts'])} room texts")
    if parsed['unknown_layers']:
        print(f"  UNKNOWN LAYERS: {sorted(parsed['unknown_layers'])}")

    bld_dir = out_dir / bd_id
    if not dry_run:
        bld_dir.mkdir(parents=True, exist_ok=True)

    # Transform
    tf_path = bld_dir / 'transform.json'
    transform: Optional[dict] = None

    if tf_path.exists() and not force_transform:
        transform = json.loads(tf_path.read_text())
        print(f"  Transform: existing (src floor {transform.get('sourceFloor')}, "
              f"residualP95={transform.get('residualP95M')}m, status={transform.get('status')})")
    elif parsed['gros']:
        print("  Computing registration from GROS$ polygon …")
        footprint = load_footprint(buildings_path, bd_id)
        if footprint is None:
            raise ValueError(f"Building {bd_id} not found in {buildings_path}")

        transform = register(parsed['gros'], footprint, bd_id, floor_id)
        r = transform['similarity']
        print(f"  scale={transform['similarity']['scale']:.4f}  "
              f"rotation={r['rotationDeg']:.3f}°  "
              f"residualMean={transform['residualMeanM']}m  "
              f"residualP95={transform['residualP95M']}m")

        if transform['residualP95M'] > 1.5:
            print(f"  ⚠ residualP95 {transform['residualP95M']}m > 1.5m — flagged for manual review")
        if not dry_run:
            tf_path.write_text(json.dumps(transform, indent=2))
            print(f"  Saved : {tf_path}")
    else:
        raise ValueError(
            f"No GROS$ layer found in {p.name} and no transform.json exists for {bd_id}. "
            f"Run floor 01 first."
        )

    # Emit GeoJSON
    lw    = emit_linework(parsed, transform, floor_id, bd_id)
    rooms = emit_rooms(parsed, transform, floor_id, bd_id)
    gross = emit_gross(parsed, transform, floor_id, bd_id)

    lw_path    = bld_dir / f"{floor_id}.geojson"
    rooms_path = bld_dir / f"{floor_id}.rooms.geojson"
    gross_path = bld_dir / f"{floor_id}.gross.geojson"

    lw_n    = len(lw['features'])
    room_n  = len(rooms['features'])

    if dry_run:
        print(f"  DRY-RUN: would write {lw_path} ({lw_n} features), "
              f"{rooms_path} ({room_n} rooms), {gross_path}")
    else:
        lw_path.write_text(json.dumps(lw))
        rooms_path.write_text(json.dumps(rooms))
        gross_path.write_text(json.dumps(gross))
        update_index(out_dir, bd_id, floor_id, transform['residualP95M'])
        building_name = load_building_name(buildings_path, bd_id)
        room_entries = build_rooms_index(rooms, bd_id, floor_id, building_name)
        update_rooms_index(out_dir, room_entries, bd_id, floor_id)
        print(f"  Saved : {lw_path}  ({lw_n} features)")
        print(f"  Saved : {rooms_path}  ({room_n} rooms)")
        print(f"  Saved : {gross_path}")
        print(f"  Rooms index: {len(room_entries)} entries → rooms_index.json")

    return {
        'bdId': bd_id, 'floor': floor_id,
        'lineworkFeatures': lw_n, 'rooms': room_n,
        'residualP95M': transform.get('residualP95M'),
        'flagged': transform.get('residualP95M', 0) > 1.5,
    }


# ---------------------------------------------------------------------------
# S3 upload
# ---------------------------------------------------------------------------

def upload_to_s3(summaries: list[dict], out_dir: Path, bucket: str, profile: str) -> None:
    try:
        import boto3
    except ImportError:
        print("boto3 not installed — skipping S3 upload")
        return

    session = boto3.Session(profile_name=profile)
    s3 = session.client('s3', region_name='us-east-1')
    n = 0

    for s in summaries:
        bd_id, floor = s['bdId'], s['floor']
        bld_dir = out_dir / bd_id
        files = [
            (bld_dir / 'transform.json',         f'plans/{bd_id}/transform.json'),
            (bld_dir / f'{floor}.geojson',        f'plans/{bd_id}/{floor}.geojson'),
            (bld_dir / f'{floor}.rooms.geojson',  f'plans/{bd_id}/{floor}.rooms.geojson'),
            (bld_dir / f'{floor}.gross.geojson',  f'plans/{bd_id}/{floor}.gross.geojson'),
        ]
        for local, key in files:
            if local.exists():
                ct = 'application/geo+json' if key.endswith('.geojson') else 'application/json'
                s3.put_object(Bucket=bucket, Key=key, Body=local.read_bytes(), ContentType=ct)
                print(f"  Uploaded: s3://{bucket}/{key}")
                n += 1

    idx = out_dir / 'index.json'
    if idx.exists():
        s3.put_object(Bucket=bucket, Key='plans/index.json',
                      Body=idx.read_bytes(), ContentType='application/json')
        print(f"  Uploaded: s3://{bucket}/plans/index.json")
        n += 1

    rooms_idx = out_dir / 'rooms_index.json'
    if rooms_idx.exists():
        s3.put_object(Bucket=bucket, Key='plans/rooms_index.json',
                      Body=rooms_idx.read_bytes(), ContentType='application/json')
        print(f"  Uploaded: s3://{bucket}/plans/rooms_index.json")
        n += 1

    print(f"  Total uploaded: {n} files")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> int:
    # Ensure UTF-8 output on Windows (avoids charmap errors from box-drawing chars)
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    ap = argparse.ArgumentParser(
        description='DXF floor-plan → georeferenced GeoJSON  (see file header for full usage)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('dxf', nargs='+', metavar='DXF', help='.dxf files to process')
    ap.add_argument('--buildings', default='gis_output/buildings.geojson',
                    help='buildings.geojson path (default: gis_output/buildings.geojson)')
    ap.add_argument('--out-dir', default='plans', help='Output directory (default: plans/)')
    ap.add_argument('--dry-run', action='store_true',
                    help='Parse & register, print results without writing files')
    ap.add_argument('--force-transform', action='store_true',
                    help='Recompute transform.json even if one already exists')
    ap.add_argument('--upload', action='store_true', help='Upload output to S3')
    ap.add_argument('--bucket', default='campusgeo-geodata-491117467175')
    ap.add_argument('--profile', default='GIS')
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    if not args.dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)

    summaries: list[dict] = []
    errors: list[tuple[str, str]] = []

    for dxf_file in args.dxf:
        try:
            s = process_dxf(dxf_file, args.buildings, out_dir,
                             dry_run=args.dry_run, force_transform=args.force_transform)
            summaries.append(s)
        except Exception as exc:
            print(f"\n  ERROR: {dxf_file}: {exc}")
            errors.append((dxf_file, str(exc)))

    # Summary
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    for s in summaries:
        flag = "⚠ REVIEW" if s.get('flagged') else "OK"
        print(f"  {s['bdId']}/{s['floor']}  "
              f"{s['lineworkFeatures']} features  "
              f"{s['rooms']} rooms  "
              f"residualP95={s.get('residualP95M')}m  [{flag}]")
    for path, err in errors:
        print(f"  ERROR  {path}: {err}")
    print("=" * 60)

    if args.upload and not args.dry_run and summaries:
        print("\nUploading to S3 …")
        upload_to_s3(summaries, out_dir, args.bucket, args.profile)

    return 0 if not errors else 1


if __name__ == '__main__':
    sys.exit(main())
