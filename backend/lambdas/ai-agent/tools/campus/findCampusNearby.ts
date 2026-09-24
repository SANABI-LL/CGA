import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const FindCampusNearbyInputSchema = z.object({
  referenceLocation: z.string().max(200).describe('Named campus location or "lat,lng" coordinates'),
  featureType: z.enum(['building', 'dining', 'accessible', 'bike_rack', 'parking']),
  radiusMeters: z.number().min(0).max(2000).optional(),
  limit: z.number().int().min(1).max(50).optional().default(5),
}).strict()

export type FindCampusNearbyInput = z.infer<typeof FindCampusNearbyInputSchema>

// Named location → approximate coordinates on UChicago campus.
// A Map (not a plain object) so lookups can never hit prototype-chain keys
// like "__proto__" or "constructor".
const CAMPUS_LOCATIONS = new Map<string, { lat: number; lng: number; displayName: string }>([
  ['main quad', { lat: 41.7899, lng: -87.5998, displayName: 'Main Quadrangle' }],
  ['regenstein library', { lat: 41.7921, lng: -87.5997, displayName: 'Regenstein Library' }],
  ['crerar library', { lat: 41.7904, lng: -87.6028, displayName: 'John Crerar Library' }],
  ['harper memorial', { lat: 41.7880, lng: -87.5995, displayName: 'Harper Memorial Library' }],
  ['booth school', { lat: 41.7889, lng: -87.5955, displayName: 'Booth School of Business (Harper Center)' }],
  ['ratner', { lat: 41.7940, lng: -87.6019, displayName: 'Ratner Athletics Center' }],
  ['gcis', { lat: 41.7910, lng: -87.6027, displayName: 'Gordon Center for Integrative Science' }],
  ['gordon center', { lat: 41.7910, lng: -87.6027, displayName: 'Gordon Center for Integrative Science' }],
  ['keller center', { lat: 41.7856, lng: -87.5940, displayName: 'Keller Center (1307 E 60th St)' }],
  ['midway', { lat: 41.7847, lng: -87.5955, displayName: 'Midway Plaisance' }],
  ['hutchinson commons', { lat: 41.7912, lng: -87.5986, displayName: 'Hutchinson Commons' }],
  ['saieh hall', { lat: 41.7899, lng: -87.5973, displayName: 'Saieh Hall for Economics' }],
  ['harris school', { lat: 41.7871, lng: -87.5981, displayName: 'Harris School of Public Policy' }],
  ['uchicago medical center', { lat: 41.7889, lng: -87.6042, displayName: 'UChicago Medical Center' }],
  ['57th street', { lat: 41.7916, lng: -87.5997, displayName: '57th Street' }],
  ['levi hall', { lat: 41.78957, lng: -87.60092, displayName: 'Edward H. Levi Hall' }],
  ['administration building', { lat: 41.78957, lng: -87.60092, displayName: 'Edward H. Levi Hall' }],
  ['rosenwald hall', { lat: 41.7893, lng: -87.5997, displayName: 'Rosenwald Hall' }],
  ['cobb hall', { lat: 41.7890, lng: -87.5988, displayName: 'Cobb Hall' }],
  ['swift hall', { lat: 41.7903, lng: -87.5989, displayName: 'Swift Hall' }],
  ['bond chapel', { lat: 41.7895, lng: -87.5986, displayName: 'Bond Chapel' }],
  ['ida noyes hall', { lat: 41.7902, lng: -87.5970, displayName: 'Ida Noyes Hall' }],
  ['pick hall', { lat: 41.7893, lng: -87.5964, displayName: 'Pick Hall' }],
  ['social science research building', { lat: 41.7892, lng: -87.5980, displayName: 'Social Science Research Building' }],
  ['ssrb', { lat: 41.7892, lng: -87.5980, displayName: 'Social Science Research Building' }],
  ['mansueto library', { lat: 41.7917, lng: -87.5993, displayName: 'Joe and Rika Mansueto Library' }],
  ['eckhart hall', { lat: 41.7912, lng: -87.6001, displayName: 'Eckhart Hall' }],
  ['ryerson hall', { lat: 41.7912, lng: -87.5998, displayName: 'Ryerson Physical Laboratory' }],
  ['kersten physics', { lat: 41.7905, lng: -87.6009, displayName: 'Kersten Physics Teaching Center' }],
  ['jones laboratory', { lat: 41.7901, lng: -87.6006, displayName: 'George Herbert Jones Laboratory' }],
  ['culver hall', { lat: 41.7898, lng: -87.6011, displayName: 'Culver Hall' }],
  ['haskell hall', { lat: 41.7885, lng: -87.5993, displayName: 'Haskell Hall' }],
  ['classics building', { lat: 41.7888, lng: -87.5994, displayName: 'Classics Building' }],
  ['kent chemical', { lat: 41.7902, lng: -87.5993, displayName: 'Kent Chemical Laboratory' }],
  ['kelly hall', { lat: 41.7879, lng: -87.5992, displayName: 'Kelly Hall' }],
  ['wieboldt hall', { lat: 41.7882, lng: -87.5990, displayName: 'Wieboldt Hall' }],
  ['max palevsky', { lat: 41.7936, lng: -87.5996, displayName: 'Max Palevsky Residential Commons' }],
  ['south campus', { lat: 41.7860, lng: -87.5980, displayName: 'South Campus' }],
  ['north campus', { lat: 41.7930, lng: -87.5990, displayName: 'North Campus' }],
  ['botany pond', { lat: 41.7908, lng: -87.6009, displayName: 'Botany Pond' }],
  ['the pond', { lat: 41.7908, lng: -87.6009, displayName: 'Botany Pond' }],
  ['hull court', { lat: 41.7910, lng: -87.6004, displayName: 'Hull Court' }],
  ['hull gate', { lat: 41.7910, lng: -87.6004, displayName: 'Hull Court' }],
  ['main quadrangle', { lat: 41.7899, lng: -87.5998, displayName: 'Main Quadrangle' }],
  ['the quad', { lat: 41.7899, lng: -87.5998, displayName: 'Main Quadrangle' }],
  ['harper quad', { lat: 41.7883, lng: -87.5983, displayName: 'Harper Quadrangle' }],
  ['harper quadrangle', { lat: 41.7883, lng: -87.5983, displayName: 'Harper Quadrangle' }],
  ['bartlett quad', { lat: 41.7919, lng: -87.5978, displayName: 'Bartlett Quadrangle' }],
  ['bartlett quadrangle', { lat: 41.7919, lng: -87.5978, displayName: 'Bartlett Quadrangle' }],
  ['hutchinson court', { lat: 41.7910, lng: -87.5986, displayName: 'Hutchinson Court' }],
  ['hutch court', { lat: 41.7910, lng: -87.5986, displayName: 'Hutchinson Court' }],
  ['nuclear energy', { lat: 41.7925, lng: -87.6010, displayName: 'Nuclear Energy Sculpture (Henry Moore)' }],
  ['henry moore', { lat: 41.7925, lng: -87.6010, displayName: 'Nuclear Energy Sculpture (Henry Moore)' }],
  ['cobb gate', { lat: 41.7913, lng: -87.5993, displayName: 'Cobb Gate' }],
  ['midway plaisance', { lat: 41.7847, lng: -87.5955, displayName: 'Midway Plaisance' }],
  ['the midway', { lat: 41.7847, lng: -87.5955, displayName: 'Midway Plaisance' }],
  ['erman biology', { lat: 41.7909, lng: -87.6025, displayName: 'Erman Biology Center' }],
  ['erman biology center', { lat: 41.7909, lng: -87.6025, displayName: 'Erman Biology Center' }],
  ['zoology', { lat: 41.7908, lng: -87.6016, displayName: 'Zoology Building' }],
  ['anatomy', { lat: 41.7912, lng: -87.6016, displayName: 'Anatomy Building' }],
  ['henry hinds', { lat: 41.7904, lng: -87.6019, displayName: 'Henry Hinds Laboratory' }],
  ['hinds', { lat: 41.7904, lng: -87.6019, displayName: 'Henry Hinds Laboratory' }],
  ['robie house', { lat: 41.7894, lng: -87.5990, displayName: 'Frederick C. Robie House' }],
  ['reynolds club', { lat: 41.7906, lng: -87.5985, displayName: 'Reynolds Club' }],
  ['mandel hall', { lat: 41.7903, lng: -87.5981, displayName: 'Mandel Hall' }],
  ['rockefeller chapel', { lat: 41.7876, lng: -87.5998, displayName: 'Rockefeller Memorial Chapel' }],
  ['rockefeller memorial chapel', { lat: 41.7876, lng: -87.5998, displayName: 'Rockefeller Memorial Chapel' }],
  ['smart museum', { lat: 41.7901, lng: -87.5962, displayName: 'Smart Museum of Art' }],
  ['oriental institute', { lat: 41.7896, lng: -87.5973, displayName: 'Oriental Institute' }],
  ['henry crown field house', { lat: 41.7952, lng: -87.6000, displayName: 'Henry Crown Field House' }],
  ['crown field house', { lat: 41.7952, lng: -87.6000, displayName: 'Henry Crown Field House' }],
  ['stagg field', { lat: 41.7928, lng: -87.6011, displayName: 'Stagg Field (site)' }],
  ['logan center', { lat: 41.7906, lng: -87.5942, displayName: 'Reva and David Logan Center for the Arts' }],
  ['logan', { lat: 41.7906, lng: -87.5942, displayName: 'Reva and David Logan Center for the Arts' }],
  ['logan arts center', { lat: 41.7906, lng: -87.5942, displayName: 'Reva and David Logan Center for the Arts' }],
  ['reva and david logan center', { lat: 41.7906, lng: -87.5942, displayName: 'Reva and David Logan Center for the Arts' }],
])

