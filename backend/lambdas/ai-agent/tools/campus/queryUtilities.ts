import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { resolveLocation, haversineMeters } from './findCampusNearby'

import { getBucket } from './config'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'

const s3 = new S3Client({ region: AWS_REGION })

/**
 * Campus underground-utility layers (from "Utility Information.gdb",
 * uploaded by ingest via convert_gdb.py + upload_utilities.py).
 * S3 keys are layers/utility_<layer>.geojson — the utility_ prefix keeps them
 * from colliding with the general campus layers (e.g. electrical).
 *
 * NOTE: source attributes are CAD export metadata (Layer/Color/Linetype…)
 * with no engineering attributes yet (depth, diameter, install year are
 * planned additions). Query value is therefore spatial: near a location,
 * by utility system. Attribute filtering is intentionally not offered.
 */
const UTILITY_SYSTEMS: Record<string, { layers: string[]; label: string }> = {
  steam: {
    label: 'Steam distribution (lines, condensate, vaults, LP/MP piping)',
    layers: [
      'utility_t2021_steam_line',
      'utility_t2021_steam_line_condensate',
      'utility_steam_vault',
      'utility_low_pressure_piping',
      'utility_medium_pressure_piping',
    ],
  },
  chilled_water: {
    label: 'Chilled water supply/return',
    layers: [
      'utility_chilled_water_supply',
      'utility_chilled_water_receive',
      'utility_nesb_chilled_water_supply',
      'utility_nesb_chilled_water_return',
    ],
  },
  domestic_water: { label: 'Domestic water', layers: ['utility_domestic_water'] },
  sewer: {
    label: 'Sewers (city combined + university owned)',
    layers: ['utility_city_owned_combined_sewer', 'utility_university_owned_sewer'],
  },
  stormwater: {
    label: 'Stormwater management (detention, bioswales, retention sites)',
    layers: [
      'utility_underground_stormwater_detention',
      'utility_bioswale_area',
      'utility_site_construction_with_stormwater_retention',
    ],
  },
  electrical: {
    label: 'Electrical (lines, ComEd vault feeders, conduit infrastructure)',
    layers: [
      'utility_electrical_line',
      'utility_comed_vault_feeder',
      'utility_uchicago_conduit_infrastructure',
    ],
  },
  compressed_air: {
    label: 'Compressed air (T80/T50)',
    layers: ['utility_t80_compressed_air', 'utility_t50_compressed_air'],
  },
  tunnel: { label: 'Walkable utility tunnels', layers: ['utility_new_walkable_tunnel'] },
  valves: { label: 'Valves', layers: ['utility_valves'] },
}

export const QueryUtilitiesInputSchema = z.object({
  utilityType: z.enum([
    'steam',
    'chilled_water',
    'domestic_water',
    'sewer',
    'stormwater',
    'electrical',
    'compressed_air',
    'tunnel',
    'valves',
  ]),
  nearLocation: z
    .string()
    .max(200)
    .optional()
    .describe('Named campus location or "lat,lng" — limits results to a radius around it'),
  radiusMeters: z.number().min(1).max(2000).optional().default(150),
  maxResults: z.number().int().min(1).max(500).optional().default(300),
  topN: z.number().int().min(1).max(100).optional()
    .describe('Return only the top N features after sorting (by distance when nearLocation is set).'),
}).strict()

export type QueryUtilitiesInput = z.infer<typeof QueryUtilitiesInputSchema>

interface UtilityFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown } | null
}

// Layer GeoJSON cached per Lambda instance — same lifecycle as queryS3Layer.
const layerCache = new Map<string, Promise<UtilityFeature[]>>()

function loadLayer(name: string): Promise<UtilityFeature[]> {
  let cached = layerCache.get(name)
  if (!cached) {
    cached = (async () => {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: getBucket(), Key: `layers/${name}.geojson` })
      )
      if (!response.Body) throw new Error(`Empty S3 response for ${name}`)
      const parsed = JSON.parse(await response.Body.transformToString()) as {
        features: UtilityFeature[]
      }
      return parsed.features ?? []
    })().catch((err) => {
      layerCache.delete(name) // allow retry on next invocation
      throw err
    })
    layerCache.set(name, cached)
  }
  return cached
}

// ── Location resolution ────────────────────────────────────────────────
// The static gazetteer in findCampusNearby covers ~15 landmarks; fall back
// to the 308-building S3 layer so ANY named building can anchor a query.

