import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'

const s3 = new S3Client({ region: 'us-east-1' })
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

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

interface CalendarCache {
  cachedAt: number
  academicYear: string
  entries: CalendarEntry[]
  source: 'catalog-html' | 'registrar-html'
  sourceUrl: string
}

// ---------------------------------------------------------------------------
// Date utilities — America/Chicago logic, never new Date(str) UTC conversion
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function toISO(month: string, day: string | number, year: number): string {
  const m = MONTH_MAP[month.toLowerCase().replace('.', '')]
  if (!m) return ''
  return `${year}-${String(m).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`
}

function currentAcademicYear(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  // Academic year starts with Autumn (September). If month >= 6 (summer), new AY starts in fall.
  const ayStart = month >= 6 ? year : year - 1
  return `${ayStart}-${String(ayStart + 1).slice(-2)}`
}

function ayStartYear(ay: string): number {
  return parseInt(ay.split('-')[0]) || new Date().getFullYear()
}

function inferKind(label: string): CalendarEntry['kind'] {
  const l = label.toLowerCase()
  if (/\b(exam|examination|final)\b/.test(l)) return 'exams'
  if (/\b(thanksgiving|spring break|winter break|winter recess|reading period|no classes|holiday|recess)\b/.test(l)) return 'breaks'
  if (
    /\b(instruction|classes|teaching|quarter)\b/.test(l) &&
    /\b(begins?|starts?|ends?|concludes?)\b/.test(l)
  ) return 'instruction'
  if (
    /\b(convocation|orientation)\b/.test(l) ||
    (/\b(begins?|starts?)\b/.test(l) && /\b(quarter|term|session)\b/.test(l))
  ) return 'instruction'
  if (/\b(deadline|last day|add\/drop|add or drop|withdrawal|grades? due|grade submission|registration)\b/.test(l)) return 'deadlines'
  return 'other'
}

// ---------------------------------------------------------------------------
// HTML parsing — minimal, no external deps
// ---------------------------------------------------------------------------

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
}

// Normalize em/en dashes to a single marker so range splitting is uniform
function normalizeDash(s: string): string {
  return s.replace(/\s*[–—]\s*|\s+-\s+/g, '–')
}

// Parse a date cell to { date, endDate } ISO strings.
// Handles "September 29, 2026", "September 29–October 7", "September 29", "Sept. 29"
function parseDateCell(
  raw: string,
  quarterStartYear: number,
): { date: string; endDate: string | null } | null {
  const t = normalizeDash(decodeEntities(stripTags(raw)).trim())

  // Range: "Month Day – Month Day[, Year]"
  const rangeCross = t.match(
    /^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})\s*–\s*(\w+\.?)\s+(\d{1,2})(?:,?\s+(\d{4}))?/i,
  )
  if (rangeCross) {
    const [, m1, d1, m2, d2, yrStr] = rangeCross
    const year = yrStr ? parseInt(yrStr) : quarterStartYear
    const startM = MONTH_MAP[m1.toLowerCase().replace('.', '')] ?? 0
    const endM = MONTH_MAP[m2.toLowerCase().replace('.', '')] ?? 0
    const endYear = endM > 0 && endM < startM ? year + 1 : year
    const date = toISO(m1, d1, year)
    const endDate = toISO(m2, d2, endYear)
    return date ? { date, endDate: endDate || null } : null
  }

  // Range same month: "Month Day–Day[, Year]"
  const rangeSame = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})\s*–\s*(\d{1,2})(?:,?\s+(\d{4}))?/i)
  if (rangeSame) {
    const [, month, d1, d2, yrStr] = rangeSame
    const year = yrStr ? parseInt(yrStr) : quarterStartYear
    const date = toISO(month, d1, year)
    const endDate = toISO(month, d2, year)
    return date ? { date, endDate: endDate || null } : null
  }

  // Single date with year: "Month Day, Year" or "Day Month Year" or "Weekday, Month Day, Year"
  const withYear = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2}),?\s+(\d{4})/i)
  if (withYear) {
    const [, month, day, year] = withYear
    const date = toISO(month, day, parseInt(year))
    return date ? { date, endDate: null } : null
  }

  // Single date without year: "Month Day"
  const noYear = t.match(/^(?:\w+day,?\s+)?(\w+\.?)\s+(\d{1,2})$/i)
  if (noYear) {
    const [, month, day] = noYear
    const m = MONTH_MAP[month.toLowerCase().replace('.', '')] ?? 0
    // Autumn months (Aug–Dec) → quarterStartYear; Winter/Spring/Summer → +1
    const year = m >= 6 ? quarterStartYear : quarterStartYear + 1
    const date = toISO(month, day, year)
    return date ? { date, endDate: null } : null
  }

  return null
}

