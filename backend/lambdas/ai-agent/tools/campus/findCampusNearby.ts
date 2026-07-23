import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const FindCampusNearbyInputSchema = z.object({
  referenceLocation: z.string().max(200).describe('Named campus location or "lat,lng" coordinates'),
  featureType: z.enum(['building', 'dining', 'accessible', 'bike_rack', 'parking']),
  radiusMeters: z.number().min(1).max(2000).optional().default(300),
  limit: z.number().int().min(1).max(50).optional().default(5),
}).strict()

export type FindCampusNearbyInput = z.infer<typeof FindCampusNearbyInputSchema>

// Named location → approximate coordinates on UChicago campus.
// A Map (not a plain object) so lookups can never hit prototype-chain keys
// like "__proto__" or "constructor".
const CAMPUS_LOCATIONS = new Map<string, { lat: number; lng: number; displayName: string }>([
  ['main quad', { lat: 41.7886, lng: -87.5987, displayName: 'Main Quadrangle' }],
  ['regenstein library', { lat: 41.7921, lng: -87.5997, displayName: 'Regenstein Library' }],
  ['crerar library', { lat: 41.7904, lng: -87.6028, displayName: 'John Crerar Library' }],
  ['harper memorial', { lat: 41.7880, lng: -87.5995, displayName: 'Harper Memorial Library' }],
  ['booth school', { lat: 41.7889, lng: -87.5955, displayName: 'Booth School of Business (Harper Center)' }],
  ['ratner', { lat: 41.7940, lng: -87.6019, displayName: 'Ratner Athletics Center' }],
  ['gcis', { lat: 41.7910, lng: -87.6027, displayName: 'Gordon Center for Integrative Science' }],
  ['gordon center', { lat: 41.7910, lng: -87.6027, displayName: 'Gordon Center for Integrative Science' }],
  ['keller center', { lat: 41.7856, lng: -87.5940, displayName: 'Keller Center (1307 E 60th St)' }],
  ['midway', { lat: 41.7828, lng: -87.5998, displayName: 'Midway Plaisance' }],
  ['hutchinson commons', { lat: 41.7912, lng: -87.5986, displayName: 'Hutchinson Commons' }],
  ['saieh hall', { lat: 41.7899, lng: -87.5973, displayName: 'Saieh Hall for Economics' }],
  ['harris school', { lat: 41.7871, lng: -87.5981, displayName: 'Harris School of Public Policy' }],
  ['uchicago medical center', { lat: 41.7889, lng: -87.6042, displayName: 'UChicago Medical Center' }],
  ['57th street', { lat: 41.7916, lng: -87.5997, displayName: '57th Street' }],
  // Extended — covers buildings queried by name that were missing from the original list
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
])

export function resolveLocation(name: string): { lat: number; lng: number; displayName: string } | null {
  const raw = name.toLowerCase().trim()

  // "lat,lng" is parsed from the raw input — the name sanitizer below would
  // strip the digits' punctuation.
  const coords = raw.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
  if (coords) {
    return { lat: parseFloat(coords[1]), lng: parseFloat(coords[2]), displayName: 'Custom location' }
  }

  // Same sanitizer as the sibling resolvers (checkHours / getBikeStations)
  const n = raw.replace(/[^a-z0-9 ]/g, '').trim()

  // Too-short input would substring-match the first dictionary entry
  if (n.length < 2) return null

  // Direct match
  const direct = CAMPUS_LOCATIONS.get(n)
  if (direct) return direct

  // Partial match
  for (const [key, loc] of CAMPUS_LOCATIONS) {
    if (n.includes(key) || key.includes(n)) return loc
  }

  return null
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
  const center = resolveLocation(input.referenceLocation)
  if (!center) {
    return {
      error: `Unknown location "${input.referenceLocation}". Known locations: ${[...CAMPUS_LOCATIONS.values()].map(l => l.displayName).slice(0, 8).join(', ')}...`,
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

  // Filter and sort by distance
  const nearby = result.features
    .filter((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][] | number[][][] | number[][][][] } | null
      if (!geom) return false
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else if (geom.type === 'Polygon') {
        // Use first coordinate as approximation for polygon centroid
        const coords = (geom.coordinates as number[][][])[0]?.[0]
        if (!Array.isArray(coords)) return false // layer contains empty geometries
        ;[lng, lat] = coords
      } else if (geom.type === 'MultiPolygon') {
        // Use first polygon's first coordinate
        const coords = (geom.coordinates as number[][][][])[0]?.[0]?.[0]
        if (!Array.isArray(coords)) return false
        ;[lng, lat] = coords
      } else {
        return false
      }
      return haversineMeters(center.lat, center.lng, lat, lng) <= (input.radiusMeters ?? 300)
    })
    .map((f) => {
      const geom = f.geometry as { type: string; coordinates: number[] | number[][][] | number[][][][] }
      let lng: number, lat: number
      if (geom.type === 'Point') {
        [lng, lat] = geom.coordinates as number[]
      } else if (geom.type === 'Polygon') {
        ;[lng, lat] = (geom.coordinates as number[][][])[0][0]
      } else {
        // MultiPolygon — first polygon's first ring's first position
        ;[lng, lat] = (geom.coordinates as number[][][][])[0][0][0]
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
        // Building layer carries internal columns — allow-list them; the
        // dining/accessible layers are public info and pass through.
        properties:
          input.featureType === 'building'
            ? pickBuildingProps(f.properties as Record<string, unknown>, { distanceMeters: _distanceMeters })
            : { ...f.properties, distanceMeters: _distanceMeters },
      })),
    },
  }
}
