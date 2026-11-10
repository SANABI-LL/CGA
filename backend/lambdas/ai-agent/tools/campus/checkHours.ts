import { z } from 'zod'

export const CheckHoursInputSchema = z.object({
  locationName: z.string().max(200).describe('Campus location name, e.g. "Regenstein Library", "Crerar Library"'),
  checkTime: z.string().max(50).optional().describe('ISO 8601 timestamp, defaults to now'),
}).strict()

export type CheckHoursInput = z.infer<typeof CheckHoursInputSchema>

// UChicago Libraries use LibCal (Springshare) for live hours.
// iid=482 discovered from rooms.lib.uchicago.edu page source.
const LIBCAL_IID = 482

// Location IDs from api3.libcal.com/api_hours_today.php?iid=482&lid=0
const LIBCAL_LOCATIONS: Record<string, { lid: number; displayName: string }> = {
  regenstein:  { lid: 1357, displayName: 'Regenstein Library' },
  crerar:      { lid: 1373, displayName: 'Crerar Library' },
  eckhart:     { lid: 1377, displayName: 'Eckhart Library' },
  mansueto:    { lid: 1379, displayName: 'Mansueto Library' },
}

// Static fallback for locations not in LibCal (athletics, dining, reading rooms).
// Format: [normalizedName, { [dayIndex 0=Sun]: { open: "HH:MM", close: "HH:MM" } | null }]
type WeekSchedule = Record<number, { open: string; close: string } | null>
const STATIC_HOURS = new Map<string, WeekSchedule>(Object.entries({
  'harper memorial library': {
    0: null,
    1: { open: '09:00', close: '21:00' },
    2: { open: '09:00', close: '21:00' },
    3: { open: '09:00', close: '21:00' },
    4: { open: '09:00', close: '21:00' },
    5: { open: '09:00', close: '17:00' },
    6: { open: '12:00', close: '17:00' },
  },
  'ratner athletics': {
    0: { open: '07:00', close: '22:00' },
    1: { open: '06:00', close: '23:00' },
    2: { open: '06:00', close: '23:00' },
    3: { open: '06:00', close: '23:00' },
    4: { open: '06:00', close: '23:00' },
    5: { open: '06:00', close: '22:00' },
    6: { open: '07:00', close: '22:00' },
  },
  'hutchinson commons': {
    0: { open: '11:00', close: '20:00' },
    1: { open: '07:30', close: '20:00' },
    2: { open: '07:30', close: '20:00' },
    3: { open: '07:30', close: '20:00' },
    4: { open: '07:30', close: '20:00' },
    5: { open: '07:30', close: '20:00' },
    6: { open: '11:00', close: '20:00' },
  },
}))

