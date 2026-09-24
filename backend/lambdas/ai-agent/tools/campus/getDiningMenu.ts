import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'

const s3 = new S3Client({ region: 'us-east-1' })
const BASE = 'https://api.dineoncampus.com/v1'

const TTL_LOCATIONS = 7 * 24 * 60 * 60 * 1000  // 7 days
const TTL_PERIODS   = 24 * 60 * 60 * 1000        // 24 h
const TTL_MENU      = 6 * 60 * 60 * 1000          // 6 h

// Same normaliser as queryTrees / queryS3Layer
const norm = (s: unknown): string =>
  String(s ?? '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '')

// ── S3 cache ─────────────────────────────────────────────────────────────────

async function readCache<T>(key: string, ttl: number): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }))
    if (!r.Body) return null
    const d = JSON.parse(await r.Body.transformToString()) as T & { _at: number }
    if (Date.now() - d._at > ttl) return null
    return d
  } catch { return null }
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  try {
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(), Key: key,
      Body: JSON.stringify({ ...(payload as object), _at: Date.now() }),
      ContentType: 'application/json',
    }))
  } catch { /* non-fatal */ }
}

// ── DineOnCampus API types ────────────────────────────────────────────────────

interface RawLocation {
  id: string
  name: string
  active: boolean
  show_menus: boolean
}

interface RawBuilding {
  name: string
  locations: RawLocation[]
}

interface DiningLocation {
  id: string
  name: string
  buildingName: string
  active: boolean
  showMenus: boolean
}

interface DiningPeriod {
  id: string
  name: string
  sort_order: number
}

interface RawFilter {
  type: 'allergen' | 'label' | string
  name: string
}

interface RawItem {
  name: string
  desc?: string
  portion?: string
  calories?: number
  filters?: RawFilter[]
}

interface RawCategory {
  name: string
  items?: RawItem[]
}

interface RawMenuPeriod {
  name: string
  categories?: RawCategory[]
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

// The API is browser-facing; Chartwells' WAF 403s requests without a realistic UA/Referer.
const DOC_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Referer': 'https://dineoncampus.com/uchicago',
  'Origin': 'https://dineoncampus.com',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
}

function siteId(): string {
  const id = process.env.DINEONCAMPUS_SITE_ID
  if (!id) throw new Error('not-configured')
  return id
}

