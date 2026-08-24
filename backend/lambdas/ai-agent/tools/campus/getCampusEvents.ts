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