// Convert LibCal time strings like "8am", "9:45pm" → "08:00", "21:45"
function libcalToHHMM(t: string): string {
  const m = t.trim().match(/^(\d+)(?::(\d+))?\s*(am|pm)$/i)
  if (!m) return t
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  if (m[3].toLowerCase() === 'pm' && h !== 12) h += 12
  if (m[3].toLowerCase() === 'am' && h === 12) h = 0
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function normalizeLocationName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function chicagoParts(date: Date): { dayOfWeek: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  const hour = Number(get('hour')) % 24
  const minute = Number(get('minute'))
  return { dayOfWeek, minutes: hour * 60 + minute }
}

interface LibCalResult {
  name: string
  status: string        // 'open' | 'closed' | 'not-set'
  rendered: string      // "8am - 10pm" or ""
  currentlyOpen: boolean
  hours: { open: string; close: string } | null  // HH:MM format
}

async function fetchLibCalHours(lid: number): Promise<LibCalResult | null> {
  try {
    const url = `https://api3.libcal.com/api_hours_today.php?iid=${LIBCAL_IID}&lid=${lid}&format=json&systemTime=0`
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'CampusGeo/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    if (!resp.ok) return null
    const data = (await resp.json()) as { locations?: Array<{
      lid: number
      name: string
      rendered: string
      times: { status: string; currently_open?: boolean; hours?: Array<{ from: string; to: string }> }
    }> }
    const loc = (data.locations ?? []).find((l) => l.lid === lid)
    if (!loc) return null
    const t = loc.times
    const h = t.hours?.[0]
    return {
      name: loc.name,
      status: t.status,
      rendered: loc.rendered ?? '',
      currentlyOpen: t.currently_open ?? false,
      hours: h ? { open: libcalToHHMM(h.from), close: libcalToHHMM(h.to) } : null,
    }
  } catch {
    return null
  }
}

function minutesToOpen(hours: { open: string; close: string }, currentMinutes: number): number {
  const [oh, om] = hours.open.split(':').map(Number)
  return oh * 60 + om - currentMinutes
}

function minutesToClose(hours: { open: string; close: string }, currentMinutes: number): number {
  const [ch, cm] = hours.close.split(':').map(Number)
  return ch * 60 + cm - currentMinutes
}

export async function checkHours(input: CheckHoursInput) {
  const checkAt = input.checkTime ? new Date(input.checkTime) : new Date()
  if (Number.isNaN(checkAt.getTime())) {
    return { error: 'Invalid checkTime — expected an ISO 8601 timestamp.' }
  }

  const normalized = normalizeLocationName(input.locationName)
  if (normalized.length < 2) return { error: 'Location name too short.' }

  const { dayOfWeek, minutes: currentMinutes } = chicagoParts(checkAt)
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

  // --- LibCal libraries ---
  for (const [key, { lid, displayName }] of Object.entries(LIBCAL_LOCATIONS)) {
    if (!normalized.includes(key) && !key.includes(normalized)) continue

    const lc = await fetchLibCalHours(lid)
    if (!lc) {
      // LibCal unreachable — fall through to static
      break
    }

    // Determine open/closed status by comparing currentMinutes against today's hours.
    // LibCal's currently_open is accurate for "right now"; if checkTime is specified,
    // compare manually against the returned hours (today's hours, best effort for same day).
    let isOpen: boolean
    let message: string

    if (lc.status === 'closed') {
      isOpen = false
      message = `${displayName} is closed today (${dayNames[dayOfWeek]}).`
    } else if (lc.status === 'not-set' || !lc.hours) {
      isOpen = false
      message = `Hours not published for ${displayName} today. Check lib.uchicago.edu/libraries/libraries-hours/`
    } else {
      const [oh, om] = lc.hours.open.split(':').map(Number)
      const [ch, cm] = lc.hours.close.split(':').map(Number)
      const openMin = oh * 60 + om
      const closeMin = ch * 60 + cm
      isOpen = currentMinutes >= openMin && currentMinutes < closeMin

      if (isOpen) {
        const minsLeft = minutesToClose(lc.hours, currentMinutes)
        message = `${displayName} is open now (${lc.rendered}). Closes in ${minsLeft} min.`
      } else if (currentMinutes < openMin) {
        const minsToOpen = minutesToOpen(lc.hours, currentMinutes)
        message = `${displayName} is not yet open (opens at ${lc.hours.open}, in ${minsToOpen} min). Today: ${lc.rendered}.`
      } else {
        message = `${displayName} is closed for today (closed at ${lc.hours.close}). Today: ${lc.rendered}.`
      }
    }

    return {
      locationName: displayName,
      found: true,
      isOpen,
      checkTime: checkAt.toISOString(),
      todayHours: lc.hours,
      renderedHours: lc.rendered,
      message,
      source: 'libcal' as const,
      hoursUrl: 'https://www.lib.uchicago.edu/libraries/libraries-hours/',
    }
  }

  // --- Static fallback ---
  let staticEntry: [string, WeekSchedule] | null = null
  for (const [key, schedule] of STATIC_HOURS) {
    if (normalized.includes(key) || key.includes(normalized)) {
      staticEntry = [key, schedule]
      break
    }
  }

  if (!staticEntry) {
    const knownLocations = [
      ...Object.values(LIBCAL_LOCATIONS).map((v) => v.displayName),
      ...Array.from(STATIC_HOURS.keys()).map((k) => k.replace(/\b\w/g, (c) => c.toUpperCase())),
    ]
    return {
      locationName: input.locationName,
      found: false,
      message: `No hours data for "${input.locationName}". Known locations: ${knownLocations.join(', ')}.`,
    }
  }

  const [matchedName, schedule] = staticEntry
  const todaySchedule = schedule[dayOfWeek]
  const displayName = matchedName.replace(/\b\w/g, (c) => c.toUpperCase())

  if (!todaySchedule) {
    return {
      locationName: displayName,
      found: true,
      isOpen: false,
      checkTime: checkAt.toISOString(),
      todayHours: null,
      renderedHours: 'Closed',
      message: `${displayName} is closed today (${dayNames[dayOfWeek]}).`,
      source: 'static' as const,
    }
  }

  const [openH, openM] = todaySchedule.open.split(':').map(Number)
  const [closeH, closeM] = todaySchedule.close.split(':').map(Number)
  const openMinutes = openH * 60 + openM
  const closeMinutes = closeH * 60 + closeM
  const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes

  const rendered = `${todaySchedule.open}–${todaySchedule.close}`

  return {
    locationName: displayName,
    found: true,
    isOpen,
    checkTime: checkAt.toISOString(),
    todayHours: todaySchedule,
    renderedHours: rendered,
    message: isOpen
      ? `${displayName} is open now (closes at ${todaySchedule.close}).`
      : currentMinutes < openMinutes
      ? `${displayName} is not yet open (opens at ${todaySchedule.open}).`
      : `${displayName} is closed for today (closed at ${todaySchedule.close}).`,
    source: 'static' as const,
  }
}