// Extract <td> inner HTML list from a <tr> inner HTML
function extractTdCells(rowInner: string): string[] {
  const cells: string[] = []
  const tdPat = /<td[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null
  while ((m = tdPat.exec(rowInner)) !== null) {
    cells.push(m[1])
  }
  return cells
}

// Extract label+date pairs from an HTML block for a given quarter
function parseTableBlock(html: string, quarterName: string, quarterYear: number): CalendarEntry[] {
  const entries: CalendarEntry[] = []
  const trPat = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let trMatch: RegExpExecArray | null

  while ((trMatch = trPat.exec(html)) !== null) {
    const cells = extractTdCells(trMatch[1])
    if (cells.length < 2) continue

    const label = stripTags(decodeEntities(cells[0])).trim()
    const dateRaw = cells[cells.length - 1]

    if (!label || /^\s*(date|event|description)\s*$/i.test(label)) continue
    if (label.length > 200) continue // garbage row

    const parsed = parseDateCell(dateRaw, quarterYear)
    if (!parsed || !parsed.date) continue

    entries.push({
      label,
      date: parsed.date,
      endDate: parsed.endDate,
      quarter: quarterName,
      kind: inferKind(label),
    })
  }

  return entries
}

const QUARTERS = ['Autumn', 'Winter', 'Spring', 'Summer'] as const

// Main HTML parser: find quarter headings, parse tables in each section
function parseCatalogHtml(html: string, ayStart: number): CalendarEntry[] {
  const all: CalendarEntry[] = []

  // Split on heading elements (h2/h3/h4)
  const sections = html.split(/<h[2-5][^>]*>/i)

  for (const section of sections) {
    // Check if this section starts with a quarter name
    const headingText = stripTags(decodeEntities(section.slice(0, 200)))
    let quarterName: string | null = null

    for (const q of QUARTERS) {
      if (headingText.toLowerCase().includes(q.toLowerCase())) {
        quarterName = q
        break
      }
    }
    if (!quarterName) continue

    // Year for this quarter: Autumn → ayStart, others → ayStart+1
    const qYear = quarterName === 'Autumn' ? ayStart : ayStart + 1

    const entries = parseTableBlock(section, quarterName, qYear)
    all.push(...entries)
  }

  // Fallback: if no sections found by headings, look for quarter name near tables
  if (all.length === 0) {
    for (const q of QUARTERS) {
      const qYear = q === 'Autumn' ? ayStart : ayStart + 1
      const idx = html.toLowerCase().indexOf(q.toLowerCase())
      if (idx === -1) continue
      const slice = html.slice(idx, idx + 8000)
      const entries = parseTableBlock(slice, q, qYear)
      all.push(...entries)
    }
  }

  return all
}

// ---------------------------------------------------------------------------
// S3 cache
// ---------------------------------------------------------------------------

function cacheKey(ay: string): string {
  return `cache/academic-calendar/${ay}.json`
}

async function readCache(ay: string): Promise<CalendarCache | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: cacheKey(ay) }))
    const c = JSON.parse(await r.Body!.transformToString()) as CalendarCache
    return Date.now() - c.cachedAt < CACHE_TTL_MS ? c : null
  } catch {
    return null
  }
}

async function writeCache(c: CalendarCache): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: cacheKey(c.academicYear),
      Body: JSON.stringify(c),
      ContentType: 'application/json',
    }))
  } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Fetch and parse from web
// ---------------------------------------------------------------------------

async function fetchAndParse(ay: string): Promise<CalendarCache | null> {
  const ayStart = ayStartYear(ay)

  const sources: Array<{ url: string; type: CalendarCache['source'] }> = [
    { url: CATALOG_URL, type: 'catalog-html' },
    { url: REGISTRAR_URL, type: 'registrar-html' },
  ]

  for (const { url, type } of sources) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'CampusGeo/1.0 (academic research)' },
        signal: AbortSignal.timeout(10000),
      })
      if (!resp.ok) continue

      const html = await resp.text()
      const entries = parseCatalogHtml(html, ayStart)

      if (entries.length >= 4) {
        return {
          cachedAt: Date.now(),
          academicYear: ay,
          entries,
          source: type,
          sourceUrl: url,
        }
      }
    } catch {
      // continue to next source
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Public handler
// ---------------------------------------------------------------------------

export async function getAcademicCalendar(input: GetAcademicCalendarInput) {
  const ay = input.academicYear ?? currentAcademicYear()

  let cache = await readCache(ay)
  if (!cache) {
    cache = await fetchAndParse(ay)
    if (cache) await writeCache(cache)
  }

  if (!cache) {
    return {
      found: false as const,
      academicYear: ay,
      sourceUrl: CATALOG_URL,
      message:
        'Academic calendar data is currently unavailable. ' +
        'Visit https://collegecatalog.uchicago.edu/thecollege/academiccalendar/ directly.',
    }
  }

  let entries = cache.entries

  if (input.quarter) {
    const q = input.quarter.charAt(0).toUpperCase() + input.quarter.slice(1)
    entries = entries.filter((e) => e.quarter === q)
  }

  if (input.kind && input.kind !== 'all') {
    entries = entries.filter((e) => e.kind === input.kind)
  }

  return {
    found: true as const,
    academicYear: ay,
    quarter: input.quarter ?? 'all',
    source: cache.source,
    sourceUrl: cache.sourceUrl,
    fetchedAt: new Date(cache.cachedAt).toISOString(),
    entries,
    count: entries.length,
  }
}