// Polygon exterior rings for area landmarks ([lng, lat] GeoJSON convention, ring must close).
// "Within X meters of Main Quad" means within X meters of this polygon boundary (or inside it),
// not a fixed-radius circle around a centroid — a rectangle can't be represented by a point.
// Coordinates are approximate; calibrate from campus WebMap before production.
const CAMPUS_POLYGONS = new Map<string, number[][]>([
  // Main Quadrangle: 57th–59th St × Ellis Ave–University Ave (road centerlines)
  // N edge calibrated 2026-09-17: hand-drawn 41.7921 was ~20 m too far north; 41.79195 ≈ 57th St centerline
  ['main quad',         [[-87.6016, 41.79195], [-87.5979, 41.79195], [-87.5979, 41.7879], [-87.6016, 41.7879], [-87.6016, 41.79195]]],
  ['main quadrangle',   [[-87.6016, 41.79195], [-87.5979, 41.79195], [-87.5979, 41.7879], [-87.6016, 41.7879], [-87.6016, 41.79195]]],
  ['the quad',          [[-87.6016, 41.79195], [-87.5979, 41.79195], [-87.5979, 41.7879], [-87.6016, 41.7879], [-87.6016, 41.79195]]],
  // Harper Quadrangle: around Harper Memorial Library
  ['harper quad',       [[-87.5995, 41.7892], [-87.5972, 41.7892], [-87.5972, 41.7874], [-87.5995, 41.7874], [-87.5995, 41.7892]]],
  ['harper quadrangle', [[-87.5995, 41.7892], [-87.5972, 41.7892], [-87.5972, 41.7874], [-87.5995, 41.7874], [-87.5995, 41.7892]]],
  // Bartlett Quadrangle: north campus around Bartlett Gymnasium
  ['bartlett quad',     [[-87.5988, 41.7926], [-87.5968, 41.7926], [-87.5968, 41.7912], [-87.5988, 41.7912], [-87.5988, 41.7926]]],
  ['bartlett quadrangle',[[-87.5988, 41.7926], [-87.5968, 41.7926], [-87.5968, 41.7912], [-87.5988, 41.7912], [-87.5988, 41.7926]]],
  // Hutchinson Court: sunken courtyard between Hutchinson Commons and Reynolds Club
  ['hutchinson court',  [[-87.5994, 41.7915], [-87.5979, 41.7915], [-87.5979, 41.7905], [-87.5994, 41.7905], [-87.5994, 41.7915]]],
  ['hutch court',       [[-87.5994, 41.7915], [-87.5979, 41.7915], [-87.5979, 41.7905], [-87.5994, 41.7905], [-87.5994, 41.7915]]],
  // Midway Plaisance: campus-adjacent portion (~59th–60th, Cottage Grove to Stony Island)
  ['midway',            [[-87.6060, 41.7865], [-87.5870, 41.7865], [-87.5870, 41.7825], [-87.6060, 41.7825], [-87.6060, 41.7865]]],
  ['midway plaisance',  [[-87.6060, 41.7865], [-87.5870, 41.7865], [-87.5870, 41.7825], [-87.6060, 41.7825], [-87.6060, 41.7865]]],
  ['the midway',        [[-87.6060, 41.7865], [-87.5870, 41.7865], [-87.5870, 41.7825], [-87.6060, 41.7825], [-87.6060, 41.7865]]],
])

