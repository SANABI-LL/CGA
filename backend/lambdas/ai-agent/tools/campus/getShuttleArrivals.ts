import { z } from 'zod'

// TransLoc public API — requires free API key from developer.transloc.com
// Agency ID for UChicago: typically needs lookup from /agencies endpoint
const TRANSLOC_AGENCY_ID = process.env.TRANSLOC_AGENCY_ID ?? '1323'
const TRANSLOC_API_KEY = process.env.TRANSLOC_API_KEY ?? ''
const TRANSLOC_BASE = 'https://transloc-api-1-2.p.rapidapi.com'

export const GetShuttleArrivalsInputSchema = z.object({
  stopName: z.string().describe('Campus shuttle stop name, e.g. "Keller Center", "Ratner"'),
  stopId: z.string().optional().describe('TransLoc stop ID if known'),
})

export type GetShuttleArrivalsInput = z.infer<typeof GetShuttleArrivalsInputSchema>

// Known UChicago shuttle stop name → ID mapping (populated from TransLoc /stops endpoint)
const KNOWN_STOPS: Record<string, string> = {
  'keller center': '4126614',
  'ratner': '4126616',
  'regenstein library': '4126618',
  'booth school': '4126620',
  'midway': '4126622',
  'gordon center': '4126624',
}

function normalizeStopName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

export async function getShuttleArrivals(input: GetShuttleArrivalsInput) {
  if (!TRANSLOC_API_KEY) {
    // Return mock data when API key not configured
    return getMockShuttleArrivals(input.stopName)
  }

  // Resolve stop ID
  let stopId = input.stopId
  if (!stopId) {
    const normalized = normalizeStopName(input.stopName)
    stopId = KNOWN_STOPS[normalized]

    if (!stopId) {
      // Try partial match
      const match = Object.entries(KNOWN_STOPS).find(([key]) => normalized.includes(key) || key.includes(normalized))
      stopId = match?.[1]
    }
  }

  if (!stopId) {
    return {
      error: `Could not find stop "${input.stopName}". Known stops: ${Object.keys(KNOWN_STOPS).map(s => s.replace(/\b\w/g, c => c.toUpperCase())).join(', ')}`,
    }
  }

  try {
    const response = await fetch(
      `${TRANSLOC_BASE}/arrival-estimates.json?agencies=${TRANSLOC_AGENCY_ID}&stops=${stopId}`,
      {
        headers: {
          'X-RapidAPI-Key': TRANSLOC_API_KEY,
          'X-RapidAPI-Host': 'transloc-api-1-2.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(8_000),
      }
    )

    if (!response.ok) {
      return { error: `TransLoc API error: ${response.status}` }
    }

    const data = await response.json() as {
      data?: Array<{
        stop_id: string
        arrivals: Array<{ route_id: string; vehicle_id: string; arrival_at: string }>
      }>
    }

    const stopData = data.data?.find((d) => d.stop_id === stopId)
    if (!stopData || stopData.arrivals.length === 0) {
      return {
        stopName: input.stopName,
        arrivals: [],
        message: 'No upcoming arrivals found for this stop.',
      }
    }

    const now = Date.now()
    const arrivals = stopData.arrivals.map((a) => {
      const arrivalTime = new Date(a.arrival_at).getTime()
      const minutesAway = Math.round((arrivalTime - now) / 60_000)
      return {
        routeId: a.route_id,
        vehicleId: a.vehicle_id,
        arrivalAt: a.arrival_at,
        minutesAway: Math.max(0, minutesAway),
      }
    })

    return {
      stopName: input.stopName,
      stopId,
      arrivals: arrivals.sort((a, b) => a.minutesAway - b.minutesAway),
    }
  } catch (err) {
    return { error: `Failed to get shuttle arrivals: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function getMockShuttleArrivals(stopName: string) {
  const now = Date.now()
  return {
    stopName,
    arrivals: [
      {
        routeId: 'CIR',
        vehicleId: 'V-01',
        arrivalAt: new Date(now + 4 * 60_000).toISOString(),
        minutesAway: 4,
        note: '(mock data — TransLoc API key not configured)',
      },
      {
        routeId: 'CIR',
        vehicleId: 'V-02',
        arrivalAt: new Date(now + 12 * 60_000).toISOString(),
        minutesAway: 12,
        note: '(mock data)',
      },
    ],
    isMockData: true,
  }
}
