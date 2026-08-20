import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'

const s3 = new S3Client({ region: 'us-east-1' })
const CACHE_KEY = 'cache/events/latest.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

// Max VEVENTs to parse from the iCal feed (performance guard — 3-day feeds can have 500+)
const MAX_VEVENTS = 300

export const GetCampusEventsInputSchema = z.object({
  daysAhead: z.number().int().min(1).max(30).optional().default(7)
    .describe('Number of days ahead to look for events (default 7)'),
  limit: z.number().int().min(1).max(20).optional().default(10)
    .describe('Max events to return (default 10)'),
  keyword: z.string().max(100).optional()
    .describe('Filter events by keyword in title, summary, or location'),
}).strict()

export type GetCampusEventsInput = z.infer<typeof GetCampusEventsInputSchema>

export interface CampusEvent {
  id: string
  title: string
  date: string
  startTime: string | null
  endTime: string | null
  location: string | null
  url: string | null
  isOnline: boolean
  isCanceled: boolean
  summary: string | null
  geo: { lat: number; lon: number } | null
  categories: string[]
  isAllDay: boolean
}

interface EventsCache {
  cachedAt: number
  daysAhead: number
  events: CampusEvent[]
  total: number
}

// ---------------------------------------------------------------------------
// Minimal iCal (RFC 5545) parser — no external dependency
// ---------------------------------------------------------------------------

interface RawVEvent {
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

function icalUnescape(s: string): string {
  return s
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\n/gi, '\n')
    .replace(/\\\\/g, '\\')
}

function stripHtml(s: string): string {
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

function parseIcalText(text: string, maxEvents: number): RawVEvent[] {
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

    // Find first colon to split key:value.
    // Properties with parameters: "DTSTART;TZID=America/Chicago:20260820T100000"
    // The param block comes before the first colon.
    const ci = line.indexOf(':')
    if (ci === -1) continue
    const keyFull = line.slice(0, ci)
    const rawValue = line.slice(ci + 1)
    const value = icalUnescape(rawValue)
    const semiIdx = keyFull.indexOf(';')
    const keyBase = (semiIdx === -1 ? keyFull : keyFull.slice(0, semiIdx)).toUpperCase()
    const params = semiIdx === -1 ? '' : keyFull.slice(semiIdx)

    switch (keyBase) {
      case 'UID':
        current.uid = value
        break
      case 'SUMMARY':
        current.summary = value
        break
      case 'DTSTART':
        current.dtstart = rawValue   // keep raw for date parsing
        current.isAllDay = params.includes('VALUE=DATE') || rawValue.length === 8
        break
      case 'DTEND':
        current.dtend = rawValue
        break
      case 'LOCATION':
        current.location = value || null
        break
      case 'DESCRIPTION':
        // Prefer plain text; HTML version in X-ALT-DESC is verbose
        current.description = stripHtml(value) || null
        break
      case 'URL':
        current.url = rawValue || null
        break
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
      case 'X-LIVEWHALE-ALL-DAY':
        current.isAllDay = value === '1'
        break
      case 'X-LIVEWHALE-ID':
        current.lwId = value
        break
    }
  }

  return events
}

// Parse a raw DTSTART/DTEND string to HH:MM (returns null for all-day dates)
function parseIcalTime(raw: string | null): string | null {
  if (!raw || raw.length <= 8) return null
  // "20260820T140000" or "20260820T140000Z"
  const tPart = raw.indexOf('T')
  if (tPart === -1) return null
  const time = raw.slice(tPart + 1, tPart + 7)
  if (time.length < 4) return null
  return `${time.slice(0, 2)}:${time.slice(2, 4)}`
}

// Parse raw DTSTART to a locale date string ("August 20")
function parseIcalDate(raw: string): string {
  const datePart = raw.slice(0, 8)
  if (datePart.length < 8) return raw
  const year = Number(datePart.slice(0, 4))
  const month = Number(datePart.slice(4, 6)) - 1
  const day = Number(datePart.slice(6, 8))
  return new Date(year, month, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

function mapRawEvent(e: RawVEvent): CampusEvent {
  return {
    id: e.lwId ?? e.uid,
    title: e.summary,
    date: parseIcalDate(e.dtstart),
    startTime: parseIcalTime(e.dtstart),
    endTime: parseIcalTime(e.dtend),
    location: e.location,
    url: e.url,
    isOnline: e.categories.includes('Online') || e.location?.toLowerCase().includes('zoom') === true,
    isCanceled: e.isCanceled,
    summary: e.description,
    geo: e.geo,
    categories: e.categories,
    isAllDay: e.isAllDay,
  }
}

// ---------------------------------------------------------------------------
// S3 cache helpers
// ---------------------------------------------------------------------------

async function readCache(daysAhead: number): Promise<EventsCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: CACHE_KEY }))
    const cache = JSON.parse(await r.Body!.transformToString()) as EventsCache
    if (cache.daysAhead === daysAhead && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
      return cache
    }
    return null
  } catch {
    return null
  }
}

async function writeCache(c: EventsCache): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(), Key: CACHE_KEY,
      Body: JSON.stringify(c), ContentType: 'application/json',
    }))
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getCampusEvents(input: GetCampusEventsInput) {
  let events: CampusEvent[]
  let total: number
  let fromCache = false

  const cached = await readCache(input.daysAhead)
  if (cached) {
    events = cached.events
    total = cached.total
    fromCache = true
  } else {
    try {
      const url = `https://events.uchicago.edu/live/ical/events/only_future/1/days/${input.daysAhead}/`
      const resp = await fetch(url, {
        headers: { Accept: 'text/calendar', 'User-Agent': 'CampusGeo/1.0 (academic research)' },
        signal: AbortSignal.timeout(12000),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      const raw = parseIcalText(text, MAX_VEVENTS)
      events = raw.map(mapRawEvent)
      total = events.length
      await writeCache({ cachedAt: Date.now(), daysAhead: input.daysAhead, events, total })
    } catch (err) {
      return {
        error: `Could not fetch campus events: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // Keyword filter
  if (input.keyword) {
    const kw = input.keyword.toLowerCase()
    events = events.filter(
      (e) =>
        e.title.toLowerCase().includes(kw) ||
        (e.summary?.toLowerCase() ?? '').includes(kw) ||
        (e.location?.toLowerCase() ?? '').includes(kw) ||
        e.categories.some((c) => c.toLowerCase().includes(kw))
    )
  }

  const active = events.filter((e) => !e.isCanceled)
  const trimmed = active.slice(0, input.limit)

  return {
    events: trimmed,
    returned: trimmed.length,
    totalInWindow: total,
    daysAhead: input.daysAhead,
    source: 'events.uchicago.edu (iCal)',
    cachedAt: fromCache ? new Date(cached!.cachedAt).toISOString() : null,
  }
}