interface ResolvedLocation {
  lat: number
  lng: number
  displayName: string
}

let buildingIndexPromise: Promise<Array<ResolvedLocation & { key: string }>> | null = null

function loadBuildingIndex() {
  if (!buildingIndexPromise) {
    buildingIndexPromise = (async () => {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: getBucket(), Key: 'layers/buildings.geojson' })
      )
      if (!response.Body) throw new Error('Empty S3 response for buildings.geojson')
      const parsed = JSON.parse(await response.Body.transformToString()) as {
        features: UtilityFeature[]
      }
      return parsed.features.flatMap((f) => {
        const name = String(f.properties?.DISCRIPT1 ?? '').trim()
        if (!name || !f.geometry) return []
        let sumLat = 0
        let sumLng = 0
        let n = 0
        forEachVertex(f.geometry.coordinates, (lng, lat) => {
          sumLng += lng
          sumLat += lat
          n++
        })
        if (!n) return []
        return [{ key: name.toLowerCase(), displayName: name, lat: sumLat / n, lng: sumLng / n }]
      })
    })().catch((err) => {
      buildingIndexPromise = null
      throw err
    })
  }
  return buildingIndexPromise
}

async function resolveAnyLocation(name: string): Promise<ResolvedLocation | null> {
  const fromGazetteer = resolveLocation(name)
  if (fromGazetteer) return fromGazetteer
  const n = name.toLowerCase().trim()
  // Too-short input would match every building via `b.key.includes('')` —
  // bail out before paying for the S3 building-index load.
  if (n.length < 2) return null
  try {
    const index = await loadBuildingIndex()
    const exact = index.find((b) => b.key === n)
    if (exact) return exact
    // Token match handles partial names: "Cobb Hall" → "Cobb Lecture Hall"
    const tokens = n.split(/[^a-z0-9]+/).filter((t) => t.length > 1)
    if (tokens.length) {
      const candidates = index
        .filter((b) => tokens.every((t) => b.key.includes(t)))
        .sort((a, b) => a.key.length - b.key.length)
      if (candidates.length) return candidates[0]
    }
    return index.find((b) => b.key.includes(n) || n.includes(b.key)) ?? null
  } catch {
    return null
  }
}

// ── Bounding box (user preference: rectangular extent, prints cleanly) ──

interface Box {
  w: number
  e: number
  s: number
  n: number
}

function boxAround(lat: number, lng: number, radiusMeters: number): Box {
  const dLat = radiusMeters / 111_320
  const dLng = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180))
  return { w: lng - dLng, e: lng + dLng, s: lat - dLat, n: lat + dLat }
}

function vertexInBox(lng: number, lat: number, box: Box): boolean {
  return lng >= box.w && lng <= box.e && lat >= box.s && lat <= box.n
}

function anyVertexInBox(f: UtilityFeature, box: Box): boolean {
  let found = false
  if (f.geometry) {
    forEachVertex(f.geometry.coordinates, (lng, lat) => {
      if (!found && vertexInBox(lng, lat, box)) found = true
    })
  }
  return found
}

// Walk nested coordinate arrays, yielding [lng, lat] pairs (Z ignored).
function forEachVertex(coords: unknown, fn: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number') {
    fn(coords[0] as number, coords[1] as number)
    return
  }
  for (const child of coords) forEachVertex(child, fn)
}

function minDistanceMeters(f: UtilityFeature, lat: number, lng: number): number {
  let min = Infinity
  if (f.geometry) {
    forEachVertex(f.geometry.coordinates, (vLng, vLat) => {
      const d = haversineMeters(lat, lng, vLat, vLng)
      if (d < min) min = d
    })
  }
  return min
}

// Clip line geometries to the query box: CAD polylines can span the whole
// campus, and without clipping a single in-box vertex drags the entire line
// onto the map far beyond the asked-about area. A rectangular boundary (not
// a circle) per user preference — it matches the print frame.
function clipToBox(
  geometry: { type: string; coordinates: unknown },
  box: Box
): { type: string; coordinates: unknown } | null {
  const clipLine = (line: number[][]): number[][][] => {
    const runs: number[][][] = []
    let run: number[][] = []
    for (const v of line) {
      if (vertexInBox(v[0], v[1], box)) {
        run.push([v[0], v[1]])
      } else {
        if (run.length > 1) runs.push(run)
        run = []
      }
    }
    if (run.length > 1) runs.push(run)
    return runs
  }
  if (geometry.type === 'LineString') {
    const runs = clipLine(geometry.coordinates as number[][])
    return runs.length ? { type: 'MultiLineString', coordinates: runs } : null
  }
  if (geometry.type === 'MultiLineString') {
    const runs = (geometry.coordinates as number[][][]).flatMap(clipLine)
    return runs.length ? { type: 'MultiLineString', coordinates: runs } : null
  }
  // Points and (small-extent) polygons pass through — already box-filtered
  return geometry
}

