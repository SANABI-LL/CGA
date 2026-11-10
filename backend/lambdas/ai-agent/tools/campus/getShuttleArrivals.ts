import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'

const PASSIO_BASE = 'https://passiogo.com'
const PASSIO_SYSTEM_ID = '1068'
const PASSIO_APP_VERSION = '1'

// 10-second in-memory cache for live vehicle positions
let vehicleCache: { data: Record<string, PassioVehicle[]>; ts: number } | null = null
const VEHICLE_CACHE_TTL_MS = 10_000

interface PassioEtaEntry {
  secondsSpent: number
  eta: string
  routeId: number
  busName: string
  outOfService: boolean
  goShowSchedule: number
}

interface PassioVehicle {
  deviceId: number
  latitude: string
  longitude: string
  calculatedCourse: number
  routeId: string
  bus: string
  busName: string
  color: string
  outOfService: number
  speed?: number
}

interface PassioAlert {
  id: string
  name: string
  html: string
  archive: string
  from: string
  to: string
  routeId: string
}

export const GetShuttleArrivalsInputSchema = z.object({
  stopName: z
    .string()
    .max(200)
    .optional()
    .describe('Stop name or nearby campus building, e.g. "Logan Center", "Regenstein Library"'),
  routeName: z
    .string()
    .max(100)
    .optional()
    .describe('Filter to one route, e.g. "NightRide North", "Red Line/Arts Block"'),
  limit: z.number().int().min(1).max(10).default(5),
}).strict()

export type GetShuttleArrivalsInput = z.infer<typeof GetShuttleArrivalsInputSchema>

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function passioPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${PASSIO_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'CampusGeo/1.0' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`Passio POST ${path} ${res.status}`)
  return res.json()
}

