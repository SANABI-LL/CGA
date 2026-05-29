import { z } from 'zod'
import { queryArcGIS } from './queryArcGIS'

export const FindCampusNearbyInputSchema = z.object({
  referenceLocation: z.string().describe('Named campus location or "lat,lng" coordinates'),
  featureType: z.enum(['bike_rack', 'building', 'dining', 'parking', 'accessible']),
  radiusMeters: z.number().optional().default(300),
  limit: z.number().optional().default(5),
})

export type FindCampusNearbyInput = z.infer<typeof FindCampusNearbyInputSchema>

// Named location → approximate coordinates on UChicago campus
const CAMPUS_LOCATIONS: Record<string, { lat: number; lng: number; displayName: string }> = {
  'main quad': { lat: 41.7886, lng: -87.5987, displayName: 'Main Quadrangle' },
  'regenstein library': { lat: 41.7921, lng: -87.5997, displayName: 'Regenstein Library' },
  'crerar library': { lat: 41.7908, lng: -87.6002, displayName: 'John Crerar Library' },
  'harper memorial': { lat: 41.7876, lng: -87.5994, displayName: 'Harper Memorial Library' },
  'booth school': { lat: 41.7876, lng: -87.5955, displayName: 'Booth School of Business' },
  'ratner': { lat: 41.7929, lng: -87.6009, displayName: 'Ratner Athletics Center' },
  'gcis': { lat: 41.7912, lng: -87.6017, displayName: 'Gordon Center for Integrative Science' },
  'gordon center': { lat: 41.7912, lng: -87.6017, displayName: 'Gordon Center for Integrative Science' },
  'keller center': { lat: 41.7943, lng: -87.5978, displayName: 'Gerald Ratner Athletics Center - Keller Stop' },
  'midway': { lat: 41.7828, lng: -87.5998, displayName: 'Midway Plaisance' },
  'hutchinson commons': { lat: 41.7901, lng: -87.5984, displayName: 'Hutchinson Commons' },
  'saieh hall': { lat: 41.7889, lng: -87.5970, displayName: 'Saieh Hall for Economics' },
  'harris school': { lat: 41.7871, lng: -87.5981, displayName: 'Harris School of Public Policy' },
  'uchicago medical center': { lat: 41.7889, lng: -87.6042, displayName: 'UChicago Medical Center' },
  '57th street': { lat: 41.7916, lng: -87.5997, displayName: '57th Street' },
}

function resolveLocation(name: string): { lat: number; lng: number; displayName: string } | null {
  const n = name.toLowerCase().trim()

  // Direct match
  if (CAMPUS_LOCATIONS[n]) return CAMPUS_LOCATIONS[n]

  // Partial match
  const entry = Object.entries(CAMPUS_LOCATIONS).find(
    ([key]) => n.includes(key) || key.includes(n)
  )
  if (entry) return entry[1]

  // Try parsing as "lat,lng"
  const coords = n.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
  if (coords) {
    return { lat: parseFloat(coords[1]), lng: parseFloat(coords[2]), displayName: 'Custom location' }
  }

  return null
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const LAYER_BY_FEATURE: Record<string, 'bike_racks' | 'buildings' | 'electrical' | 'parking' | 'accessible' | 'dining'> = {
  bike_rack: 'bike_racks',
  building: 'buildings',
  dining: 'dining',
  parking: 'parking',
  accessible: 'accessible',
}

export async function findCampusNearby(input: FindCampusNearbyInput) {
  const center = resolveLocation(input.referenceLocation)
  if (!center) {
    return {
      error: `Unknown location "${input.referenceLocation}". Known locations: ${Object.values(CAMPUS_LOCATIONS).map(l => l.displayName).slice(0, 8).join(', ')}...`,
    }
  }

  const layerName = LAYER_BY_FEATURE[input.featureType]
  const result = await queryArcGIS({ layerName, whereClause: '1=1', maxResults: 200, returnGeometry: true })

  if ('error' in result) return result

  // Filter and sort by distance
  const nearby = result.features
    .filter((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][] | number[][][] } | null
      if (!geom) return false
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
        // Use first coordinate as approximation
        const coords = geom.type === 'Polygon' ? (geom.coordinates as number[][][])[0][0] : (geom.coordinates as number[][][][])[0][0][0]
        ;[lng, lat] = coords
      } else {
        return false
      }
      return haversineMeters(center.lat, center.lng, lat, lng) <= (input.radiusMeters ?? 300)
    })
    .map((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][] | number[][][] }
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else {
        const coords = (geom.coordinates as number[][][])[0][0]
        ;[lng, lat] = coords
      }
      return {
        ...f,
        _distanceMeters: Math.round(haversineMeters(center.lat, center.lng, lat, lng)),
      }
    })
    .sort((a, b) => a._distanceMeters - b._distanceMeters)
    .slice(0, input.limit ?? 5)

  return {
    referenceLocation: center.displayName,
    center,
    featureType: input.featureType,
    radiusMeters: input.radiusMeters,
    count: nearby.length,
    features: {
      type: 'FeatureCollection' as const,
      features: nearby.map(({ _distanceMeters, ...f }) => ({
        ...f,
        properties: { ...f.properties, distanceMeters: _distanceMeters },
      })),
    },
  }
}
