import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'
import { parseIcalText } from './lib/ical'

const s3 = new S3Client({ region: 'us-east-1' })
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const FEED_CACHE_KEY = 'cache/academic-calendar/feed.json'

// Same LiveWhale system as getCampusEvents — Registrar group, academic-calendar tag
const ICAL_URL =
  'https://events.uchicago.edu/live/ical/events/group/Registrar/tag/academic-calendar' +
  '/start_date/-10%20years/end_date/%2B10%20years/max/10000'

// HTML fallback only if iCal fetch fails
const CATALOG_URL = 'https://collegecatalog.uchicago.edu/thecollege/academiccalendar/'
const REGISTRAR_URL = 'https://registrar.uchicago.edu/calendars/'

export const GetAcademicCalendarInputSchema = z.object({
  quarter: z.enum(['autumn', 'winter', 'spring', 'summer']).optional()
    .describe('Which quarter to return. Omit for all quarters in the academic year.'),
  academicYear: z.string().optional()
    .describe('Academic year, e.g. "2026-27". Omit for current academic year.'),
  kind: z.enum(['all', 'instruction', 'exams', 'breaks', 'deadlines']).optional()
    .describe('Filter by event type. Omit or "all" returns everything.'),
}).strict()

export type GetAcademicCalendarInput = z.infer<typeof GetAcademicCalendarInputSchema>

export interface CalendarEntry {
  label: string
  date: string          // ISO YYYY-MM-DD
  endDate: string | null
  quarter: string
  kind: 'instruction' | 'exams' | 'breaks' | 'deadlines' | 'other'
}

// Internal storage adds academicYear for in-memory filtering
interface StoredEntry extends CalendarEntry {
  academicYear: string
}

interface FeedCache {
  cachedAt: number
  entries: StoredEntry[]
  source: 'ics' | 'catalog-html' | 'registrar-html'
  sourceUrl: string
}

// ---------------------------------------------------------------------------
// Date utilities — numeric constructors only, never new Date(string)
// ---------------------------------------------------------------------------

function currentAcademicYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // Autumn starts in September; if month ≥ 9, new AY starts this year
  const ayStart = month >= 9 ? year : year - 1
  return `${ayStart}-${String(ayStart + 1).slice(-2)}`
}