async function passioGet(path: string): Promise<unknown> {
  const res = await fetch(`${PASSIO_BASE}${path}`, {
    headers: { 'User-Agent': 'CampusGeo/1.0' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`Passio GET ${path} ${res.status}`)
  return res.json()
}

async function getVehiclesCached(): Promise<Record<string, PassioVehicle[]>> {
  const now = Date.now()
  if (vehicleCache && now - vehicleCache.ts < VEHICLE_CACHE_TTL_MS) {
    return vehicleCache.data
  }
  const raw = (await passioPost(`/mapGetData.php?getBuses=2`, {
    s0: PASSIO_SYSTEM_ID,
    sA: 1,
  })) as { buses?: Record<string, PassioVehicle[]> }
  const data = raw.buses ?? {}
  vehicleCache = { data, ts: now }
  return data
}

async function getActiveAlerts(): Promise<PassioAlert[]> {
  const raw = (await passioPost(`/goServices.php?getAlertMessages=1`, {
    systemSelected0: PASSIO_SYSTEM_ID,
    amount: 1,
    routesAmount: 0,
  })) as { msgs?: PassioAlert[] }
  const now = new Date()
  return (raw.msgs ?? []).filter((m) => {
    if (m.archive !== '0') return false
    try {
      const from = new Date(m.from)
      const to = new Date(m.to)
      return now >= from && now <= to
    } catch {
      return false
    }
  })
}

// Load stops from S3 shuttle_stops layer; fall back to live Passio API
async function loadStops(): Promise<Array<{ stopId: string; name: string; routeId: string; routeName: string; lat: number; lon: number }>> {
  try {
    const result = await queryS3Layer({ layerName: 'shuttle_stops', maxResults: 700, returnGeometry: true })
    if ('error' in result) throw new Error(result.error)
    return result.features.map((f) => {
      const p = f.properties as Record<string, unknown>
      const coords = (f.geometry as { coordinates?: [number, number] })?.coordinates ?? [0, 0]
      return {
        stopId: String(p.StopId ?? p.stopId ?? ''),
        name: String(p.Name ?? p.name ?? ''),
        routeId: String(p.RouteId ?? p.routeId ?? ''),
        routeName: String(p.RouteName ?? p.routeName ?? ''),
        lat: coords[1],
        lon: coords[0],
      }
    })
  } catch {
    // Fallback: fetch stops live from Passio GO
    const raw = (await passioPost(`/mapGetData.php?getStops=2`, {
      s0: PASSIO_SYSTEM_ID,
      sA: 1,
    })) as { stops?: Record<string, { stopId: string; name: string; routeId: string; routeName: string; latitude: number; longitude: number }> }
    const stops = raw.stops ?? {}
    return Object.values(stops).map((s) => ({
      stopId: String(s.stopId),
      name: String(s.name),
      routeId: String(s.routeId),
      routeName: String(s.routeName ?? ''),
      lat: Number(s.latitude),
      lon: Number(s.longitude),
    }))
  }
}

export async function getShuttleArrivals(input: GetShuttleArrivalsInput) {
  try {
    const allStops = await loadStops()
    if (allStops.length === 0) {
      return { found: false, reason: 'upstream_unavailable' as const }
    }

    // Find stops matching stopName
    let matchedStops = allStops
    if (input.stopName) {
      const needle = normalizeText(input.stopName)
      // Exact name match first
      const exact = allStops.filter((s) => normalizeText(s.name) === needle)
      if (exact.length > 0) {
        matchedStops = exact
      } else {
        // Partial substring match
        const partial = allStops.filter(
          (s) => normalizeText(s.name).includes(needle) || needle.includes(normalizeText(s.name).split(' ')[0])
        )
        if (partial.length > 0) {
          matchedStops = partial
        } else {
          return {
            found: false,
            reason: 'stop_not_found' as const,
            message: `No shuttle stop found matching "${input.stopName}". Try a nearby building name or check passiogo.com for the stop list.`,
          }
        }
      }
    }

    // Filter by routeName if provided
    if (input.routeName) {
      const routeNeedle = normalizeText(input.routeName)
      const routeFiltered = matchedStops.filter(
        (s) => normalizeText(s.routeName).includes(routeNeedle) || normalizeText(s.routeId) === routeNeedle
      )
      if (routeFiltered.length > 0) matchedStops = routeFiltered
    }

    // Deduplicate: prefer the stop with the most specific name match
    // Use the first matched stop as the canonical stop
    const primaryStop = matchedStops[0]

    // Collect unique routeIds for this stop name (same stop served by multiple routes)
    const sameLocationStops = matchedStops.filter(
      (s) => s.stopId === primaryStop.stopId || normalizeText(s.name) === normalizeText(primaryStop.name)
    )

    const fetchedAt = new Date().toISOString()

    // Fetch ETAs for each routeId serving this stop
    const arrivals: Array<{
      routeId: string
      routeName: string
      routeShortName: string
      routeColor: string
      vehicleId: string | null
      vehicleLabel: string | null
      etaSeconds: number
      etaText: string
      scheduled: boolean
      vehicle: { lat: number; lon: number; bearing: number; speed: number } | null
    }> = []

    const [vehicles, alerts] = await Promise.allSettled([
      getVehiclesCached(),
      getActiveAlerts(),
    ])
    const vehicleMap = vehicles.status === 'fulfilled' ? vehicles.value : {}
    const activeAlerts = alerts.status === 'fulfilled' ? alerts.value : []

    // Flatten vehicles by routeId for quick lookup
    const vehicleByRoute = new Map<string, PassioVehicle[]>()
    for (const vList of Object.values(vehicleMap)) {
      for (const v of vList) {
        const rid = String(v.routeId)
        if (!vehicleByRoute.has(rid)) vehicleByRoute.set(rid, [])
        vehicleByRoute.get(rid)!.push(v)
      }
    }

    for (const stop of sameLocationStops) {
      if (!stop.stopId || !stop.routeId) continue
      try {
        const etaRaw = (await passioGet(
          `/mapGetData.php?eta=3&stopIds=${encodeURIComponent(stop.stopId)}&routeId=${encodeURIComponent(stop.routeId)}&appVersion=${PASSIO_APP_VERSION}`
        )) as { ETAs?: Record<string, PassioEtaEntry[]> }

        const etaList = etaRaw.ETAs?.['0000'] ?? []
        for (const e of etaList.slice(0, input.limit)) {
          if (e.outOfService) continue
          const etaSeconds = e.secondsSpent >= 86399 ? -1 : e.secondsSpent
          if (etaSeconds < 0) continue

          // Find vehicle by busName in this route
          const routeVehicles = vehicleByRoute.get(String(e.routeId)) ?? []
          const matchedVehicle = e.busName
            ? routeVehicles.find((v) => v.busName === e.busName || v.bus === e.busName)
            : routeVehicles[0]

          arrivals.push({
            routeId: String(e.routeId),
            routeName: stop.routeName,
            routeShortName: '',
            routeColor: matchedVehicle?.color ?? '#843c39',
            vehicleId: matchedVehicle ? String(matchedVehicle.deviceId) : null,
            vehicleLabel: e.busName || null,
            etaSeconds,
            etaText: e.eta !== 'no vehicles' ? e.eta : etaSeconds <= 60 ? 'arriving' : `${Math.round(etaSeconds / 60)} min`,
            scheduled: e.goShowSchedule === 1,
            vehicle: matchedVehicle
              ? {
                  lat: parseFloat(matchedVehicle.latitude),
                  lon: parseFloat(matchedVehicle.longitude),
                  bearing: matchedVehicle.calculatedCourse ?? 0,
                  speed: matchedVehicle.speed ?? 0,
                }
              : null,
          })
        }
      } catch {
        // ETA fetch failed for this stop/route — skip
      }
    }

    // Sort by etaSeconds
    arrivals.sort((a, b) => a.etaSeconds - b.etaSeconds)

    // Build mapUpdate FeatureCollection
    const mapFeatures: Array<Record<string, unknown>> = []

    // Target stop
    mapFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [primaryStop.lon, primaryStop.lat] },
      properties: {
        _kind: 'stop',
        Name: primaryStop.name,
        StopId: primaryStop.stopId,
      },
    })

    // Vehicles from arrivals that have positions
    for (const a of arrivals) {
      if (a.vehicle) {
        mapFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [a.vehicle.lon, a.vehicle.lat] },
          properties: {
            _kind: 'vehicle',
            routeId: a.routeId,
            routeName: a.routeName,
            vehicleLabel: a.vehicleLabel,
            etaText: a.etaText,
            bearing: a.vehicle.bearing,
            routeColor: a.routeColor,
          },
        })
      }
    }

    // Filter alerts relevant to these routes
    const routeIds = new Set(sameLocationStops.map((s) => s.routeId))
    const relevantAlerts = activeAlerts
      .filter((a) => !a.routeId || routeIds.has(a.routeId))
      .map((a) => ({
        title: a.name,
        body: a.html.replace(/<[^>]+>/g, '').trim(),
        routeIds: a.routeId ? [a.routeId] : [],
      }))

    return {
      found: true,
      stop: { id: primaryStop.stopId, name: primaryStop.name, lat: primaryStop.lat, lon: primaryStop.lon },
      fetchedAt,
      source: 'passiogo-json' as const,
      arrivals: arrivals.slice(0, input.limit),
      alerts: relevantAlerts,
      features: { type: 'FeatureCollection', features: mapFeatures },
      _mapFocus: null,
    }
  } catch (err) {
    console.error('getShuttleArrivals error:', err)
    return { found: false, reason: 'upstream_unavailable' as const }
  }
}
