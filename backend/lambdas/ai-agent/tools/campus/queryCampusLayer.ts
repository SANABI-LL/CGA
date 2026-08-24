import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { resolveLocation, haversineMeters } from './findCampusNearby'

export const QueryCampusLayerInputSchema = z.object({
  layerName: z.enum([
    'emergency_phone', 'trash_can', 'benches', 'seating', 'public_arts', 'green_roof',
    'ada_route', 'accessible_entrance', 'controlled_entrance',
    'accessibility_info', 'inaccessible_entrance', 'inaccessible_building',
    'hydrant', 'fire_escape', 'sprinkler', 'standpipe', 'fire_lane', 'post_indicator_valve',
    'subarea',
    'landmark', 'nrhp', 'nhl',
    'surface_parking', 'metra_station',
  ]).describe('Which campus layer to query'),
  nearLocation: z.string().max(200).optional()
    .describe('Optional campus location name to filter by proximity (e.g. "Regenstein Library")'),
  radiusMeters: z.number().min(1).max(2000).optional().default(400)
    .describe('Search radius in meters when nearLocation is set (default 400)'),
  limit: z.number().int().min(1).max(200).optional().default(50)
    .describe('Max features to return (default 50)'),
  sortBy: z.string().optional().describe('Property name to sort features by'),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  topN: z.number().int().min(1).max(200).optional().describe('Return only the top N after sorting'),
}).strict()

export type QueryCampusLayerInput = z.infer<typeof QueryCampusLayerInputSchema>

const LAYER_LABELS: Record<string, string> = {
  emergency_phone: 'Emergency Phones',
  trash_can: 'Trash Cans',
  benches: 'Benches',
  seating: 'Outdoor Seating Areas',
  public_arts: 'Public Art',
  green_roof: 'Green Roofs',
  ada_route: 'ADA Routes',
  accessible_entrance: 'Accessible Public Entrances',
  controlled_entrance: 'Accessible Controlled-Access Entrances',
  accessibility_info: 'Building Accessibility Information',
  inaccessible_entrance: 'Inaccessible Main Entrances',
  inaccessible_building: 'Inaccessible Buildings',
  hydrant: 'Fire Hydrants',
  fire_escape: 'Fire Escapes',
  sprinkler: 'Fire Sprinklers',
  standpipe: 'Standpipes',
  fire_lane: 'Fire Lanes',
  post_indicator_valve: 'Post Indicator Valves',
  subarea: 'Campus Planning Subareas',
  landmark: 'Individual City Landmarks',
  nrhp: 'National Register of Historic Places',
  nhl: 'National Historic Landmarks',
  surface_parking: 'Surface Parking Lots',
  metra_station: 'Metra Train Stations',
}

export async function queryCampusLayer(input: QueryCampusLayerInput) {
  const raw = await queryS3Layer({
    layerName: input.layerName,
    maxResults: 500,
    returnGeometry: true,
  })

  if ('error' in raw) return raw

  let features = raw.features

  // Optional proximity filter
  if (input.nearLocation) {
    const center = resolveLocation(input.nearLocation)
    if (!center) {
      return {
        error: `Unknown location "${input.nearLocation}". Try a building name like "Regenstein Library" or "Main Quad".`,
      }
    }
    features = features.filter((f) => {
      const geom = f.geometry
      if (!geom) return false
      let lat: number | null = null
      let lng: number | null = null
      if (geom.type === 'Point') {
        const c = geom.coordinates as [number, number]
        lng = c[0]; lat = c[1]
      } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        // Use centroid approximation from first ring
        const ring = geom.type === 'Polygon'
          ? (geom.coordinates as number[][][])[0]
          : (geom.coordinates as number[][][][])[0][0]
        if (ring?.length) {
          lng = ring.reduce((s: number, p: number[]) => s + p[0], 0) / ring.length
          lat = ring.reduce((s: number, p: number[]) => s + p[1], 0) / ring.length
        }
      } else if (geom.type === 'LineString') {
        const coords = geom.coordinates as number[][]
        if (coords.length) {
          const mid = coords[Math.floor(coords.length / 2)]
          lng = mid[0]; lat = mid[1]
        }
      }
      if (lat === null || lng === null) return false
      return haversineMeters(center.lat, center.lng, lat, lng) <= (input.radiusMeters ?? 400)
    })
  }

  let sorted = features
  if (input.sortBy) {
    const sk = input.sortBy
    sorted = features
      .map((f) => {
        const v = f.properties[sk]
        const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
        return { f, n: Number.isFinite(n) ? n : null }
      })
      .sort((a, b) => {
        if (a.n === null && b.n === null) return 0
        if (a.n === null) return 1
        if (b.n === null) return -1
        return input.sortOrder === 'asc' ? a.n - b.n : b.n - a.n
      })
      .map((x) => x.f)
  }
  const trimmed = sorted.slice(0, input.topN ?? input.limit ?? 50)

  return {
    type: 'FeatureCollection' as const,
    features: trimmed,
    count: trimmed.length,
    totalInLayer: raw.features.length,
    layer: input.layerName,
    label: LAYER_LABELS[input.layerName] ?? input.layerName,
    ...(input.nearLocation ? { nearLocation: input.nearLocation, radiusMeters: input.radiusMeters } : {}),
    source: 's3',
  }
}
