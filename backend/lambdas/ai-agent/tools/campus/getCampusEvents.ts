import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'

const s3 = new S3Client({ region: 'us-east-1' })
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const TZ = 'America/Chicago'

// Max VEVENTs to parse from the iCal feed (performance guard — 3-day feeds can have 500+)
const MAX_VEVENTS = 300

// Fetch a large fixed window so one cache serves all daysAhead values for that day.
const FETCH_DAYS = 30

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

// Cache shape: fetchedAt as ISO string (checked on read), events for the full FETCH_DAYS window
interface EventsCache {
  fetchedAt: string
  events: CampusEvent[]
}

import { parseIcalText, parseIcalDate, parseIcalTime, RawVEvent } from './lib/ical'

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
// Time helpers (Chicago time)
// ---------------------------------------------------------------------------

function todayChicago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date())
}

function addDays(yyyy_mm_dd: string, n: number): string {
  // Parse at noon to avoid DST boundary issues
  const d = new Date(`${yyyy_mm_dd}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtLocalTime(isoStr: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(isoStr))
}

// ---------------------------------------------------------------------------
// S3 cache helpers — date-scoped key so stale day never collides with today
// ---------------------------------------------------------------------------

function cacheKey(): string {
  return `cache/events/${todayChicago()}.json`
}

async function readCache(): Promise<EventsCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: cacheKey() }))
    const cache = JSON.parse(await r.Body!.transformToString()) as EventsCache
    if (!cache.fetchedAt) return null
    if (Date.now() - Date.parse(cache.fetchedAt) >= CACHE_TTL_MS) return null
    return cache
  } catch { return null }
}

async function writeCache(c: EventsCache): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(), Key: cacheKey(),
      Body: JSON.stringify(c), ContentType: 'application/json',
    }))
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function getCampusEvents(input: GetCampusEventsInput) {
  const today = todayChicago()
  const windowEnd = addDays(today, input.daysAhead)

  let allEvents: CampusEvent[]
  let fetchedAt: string

  const cached = await readCache()
  if (cached) {
    allEvents = cached.events
    fetchedAt = cached.fetchedAt
  } else {
    try {
      const url = `https://events.uchicago.edu/live/ical/events/only_future/1/days/${FETCH_DAYS}/`
      const resp = await fetch(url, {
        headers: { Accept: 'text/calendar', 'User-Agent': 'CampusGeo/1.0 (academic research)' },
        signal: AbortSignal.timeout(12000),
      })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      const raw = parseIcalText(text, MAX_VEVENTS)
      allEvents = raw.map(mapRawEvent)
      fetchedAt = new Date().toISOString()
      await writeCache({ fetchedAt, events: allEvents })
    } catch (err) {
      return {
        error: `Could not fetch campus events: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  // ALWAYS filter to the requested window in Chicago time, even on a cache hit.
  // This ensures a cache written earlier today never surfaces past-today events.
  let events = allEvents.filter((e) => e.date >= today && e.date <= windowEnd && !e.isCanceled)

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

  const trimmed = events.slice(0, input.limit)

  return {
    events: trimmed,
    returned: trimmed.length,
    totalInWindow: events.length,
    windowStart: today,
    windowEnd,
    daysAhead: input.daysAhead,
    fetchedAtLocal: fmtLocalTime(fetchedAt),
    source: 'events.uchicago.edu (iCal)',
  }
}