// Normaliser shared with other query tools (strip accents, spaces, punctuation)
const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')

// Module-level cached building index for location-resolution fallback.
// Loaded at most once per Lambda warm instance via queryS3Layer.
let buildingIndexCache: Promise<Array<{ key: string; displayName: string; lat: number; lng: number }>> | null = null

function loadBuildingIndex() {
  if (!buildingIndexCache) {
    buildingIndexCache = queryS3Layer({ layerName: 'buildings', maxResults: 500, returnGeometry: true })
      .then(result => {
        if ('error' in result) throw new Error(String((result as { error: unknown }).error))
        return result.features.flatMap(f => {
          const name = String(f.properties?.DISCRIPT1 ?? '').trim()
          if (!name || !f.geometry) return []
          const geom = f.geometry as { type: string; coordinates: unknown }
          let coords: number[][]
          if (geom.type === 'Polygon') coords = (geom.coordinates as number[][][])[0]
          else if (geom.type === 'MultiPolygon') coords = (geom.coordinates as number[][][][])[0][0]
          else return []
          if (!coords.length) return []
          let sumLng = 0, sumLat = 0
          for (const [lng, lat] of coords) { sumLng += lng; sumLat += lat }
          return [{ key: name.toLowerCase(), displayName: name, lat: sumLat / coords.length, lng: sumLng / coords.length }]
        })
      })
      .catch(err => { buildingIndexCache = null; throw err })
  }
  return buildingIndexCache
}

