import { z } from 'zod'

export const CheckHoursInputSchema = z.object({
  locationName: z.string().describe('Campus location name, e.g. "Regenstein Library", "Crerar Library"'),
  checkTime: z.string().optional().describe('ISO 8601 timestamp, defaults to now'),
})

export type CheckHoursInput = z.infer<typeof CheckHoursInputSchema>

// Static hours data — in production this would come from DynamoDB `campus-hours` table
// Format: { [normalizedName]: { [dayIndex 0=Sun]: { open: "HH:MM", close: "HH:MM" } | null } }
const CAMPUS_HOURS: Record<string, Record<number, { open: string; close: string } | null>> = {
  'regenstein library': {
    0: { open: '10:00', close: '22:00' },
    1: { open: '08:30', close: '22:00' },
    2: { open: '08:30', close: '22:00' },
    3: { open: '08:30', close: '22:00' },
    4: { open: '08:30', close: '22:00' },
    5: { open: '08:30', close: '22:00' },
    6: { open: '10:00', close: '22:00' },
  },
  'crerar library': {
    0: { open: '10:00', close: '22:00' },
    1: { open: '08:00', close: '22:00' },
    2: { open: '08:00', close: '22:00' },
    3: { open: '08:00', close: '22:00' },
    4: { open: '08:00', close: '22:00' },
    5: { open: '08:00', close: '22:00' },
    6: { open: '10:00', close: '22:00' },
  },
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
}

function normalizeLocationName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function findHoursEntry(name: string): [string, Record<number, { open: string; close: string } | null>] | null {
  const normalized = normalizeLocationName(name)
  const direct = CAMPUS_HOURS[normalized]
  if (direct) return [normalized, direct]

  const match = Object.entries(CAMPUS_HOURS).find(
    ([key]) => normalized.includes(key) || key.includes(normalized)
  )
  return match ?? null
}

export async function checkHours(input: CheckHoursInput) {
  const checkAt = input.checkTime ? new Date(input.checkTime) : new Date()
  const entry = findHoursEntry(input.locationName)

  if (!entry) {
    return {
      locationName: input.locationName,
      found: false,
      message: `No hours data for "${input.locationName}". Known locations: ${Object.keys(CAMPUS_HOURS).map(k => k.replace(/\b\w/g, c => c.toUpperCase())).join(', ')}.`,
    }
  }

  const [matchedName, schedule] = entry
  const dayOfWeek = checkAt.getDay()
  const todaySchedule = schedule[dayOfWeek]

  const displayName = matchedName.replace(/\b\w/g, (c) => c.toUpperCase())
  const timeStr = checkAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (!todaySchedule) {
    return {
      locationName: displayName,
      found: true,
      isOpen: false,
      checkTime: checkAt.toISOString(),
      message: `${displayName} is closed today (${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dayOfWeek]}).`,
    }
  }

  const [openH, openM] = todaySchedule.open.split(':').map(Number)
  const [closeH, closeM] = todaySchedule.close.split(':').map(Number)
  const currentMinutes = checkAt.getHours() * 60 + checkAt.getMinutes()
  const openMinutes = openH * 60 + openM
  const closeMinutes = closeH * 60 + closeM
  const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes

  return {
    locationName: displayName,
    found: true,
    isOpen,
    checkTime: checkAt.toISOString(),
    hours: todaySchedule,
    message: isOpen
      ? `${displayName} is open now (closes at ${todaySchedule.close}).`
      : currentMinutes < openMinutes
      ? `${displayName} is not yet open (opens at ${todaySchedule.open}).`
      : `${displayName} is closed for today (closed at ${todaySchedule.close}).`,
  }
}
