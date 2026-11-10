// RFC 5545 iCal (VEVENT) parser — no external deps
// Shared between getCampusEvents and getAcademicCalendar

export interface RawVEvent {
  uid: string
  summary: string
  dtstart: string
  dtend: string | null
  location: string | null
  description: string | null
  url: string | null
  geo: { lat: number; lon: number } | null
  categories: string[]
  isAllDay: boolean
  isCanceled: boolean
  lwId: string | null
}

export function icalUnescape(s: string): string {
  return s
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/gi, '\n')
    .replace(/\\\\/g, '\\')
}

export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseIcalText(text: string, maxEvents: number): RawVEvent[] {
  // Unfold lines: CRLF/LF followed by space or tab is a continuation
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const lines = unfolded.split(/\r?\n/)

  const events: RawVEvent[] = []
  let current: Partial<RawVEvent> | null = null

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      if (events.length >= maxEvents) break
      current = { categories: [], isAllDay: false, isCanceled: false }
      continue
    }
    if (line === 'END:VEVENT') {
      if (current?.summary && current.dtstart) {
        events.push({
          uid: current.uid ?? '',
          summary: current.summary,
          dtstart: current.dtstart,
          dtend: current.dtend ?? null,
          location: current.location ?? null,
          description: current.description ?? null,
          url: current.url ?? null,
          geo: current.geo ?? null,
          categories: current.categories ?? [],
          isAllDay: current.isAllDay ?? false,
          isCanceled: current.isCanceled ?? false,
          lwId: current.lwId ?? null,
        })
      }
      current = null
      continue
    }
    if (current === null) continue

    // Properties with parameters: "DTSTART;TZID=America/Chicago:20260820T100000"
    const ci = line.indexOf(':')
    if (ci === -1) continue
    const keyFull = line.slice(0, ci)
    const rawValue = line.slice(ci + 1)
    const value = icalUnescape(rawValue)
    const semiIdx = keyFull.indexOf(';')
    const keyBase = (semiIdx === -1 ? keyFull : keyFull.slice(0, semiIdx)).toUpperCase()
    const params = semiIdx === -1 ? '' : keyFull.slice(semiIdx)

    switch (keyBase) {
      case 'UID':      current.uid = value; break
      case 'SUMMARY':  current.summary = value; break
      case 'DTSTART':
        current.dtstart = rawValue
        current.isAllDay = params.includes('VALUE=DATE') || rawValue.length === 8
        break
      case 'DTEND':    current.dtend = rawValue; break
      case 'LOCATION': current.location = value || null; break
      case 'DESCRIPTION': current.description = stripHtml(value) || null; break
      case 'URL':      current.url = rawValue || null; break
      case 'GEO': {
        const parts = rawValue.split(';')
        if (parts.length === 2) {
          const lat = parseFloat(parts[0])
          const lon = parseFloat(parts[1])
          if (!isNaN(lat) && !isNaN(lon)) current.geo = { lat, lon }
        }
        break
      }
      case 'CATEGORIES':
        current.categories = value.split(',').map((c) => c.trim()).filter(Boolean)
        break
      case 'STATUS':
        current.isCanceled = value.toUpperCase() === 'CANCELLED'
        break
      case 'X-LIVEWHALE-ALL-DAY': current.isAllDay = value === '1'; break
      case 'X-LIVEWHALE-ID':      current.lwId = value; break
    }
  }

  return events
}

// Parse a raw DTSTART/DTEND string to HH:MM (returns null for all-day dates)
export function parseIcalTime(raw: string | null): string | null {
  if (!raw || raw.length <= 8) return null
  const tPart = raw.indexOf('T')
  if (tPart === -1) return null
  const time = raw.slice(tPart + 1, tPart + 7)
  if (time.length < 4) return null
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`
}

// Parse raw DTSTART to a locale date string ("August 20")
export function parseIcalDate(raw: string): string {
  const datePart = raw.slice(0, 8)
  if (datePart.length < 8) return raw
  const year = Number(datePart.slice(0, 4))
  const month = Number(datePart.slice(4, 6)) - 1
  const day = Number(datePart.slice(6, 8))
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}