export type AnchorResult = {
  lat: number          // centroid latitude (for display + point anchors)
  lng: number          // centroid longitude
  displayName: string
  polygon?: number[][] // GeoJSON exterior ring [lng, lat][], present for area polygon anchors
}

// Ray-casting point-in-polygon. px = longitude, py = latitude (GeoJSON convention).
function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// Haversine distance from a point to a line segment, both in [lng, lat].
// Projects in degree-space (valid approximation for distances < 1 km).
function distPointToSegmentMeters(
  px: number, py: number, ax: number, ay: number, bx: number, by: number
): number {
  const dx = bx - ax, dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-18) return haversineMeters(py, px, ay, ax)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq))
  return haversineMeters(py, px, ay + t * dy, ax + t * dx)
}

// Minimum haversine distance from a point to a closed polygon exterior ring.
// Returns 0 when the point is inside the ring.
export function distPointToPolygonMeters(px: number, py: number, ring: number[][]): number {
  if (pointInRing(px, py, ring)) return 0
  let min = Infinity
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    min = Math.min(min, distPointToSegmentMeters(px, py, ring[j][0], ring[j][1], ring[i][0], ring[i][1]))
  }
  return min
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Top-n suggestions from buildings.geojson by token overlap, falling back to static list.
async function locationSuggestions(query: string, n = 3): Promise<string[]> {
  const normQ = norm(query)
  const tokens = normQ.length > 2 ? [normQ, ...normQ.replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(t => t.length > 2)] : []
  if (tokens.length) {
    try {
      const index = await loadBuildingIndex()
      const seen = new Set<string>()
      const top: string[] = []
      const scored = index
        .map(b => ({ name: b.displayName, score: tokens.filter(t => norm(b.key).includes(t)).length }))
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
      for (const s of scored) {
        if (!seen.has(s.name)) { seen.add(s.name); top.push(s.name) }
        if (top.length >= n) break
      }
      if (top.length) return top
    } catch { /* fall through to static list */ }
  }
  // Static fallback
  const q = query.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const words = q.split(/\s+/).filter(w => w.length >= 3)
  const seen = new Set<string>()
  const scored: Array<{ name: string; score: number }> = []
  for (const [key, loc] of CAMPUS_LOCATIONS) {
    const score = words.filter(w => key.includes(w)).length
    if (score > 0 && !seen.has(loc.displayName)) {
      seen.add(loc.displayName)
      scored.push({ name: loc.displayName, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, n).map(s => s.name)
}

export async function resolveLocation(name: string): Promise<AnchorResult | null> {
  const raw = name.toLowerCase().trim()

  // "lat,lng" literal — parse directly
  const coords = raw.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
  if (coords) {
    return { lat: parseFloat(coords[1]), lng: parseFloat(coords[2]), displayName: 'Custom location' }
  }

  const n = raw.replace(/[^a-z0-9 ]/g, '').trim()
  if (n.length < 2) return null

  // 1. Direct match against landmark list
  const direct = CAMPUS_LOCATIONS.get(n)
  if (direct) {
    const polygon = CAMPUS_POLYGONS.get(n)
    return polygon ? { ...direct, polygon } : { ...direct }
  }

  // 2. Partial/substring match against landmark list
  for (const [key, loc] of CAMPUS_LOCATIONS) {
    if (n.includes(key) || key.includes(n)) {
      const polygon = CAMPUS_POLYGONS.get(key)
      return polygon ? { ...loc, polygon } : { ...loc }
    }
  }

  // 3. Fallback: fuzzy search against buildings.geojson Building Name (DISCRIPT1)
  const normQ = norm(n)
  if (normQ.length < 2) return null
  try {
    const index = await loadBuildingIndex()
    // Exact normalized match
    const exact = index.find(b => norm(b.key) === normQ)
    if (exact) return { lat: exact.lat, lng: exact.lng, displayName: exact.displayName }
    // All tokens present (handles "Logan" → "Reva and David Logan Center for the Arts")
    const tokens = n.split(/[^a-z0-9]+/).filter(t => t.length > 2)
    if (tokens.length) {
      const candidates = index
        .filter(b => tokens.every(t => norm(b.key).includes(t)))
        .sort((a, b) => a.key.length - b.key.length)
      if (candidates.length) return { lat: candidates[0].lat, lng: candidates[0].lng, displayName: candidates[0].displayName }
    }
    // Substring match in either direction
    const sub = index.find(b => norm(b.key).includes(normQ) || normQ.includes(norm(b.key)))
    if (sub) return { lat: sub.lat, lng: sub.lng, displayName: sub.displayName }
  } catch { /* non-fatal — fall through */ }

  return null
}

const LAYER_BY_FEATURE: Record<string, 'buildings' | 'accessible' | 'dining' | 'bike_racks' | 'parking'> = {
  building: 'buildings',
  dining: 'dining',
  accessible: 'accessible',
  bike_rack: 'bike_racks',
  parking: 'parking',
}

/**
 * 查找参考点附近的校园设施（使用 S3 数据）
 */
export async function findCampusNearby(input: FindCampusNearbyInput) {
  const center = await resolveLocation(input.referenceLocation)
  if (!center) {
    const suggestions = await locationSuggestions(input.referenceLocation)
    return {
      error: `Unknown location "${input.referenceLocation}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}?` : ' Try a named campus building or landmark.'}`,
      suggestions,
    }
  }

  const layerName = LAYER_BY_FEATURE[input.featureType]
  const result = await queryS3Layer({
    layerName,
    whereClause: '1=1',
    maxResults: 200,
    returnGeometry: true,
  })

  if ('error' in result) return result

  // Polygon anchor: default = 0 (inside only); point anchor: default = 300 m circle
  const radius = input.radiusMeters ?? (center.polygon ? 0 : 300)

  // Filter and sort by distance
  const nearby = result.features
    .filter((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][] | number[][][] | number[][][][] } | null
      if (!geom) return false
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else if (geom.type === 'Polygon') {
        const coords = (geom.coordinates as number[][][])[0]?.[0]
        if (!Array.isArray(coords)) return false
        ;[lng, lat] = coords
      } else if (geom.type === 'MultiPolygon') {
        const coords = (geom.coordinates as number[][][][])[0]?.[0]?.[0]
        if (!Array.isArray(coords)) return false
        ;[lng, lat] = coords
      } else {
        return false
      }
      // Polygon anchor: distance to polygon boundary (0 if inside)
      // Point anchor: haversine distance to centroid
      const dist = center.polygon
        ? distPointToPolygonMeters(lng, lat, center.polygon)
        : haversineMeters(center.lat, center.lng, lat, lng)
      return dist <= radius
    })
    .map((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][][] | number[][][][] }
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else if (geom.type === 'Polygon') {
        ;[lng, lat] = (geom.coordinates as number[][][])[0][0]
      } else {
        ;[lng, lat] = (geom.coordinates as number[][][][])[0][0][0]
      }
      const dist = center.polygon
        ? distPointToPolygonMeters(lng, lat, center.polygon)
        : haversineMeters(center.lat, center.lng, lat, lng)
      return { ...f, _distanceMeters: Math.round(dist) }
    })
    .sort((a, b) => a._distanceMeters - b._distanceMeters)
    .slice(0, input.limit ?? 5)

  return {
    referenceLocation: center.displayName,
    center: { lat: center.lat, lng: center.lng },
    ...(center.polygon ? { anchorPolygon: { type: 'Polygon' as const, coordinates: [center.polygon] } } : {}),
    featureType: input.featureType,
    radiusMeters: radius,
    count: nearby.length,
    features: {
      type: 'FeatureCollection' as const,
      features: nearby.map(({ _distanceMeters, ...f }) => ({
        ...f,
        properties:
          input.featureType === 'building'
            ? pickBuildingProps(f.properties as Record<string, unknown>, { distanceMeters: _distanceMeters })
            : { ...f.properties, distanceMeters: _distanceMeters },
      })),
    },
  }
}
