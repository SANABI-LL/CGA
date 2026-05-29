import { z } from 'zod'

// Divvy GBFS — free, no API key required
const DIVVY_STATION_INFO = 'https://gbfs.divvybikes.com/gbfs/en/station_information.json'
const DIVVY_STATION_STATUS = 'https://gbfs.divvybikes.com/gbfs/en/station_status.json'

export const GetBikeStationsInputSchema = z.object({
  nearLocation: z.string().describe('Campus location name, e.g. "GCIS", "Regenstein Library"'),
  radiusMeters: z.number().optional().default(400),
  limit: z.number().optional().default(5),
})

export type GetBikeStationsInput = z.infer<typeof GetBikeStationsInputSchema>

// Known UChicago/Hyde Park locations → coordinates
const LOCATION_COORDS: Record<string, { lat: number; lng: number }> = {
  'gcis': { lat: 41.7912, lng: -87.6017 },
  'gordonCenter': { lat: 41.7912, lng: -87.6017 },
  'regenstein library': { lat: 41.7921, lng: -87.5997 },
  'crerar library': { lat: 41.7908, lng: -87.6002 },
  'booth school': { lat: 41.7876, lng: -87.5955 },
  'main quad': { lat: 41.7886, lng: -87.5987 },
  'ratner': { lat: 41.7929, lng: -87.6009 },
  'keller center': { lat: 41.7943, lng: -87.5978 },
  'midway': { lat: 41.7828, lng: -87.5998 },
  'harper memorial': { lat: 41.7876, lng: -87.5994 },
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

function resolveLocation(name: string): { lat: number; lng: number } | null {
  const normalized = name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
  const direct = LOCATION_COORDS[normalized]
  if (direct) return direct

  const match = Object.entries(LOCATION_COORDS).find(
    ([key]) => normalized.includes(key) || key.includes(normalized)
  )
  return match ? match[1] : null
}

export async function getBikeStations(input: GetBikeStationsInput) {
  const center = resolveLocation(input.nearLocation)
  if (!center) {
    return {
      error: `Unknown location "${input.nearLocation}". Try: "Main Quad", "Regenstein Library", "GCIS", "Booth School".`,
    }
  }

  try {
    const [infoRes, statusRes] = await Promise.all([
      fetch(DIVVY_STATION_INFO, { signal: AbortSignal.timeout(8_000) }),
      fetch(DIVVY_STATION_STATUS, { signal: AbortSignal.timeout(8_000) }),
    ])

    if (!infoRes.ok || !statusRes.ok) {
      return { error: 'Failed to fetch Divvy bike data' }
    }

    const [infoData, statusData] = await Promise.all([infoRes.json(), statusRes.json()]) as [
      { data: { stations: Array<{ station_id: string; name: string; lat: number; lon: number; capacity: number }> } },
      { data: { stations: Array<{ station_id: string; num_bikes_available: number; num_docks_available: number; is_installed: number; is_renting: number }> } },
    ]

    // Build status lookup
    const statusMap = new Map(
      statusData.data.stations.map((s) => [s.station_id, s])
    )

    // Find stations within radius, sorted by distance
    const nearby = infoData.data.stations
      .map((station) => {
        const dist = haversineMeters(center.lat, center.lng, station.lat, station.lon)
        const status = statusMap.get(station.station_id)
        return {
          stationId: station.station_id,
          name: station.name,
          lat: station.lat,
          lng: station.lon,
          distanceMeters: Math.round(dist),
          bikesAvailable: status?.num_bikes_available ?? 0,
          docksAvailable: status?.num_docks_available ?? 0,
          capacity: station.capacity,
          isOpen: status?.is_installed === 1 && status?.is_renting === 1,
        }
      })
      .filter((s) => s.distanceMeters <= (input.radiusMeters ?? 400) && s.isOpen)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, input.limit ?? 5)

    return {
      nearLocation: input.nearLocation,
      center,
      radiusMeters: input.radiusMeters,
      stations: nearby,
      totalFound: nearby.length,
      features: {
        type: 'FeatureCollection' as const,
        features: nearby.map((s) => ({
          type: 'Feature' as const,
          id: s.stationId,
          geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
          properties: {
            name: s.name,
            bikesAvailable: s.bikesAvailable,
            docksAvailable: s.docksAvailable,
            distanceMeters: s.distanceMeters,
          },
        })),
      },
    }
  } catch (err) {
    return { error: `Failed to get bike stations: ${err instanceof Error ? err.message : String(err)}` }
  }
}