// Drop Z values and round to 6 decimals (~0.1 m) to slim the map payload.
function slimCoordinates(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords
  if (typeof coords[0] === 'number') {
    return [
      Math.round((coords[0] as number) * 1e6) / 1e6,
      Math.round((coords[1] as number) * 1e6) / 1e6,
    ]
  }
  return coords.map(slimCoordinates)
}

/**
 * Spatial query over campus underground utilities. Attribute data is CAD
 * metadata only, so this tool answers "what is where": by system, optionally
 * within a radius of a named location.
 */
export async function queryUtilities(input: QueryUtilitiesInput) {
  const system = UTILITY_SYSTEMS[input.utilityType]

  let center: ResolvedLocation | null = null
  let box: Box | null = null
  if (input.nearLocation) {
    center = await resolveAnyLocation(input.nearLocation)
    if (!center) {
      return { error: `Unknown location "${input.nearLocation}". Try a campus building name (e.g. "Cobb Hall") or "lat,lng".` }
    }
    // 5% tolerance keeps boundary segments from flickering out at the edge
    box = boxAround(center.lat, center.lng, input.radiusMeters * 1.05)
  }

  try {
    const perLayer = await Promise.all(
      system.layers.map(async (name) => ({ name, features: await loadLayer(name) }))
    )

    const countByLayer: Record<string, number> = {}
    let selected: Array<{ layer: string; feature: UtilityFeature; distance?: number }> = []

    for (const { name, features } of perLayer) {
      let kept: Array<{ layer: string; feature: UtilityFeature; distance?: number }>
      if (center && box) {
        kept = features
          .filter((feature) => anyVertexInBox(feature, box!))
          .map((feature) => ({
            layer: name,
            feature,
            distance: minDistanceMeters(feature, center!.lat, center!.lng),
          }))
      } else {
        kept = features.map((feature) => ({ layer: name, feature }))
      }
      countByLayer[name] = kept.length
      selected = selected.concat(kept)
    }

    const totalMatched = selected.length
    if (center) selected.sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity))
    selected = selected.slice(0, input.topN ?? input.maxResults)

    const outFeatures = selected.flatMap(({ layer, feature, distance }) => {
      let geometry = feature.geometry
      if (geometry && box) {
        geometry = clipToBox(geometry, box)
        if (!geometry) return []
      }
      return [{
        type: 'Feature' as const,
        properties: {
          // utilitySystem drives per-system colors and the legend on the frontend
          utilitySystem: input.utilityType,
          utilityLayer: layer.replace(/^utility_/, ''),
          source: typeof feature.properties?.Layer === 'string' ? feature.properties.Layer : undefined,
          ...(distance !== undefined ? { distanceMeters: Math.round(distance) } : {}),
        },
        geometry: geometry
          ? { ...geometry, coordinates: slimCoordinates(geometry.coordinates) }
          : null,
      }]
    })

    const summary = {
      utilityType: input.utilityType,
      systemLabel: system.label,
      referenceLocation: center?.displayName,
      radiusMeters: center ? input.radiusMeters : undefined,
      totalMatched,
      returned: outFeatures.length,
      countByLayer,
      nearestDistanceMeters: center && selected.length ? Math.round(selected[0].distance!) : undefined,
      attributeNote:
        'Source attributes are CAD metadata only — depth, diameter and material are not yet available.',
    }

    return {
      ...summary,
      count: outFeatures.length,
      center: center ? { lat: center.lat, lng: center.lng } : undefined,
      features: { type: 'FeatureCollection' as const, features: outFeatures },
      // Geometry-heavy features go to the map via the SSE mapUpdate; the model
      // reasons over this compact summary instead (see executeTool in agent.ts).
      _modelSummary: { ...summary, featuresShownOnMap: outFeatures.length },
    }
  } catch (err) {
    console.error('queryUtilities error:', err)
    return { error: 'Utility query failed' }
  }
}