async function fetchLocations(): Promise<DiningLocation[]> {
  const key = 'cache/dining/locations.json'
  const hit = await readCache<{ locs: DiningLocation[] }>(key, TTL_LOCATIONS)
  if (hit) return hit.locs

  const url = `${BASE}/locations/all_locations?platform=0&site_id=${siteId()}&for_menus=true&with_address=false&with_buildings=true`
  const resp = await fetch(url, { headers: DOC_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!resp.ok) throw new Error(`locations ${resp.status}`)
  const json = await resp.json() as { buildings?: RawBuilding[] }

  const locs: DiningLocation[] = []
  for (const b of json.buildings ?? []) {
    for (const l of b.locations ?? []) {
      locs.push({ id: l.id, name: l.name, buildingName: b.name, active: l.active, showMenus: l.show_menus })
    }
  }
  await writeCache(key, { locs })
  return locs
}

async function fetchPeriods(
  locId: string, date: string
): Promise<{ periods: DiningPeriod[]; closed: boolean }> {
  const key = `cache/dining/periods/${locId}/${date}.json`
  const hit = await readCache<{ periods: DiningPeriod[]; closed: boolean }>(key, TTL_PERIODS)
  if (hit) return hit

  const resp = await fetch(`${BASE}/location/${locId}/periods?platform=0&date=${date}`, { headers: DOC_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!resp.ok) throw new Error(`periods ${resp.status}`)
  const json = await resp.json() as { closed?: boolean; periods?: DiningPeriod[] }

  const result = { periods: json.periods ?? [], closed: json.closed ?? false }
  await writeCache(key, result)
  return result
}

async function fetchPeriodMenu(
  locId: string, periodId: string, date: string
): Promise<RawMenuPeriod | null> {
  const key = `cache/dining/menu/${locId}/${periodId}/${date}.json`
  const hit = await readCache<{ mp: RawMenuPeriod }>(key, TTL_MENU)
  if (hit) return hit.mp

  const resp = await fetch(`${BASE}/location/${locId}/periods/${periodId}?platform=0&date=${date}`, { headers: DOC_HEADERS, signal: AbortSignal.timeout(8000) })
  if (!resp.ok) return null
  const json = await resp.json() as { menu?: { periods?: RawMenuPeriod[] } }
  const mp = json.menu?.periods?.[0] ?? null

  if (mp) await writeCache(key, { mp })
  return mp
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function todayChicago(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
}

function currentMealPeriod(): string {
  const h = parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(new Date()),
    10
  )
  if (h < 10) return 'breakfast'
  if (h < 15) return 'lunch'
  if (h < 21) return 'dinner'
  return 'late night'
}

// ── Schema ────────────────────────────────────────────────────────────────────

export const GetDiningMenuInputSchema = z.object({
  location: z.string().max(200)
    .describe('Dining hall name, fuzzy — "Cathey", "Arley Cathey", "Baker", "Bartlett", "Woodlawn"'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('YYYY-MM-DD; defaults to today (America/Chicago)'),
  period: z.enum(['breakfast', 'lunch', 'dinner', 'brunch', 'late night', 'all']).optional()
    .describe('Meal period; omit for the period matching current Chicago time'),
  dietary: z.array(z.string().max(50)).max(10).optional()
    .describe('Filter items by diet/allergen tag: "vegan", "vegetarian", "gluten-free", "halal"…'),
}).strict()

export type GetDiningMenuInput = z.infer<typeof GetDiningMenuInputSchema>

// ── Main handler ──────────────────────────────────────────────────────────────

export async function getDiningMenu(input: GetDiningMenuInput) {
  // Guard: env var not yet configured
  try { siteId() } catch {
    return {
      error: 'Dining menu service is not yet configured (DINEONCAMPUS_SITE_ID missing). ' +
        'Live menus are at dineoncampus.com/uchicago; dietary info at dining.uchicago.edu.',
    }
  }

  const date = input.date ?? todayChicago()
  const targetPeriod = input.period ?? currentMealPeriod()

  // 1. Resolve location
  let locations: DiningLocation[]
  try { locations = await fetchLocations() } catch (e) {
    return { error: `Could not fetch dining locations: ${(e as Error).message}` }
  }

  const normQ = norm(input.location)
  const matches = locations.filter(l =>
    l.showMenus && (norm(l.name).includes(normQ) || normQ.includes(norm(l.name)))
  )

  if (matches.length === 0) {
    return {
      found: false,
      query: input.location,
      suggestions: locations.filter(l => l.showMenus && l.active).map(l => l.name).sort(),
    }
  }
  const loc = matches[0]

  // 2. Get periods (closed check)
  let periods: DiningPeriod[]
  let closed: boolean
  try {
    const r = await fetchPeriods(loc.id, date)
    periods = r.periods; closed = r.closed
  } catch (e) {
    return { error: `Could not fetch periods for ${loc.name}: ${(e as Error).message}` }
  }

  if (closed || periods.length === 0) {
    return {
      found: true, location: loc.name, building: loc.buildingName,
      date, closed: true, periods: [],
      source: 'dineoncampus.com/uchicago', fetchedAt: new Date().toISOString(),
    }
  }

  // 3. Select period(s)
  let selected = periods
  if (targetPeriod !== 'all') {
    const normT = norm(targetPeriod)
    const exact = periods.filter(p => norm(p.name).includes(normT))
    if (exact.length > 0) selected = exact
  }
  selected = selected.sort((a, b) => a.sort_order - b.sort_order)

  // 4. Fetch menus and build response
  const normDietary = (input.dietary ?? []).map(norm)

  const resultPeriods = []
  for (const p of selected) {
    const raw = await fetchPeriodMenu(loc.id, p.id, date)
    if (!raw) continue

    const stations = (raw.categories ?? [])
      .map(cat => {
        const items = (cat.items ?? [])
          .map(item => {
            const labels: string[] = []
            const allergens: string[] = []
            for (const f of item.filters ?? []) {
              if (f.type === 'label') labels.push(f.name)
              else if (f.type === 'allergen') allergens.push(f.name)
            }
            return {
              name: item.name,
              ...(item.desc ? { desc: item.desc } : {}),
              ...(item.portion ? { portion: item.portion } : {}),
              ...(item.calories != null ? { calories: item.calories } : {}),
              labels, allergens,
            }
          })
          .filter(item => {
            if (normDietary.length === 0) return true
            const tags = [...item.labels, ...item.allergens].map(norm)
            return normDietary.every(d => tags.some(t => t.includes(d)))
          })
        return { name: cat.name, items }
      })
      .filter(s => s.items.length > 0)

    if (stations.length > 0 || normDietary.length === 0) {
      resultPeriods.push({ name: p.name, stations })
    }
  }

  return {
    found: true,
    location: loc.name,
    building: loc.buildingName,
    date,
    closed: false,
    periods: resultPeriods,
    source: 'dineoncampus.com/uchicago',
    fetchedAt: new Date().toISOString(),
  }
}