// "YYYYMMDD" → "YYYY-MM-DD"
function icalDateToISO(yyyymmdd: string): string {
  const s = yyyymmdd.slice(0, 8)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

// Subtract one day from "YYYYMMDD" to convert exclusive DTEND to inclusive end date.
// Uses numeric Date constructor (local time) — no UTC off-by-one.
function prevDay(yyyymmdd: string): string {
  const y = parseInt(yyyymmdd.slice(0, 4))
  const m = parseInt(yyyymmdd.slice(4, 6))
  const d = parseInt(yyyymmdd.slice(6, 8))
  const dt = new Date(y, m - 1, d - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// DTEND is exclusive. If DTEND = DTSTART + 1 day, it is a single-day event → endDate null.
function resolveEndDate(dtstart: string, dtend: string | null): string | null {
  if (!dtend) return null
  const s = dtstart.slice(0, 8)
  const e = dtend.slice(0, 8)
  // Check if e === s + 1 day
  const sy = parseInt(s.slice(0, 4)), sm = parseInt(s.slice(4, 6)), sd = parseInt(s.slice(6, 8))
  const next = new Date(sy, sm - 1, sd + 1)
  const nextStr = `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, '0')}${String(next.getDate()).padStart(2, '0')}`
  return e === nextStr ? null : prevDay(e)
}

// Autumn: Sept-Dec → start year. Winter/Spring/Summer: Jan-Aug → previous year.
function dateToAcademicYear(yyyymmdd: string): string {
  const year = parseInt(yyyymmdd.slice(0, 4))
  const month = parseInt(yyyymmdd.slice(4, 6))
  const ayStart = month >= 9 ? year : year - 1
  return `${ayStart}-${String(ayStart + 1).slice(-2)}`
}

// ---------------------------------------------------------------------------
// Kind + quarter inference
// ---------------------------------------------------------------------------

const HOLIDAY_NAMES = [
  'labor day', 'memorial day', 'martin luther king', 'mlk day',
  'juneteenth', 'independence day', 'thanksgiving', 'veterans day',
  'presidents', 'columbus day', 'indigenous peoples day',
]

function inferKind(label: string, categories: string[]): CalendarEntry['kind'] {
  const l = label.toLowerCase()
  const cats = categories.map((c) => c.toLowerCase())

  if (/\b(exam|examination|final exam)\b/.test(l)) return 'exams'

  if (/\b(spring break|winter break|winter recess|reading period|no classes|holiday|recess)\b/.test(l)) return 'breaks'
  if (HOLIDAY_NAMES.some((h) => l.includes(h))) return 'breaks'
  if (cats.includes('holiday') || cats.includes('break')) return 'breaks'

  if (
    /\b(instruction begins?|instruction ends?|classes begin|classes end|quarter begins?|quarter ends?)\b/.test(l) ||
    (/\b(instruction|classes)\b/.test(l) && /\b(begins?|starts?|ends?)\b/.test(l))
  ) return 'instruction'

  if (/\b(deadline|last day|add\/drop|add or drop|withdrawal|grades? due|grade submission|registration)\b/.test(l)) return 'deadlines'

  return 'other'
}

function quarterFromLabel(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('autumn') || l.includes('fall')) return 'Autumn'
  if (l.includes('winter')) return 'Winter'
  if (l.includes('spring')) return 'Spring'
  if (l.includes('summer')) return 'Summer'
  return ''
}

function quarterFromDate(yyyymmdd: string): string {
  const month = parseInt(yyyymmdd.slice(4, 6))
  if (month >= 9) return 'Autumn'
  if (month <= 3) return 'Winter'
  if (month <= 6) return 'Spring'
  return 'Summer'
}

// ---------------------------------------------------------------------------
// iCal → StoredEntry
// ---------------------------------------------------------------------------

function icalEventToEntry(e: {
  summary: string
  dtstart: string
  dtend: string | null
  categories: string[]
}): StoredEntry | null {
  const dtstart = e.dtstart.slice(0, 8)
  if (dtstart.length < 8 || !/^\d{8}$/.test(dtstart)) return null

  const dateISO = icalDateToISO(dtstart)
  const endDate = resolveEndDate(dtstart, e.dtend)
  const label = e.summary.trim()
  const quarter = quarterFromLabel(label) || quarterFromDate(dtstart)
  const academicYear = dateToAcademicYear(dtstart)

  return {
    label,
    date: dateISO,
    endDate,
    quarter,
    kind: inferKind(label, e.categories),
    academicYear,
  }
}

// ---------------------------------------------------------------------------
// HTML fallback parser (column-order agnostic)
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function htmlStripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function htmlDecode(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#160;/g, ' ')
    .replace(/&#8211;/g, '–').replace(/&ndash;/g, '–')
    .replace(/&#8212;/g, '—').replace(/&mdash;/g, '—')
}

function toISOManual(month: string, day: string | number, year: number): string {
  const m = MONTH_MAP[month.toLowerCase().replace('.', '')]
  if (!m) return ''
  return `${year}-${String(m).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
}

function parseDateCell(raw: string, baseYear: number): { date: string; endDate: string | null } | null {
  const t = htmlDecode(htmlStripTags(raw)).replace(/\s*[–—]\s*|\s+-\s+/g, '–').trim()

  // Range cross-month: "Month Day – Month Day[, Year]"
  const xm = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})\s*–\s*(\w+\.?)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i)
  if (xm) {
    const [, m1, d1, m2, d2, yrStr] = xm
    const year = yrStr ? parseInt(yrStr) : baseYear
    const sm = MONTH_MAP[m1.toLowerCase().replace('.', '')] ?? 0
    const em = MONTH_MAP[m2.toLowerCase().replace('.', '')] ?? 0
    const endYear = em > 0 && em < sm ? year + 1 : year
    const date = toISOManual(m1, d1, year)
    const endDate = toISOManual(m2, d2, endYear)
    return date ? { date, endDate: endDate || null } : null
  }

  // Range same month: "Month Day–Day[, Year]"
  const sm = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})\s*–\s*(\d{1,2})(?:,?\s+(\d{4}))?/i)
  if (sm) {
    const [, month, d1, d2, yrStr] = sm
    const year = yrStr ? parseInt(yrStr) : baseYear
    const date = toISOManual(month, d1, year)
    const endDate = toISOManual(month, d2, year)
    return date ? { date, endDate: endDate || null } : null
  }

  // Single with year: "Month Day, Year"
  const wy = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2}),?\s+(\d{4})/i)
  if (wy) {
    const [, month, day, year] = wy
    const date = toISOManual(month, day, parseInt(year))
    return date ? { date, endDate: null } : null
  }

  // Single without year: "Month Day"
  const ny = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})$/i)
  if (ny) {
    const [, month, day] = ny
    const mo = MONTH_MAP[month.toLowerCase().replace('.', '')] ?? 0
    const year = mo >= 9 ? baseYear : baseYear + 1
    const date = toISOManual(month, day, year)
    return date ? { date, endDate: null } : null
  }

  return null
}

function extractTds(rowHtml: string): string[] {
  const tds: string[] = []
  const tdPat = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null
  while ((m = tdPat.exec(rowHtml)) !== null) tds.push(m[1])
  return tds
}

function parseHtmlToEntries(html: string, ayStart: number): StoredEntry[] {
  const all: StoredEntry[] = []

  // Split HTML on heading elements to identify quarter sections
  const sections = html.split(/<h[2-5][^>]*>/i)

  for (const section of sections) {
    const headText = htmlStripTags(htmlDecode(section.slice(0, 200)))
    let qName = ''
    for (const q of ['Autumn', 'Winter', 'Spring', 'Summer'] as const) {
      if (headText.toLowerCase().includes(q.toLowerCase())) { qName = q; break }
    }
    if (!qName) continue

    const qYear = qName === 'Autumn' ? ayStart : ayStart + 1

    const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let trMatch: RegExpExecArray | null
    while ((trMatch = trPat.exec(section)) !== null) {
      const cells = extractTds(trMatch[1])
      if (cells.length < 2) continue

      // Auto-detect date column: try first and last cell
      const parsed0 = parseDateCell(cells[0], qYear)
      const parsedN = parseDateCell(cells[cells.length - 1], qYear)

      let label: string
      let parsed: { date: string; endDate: string | null } | null

      if (parsed0 && !parsedN) {
        // Date in first column (UChicago table style: Date | Event)
        label = htmlStripTags(htmlDecode(cells[cells.length - 1])).trim()
        parsed = parsed0
      } else if (!parsed0 && parsedN) {
        // Date in last column
        label = htmlStripTags(htmlDecode(cells[0])).trim()
        parsed = parsedN
      } else if (parsed0) {
        // Both parse; prefer first-column-as-date (UChicago convention)
        label = htmlStripTags(htmlDecode(cells[cells.length - 1])).trim()
        parsed = parsed0
      } else {
        continue
      }

      if (!label || /^\s*(date|event|description)\s*$/i.test(label)) continue
      if (!parsed.date) continue

      all.push({
        label,
        date: parsed.date,
        endDate: parsed.endDate,
        quarter: qName,
        kind: inferKind(label, []),
        academicYear: dateToAcademicYear(parsed.date.replace(/-/g, '')),
      })
    }
  }

  return all
}

// ---------------------------------------------------------------------------
// S3 cache
// ---------------------------------------------------------------------------

async function readFeedCache(): Promise<FeedCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: FEED_CACHE_KEY }))
    const c = JSON.parse(await r.Body!.transformToString()) as FeedCache
    return Date.now() - c.cachedAt < CACHE_TTL_MS ? c : null
  } catch {
    return null
  }
}

async function writeFeedCache(c: FeedCache): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: FEED_CACHE_KEY,
      Body: JSON.stringify(c),
      ContentType: 'application/json',
    }))
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Fetch & parse
// ---------------------------------------------------------------------------

async function fetchAndParse(): Promise<FeedCache | null> {
  // 1. iCal (preferred — covers ±10 years, same LiveWhale system as getCampusEvents)
  try {
    const resp = await fetch(ICAL_URL, {
      headers: { Accept: 'text/calendar', 'User-Agent': 'CampusGeo/1.0 (academic research)' },
      signal: AbortSignal.timeout(12000),
    })
    if (resp.ok) {
      const text = await resp.text()
      const raw = parseIcalText(text, 10000)
      const entries = raw
        .map((e) => icalEventToEntry(e))
        .filter((e): e is StoredEntry => e !== null)

      if (entries.length >= 4) {
        return { cachedAt: Date.now(), entries, source: 'ics', sourceUrl: ICAL_URL }
      }
    }
  } catch { /* fall through to HTML */ }

  // 2. HTML fallback
  const now = new Date()
  const ayStart = now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1

  for (const { url, type } of [
    { url: CATALOG_URL, type: 'catalog-html' as const },
    { url: REGISTRAR_URL, type: 'registrar-html' as const },
  ]) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'CampusGeo/1.0 (academic research)' },
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) continue
      const html = await resp.text()
      const entries = parseHtmlToEntries(html, ayStart)
      if (entries.length >= 4) {
        return { cachedAt: Date.now(), entries, source: type, sourceUrl: url }
      }
    } catch { /* try next */ }
  }

  return null
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

export async function getAcademicCalendar(input: GetAcademicCalendarInput) {
  const ay = input.academicYear ?? currentAcademicYear()

  let cache = await readFeedCache()

  // Re-fetch if cache is missing or doesn't contain the requested academic year
  if (!cache || !cache.entries.some((e) => e.academicYear === ay)) {
    const fresh = await fetchAndParse()
    if (fresh) {
      await writeFeedCache(fresh)
      cache = fresh
    }
  }

  if (!cache || !cache.entries.some((e) => e.academicYear === ay)) {
    return {
      found: false as const,
      academicYear: ay,
      sourceUrl: ICAL_URL,
      message:
        'Academic calendar data is currently unavailable. ' +
        'Visit https://collegecatalog.uchicago.edu/thecollege/academiccalendar/ directly.',
    }
  }

  let entries = cache.entries.filter((e) => e.academicYear === ay)

  if (input.quarter) {
    const q = input.quarter.charAt(0).toUpperCase() + input.quarter.slice(1)
    entries = entries.filter((e) => e.quarter === q)
  }

  if (input.kind && input.kind !== 'all') {
    entries = entries.filter((e) => e.kind === input.kind)
  }

  // Strip internal academicYear field before returning
  const outputEntries: CalendarEntry[] = entries.map(({ academicYear: _ay, ...rest }) => rest)

  return {
    found: true as const,
    academicYear: ay,
    quarter: input.quarter ?? 'all',
    source: cache.source,
    sourceUrl: cache.sourceUrl,
    fetchedAt: new Date(cache.cachedAt).toISOString(),
    entries: outputEntries,
    count: outputEntries.length,
  }
}
