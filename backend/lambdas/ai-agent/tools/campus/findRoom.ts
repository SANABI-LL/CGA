import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'
import { queryS3Layer } from './queryS3Layer'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })

export const FindRoomInputSchema = z.object({
  query: z.string().max(200).describe(
    'What the user is looking for: "mothers room", "restroom", "room 105", "computer classroom"'
  ),
  building: z.string().max(200).optional().describe(
    'Building name, alias, or BD_ID (e.g. "Crerar", "John Crerar Library", "A06"). Fuzzy match.'
  ),
  floor: z.string().max(10).optional().describe(
    'Floor number or code, e.g. "01", "B1". Omit to search all floors of the building.'
  ),
}).strict()

export type FindRoomInput = z.infer<typeof FindRoomInputSchema>

interface RoomEntry {
  bdId: string
  building: string
  floor: string
  room: string
  use: string
  areaSf?: number
  centroid?: [number, number]
  tags?: string[]
}

// Lambda memory cache for rooms_index.json (1-hour TTL)
let _roomsCache: RoomEntry[] | null = null
let _roomsCacheAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000

async function getRoomsIndex(): Promise<RoomEntry[]> {
  if (_roomsCache && Date.now() - _roomsCacheAt < CACHE_TTL_MS) return _roomsCache
  const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: 'plans/rooms_index.json' }))
  const text = await obj.Body!.transformToString()
  _roomsCache = JSON.parse(text) as RoomEntry[]
  _roomsCacheAt = Date.now()
  return _roomsCache
}

// Normalise a string for fuzzy comparison: lowercase, strip punctuation/articles
function norm(s: string): string {
  return s.toLowerCase().replace(/['\-.,]/g, '').replace(/\bthe\b/g, '').replace(/\s+/g, ' ').trim()
}

// Resolve a free-text building reference to a BD_ID (e.g. "Crerar" → "A06").
// Checks exact BD_ID first, then alias prefix match, then substring on building name.
function resolveBdId(ref: string, index: RoomEntry[]): string | null {
  const n = norm(ref)

  // Exact BD_ID (e.g. "A06")
  const byId = index.find((e) => e.bdId.toLowerCase() === n)
  if (byId) return byId.bdId

  // Alias map — common short names used by students/staff
  const ALIASES: Record<string, string> = {
    'crerar': 'A06',
    'john crerar': 'A06',
    'crerar library': 'A06',
    'john crerar library': 'A06',
  }
  if (ALIASES[n]) return ALIASES[n]

  // Fuzzy: building name contains ref
  const byName = index.find((e) => norm(e.building).includes(n))
  if (byName) return byName.bdId

  return null
}

// Score a room entry against the query string (0 = no match, >0 = match).
function scoreEntry(entry: RoomEntry, queryTerms: string[]): number {
  let score = 0
  const roomNorm = norm(entry.room)
  const useNorm = norm(entry.use ?? '')
  const tags = (entry.tags ?? []).map(norm)

  for (const term of queryTerms) {
    // Exact room number hit (e.g. "105" or "room 105")
    if (roomNorm === term || roomNorm === `room ${term}` || term === `room ${roomNorm}`) {
      score += 10
      continue
    }
    // Use name contains term
    if (useNorm.includes(term)) { score += 5; continue }
    // Tag exact match
    if (tags.includes(term)) { score += 4; continue }
    // Partial tag match
    if (tags.some((t) => t.includes(term) || term.includes(t))) { score += 2; continue }
    // Room number prefix (e.g. "rrsw" matches "RRSW302")
    if (roomNorm.startsWith(term)) { score += 3; continue }
  }

  return score
}

export async function findRoom(input: FindRoomInput) {
  let index: RoomEntry[]
  try {
    index = await getRoomsIndex()
  } catch (e: any) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return {
        found: false,
        reason: 'No room index on file. Run plan_pipeline.py --upload to build it.',
        coverage: { buildingsWithPlans: [], note: 'No floor plan data uploaded yet.' },
      }
    }
    throw e
  }

  // Buildings that have plans
  const buildingsWithPlans = [...new Set(index.map((e) => `${e.building} (${e.bdId})`))]

  // Resolve building filter
  let bdIdFilter: string | null = null
  if (input.building) {
    bdIdFilter = resolveBdId(input.building, index)
    if (!bdIdFilter) {
      return {
        found: false,
        reason: `No floor plan on file for "${input.building}".`,
        coverage: { buildingsWithPlans, note: 'Only buildings with uploaded CAD plans are searchable.' },
      }
    }
  }

  // Filter by building and floor
  let pool = index
  if (bdIdFilter) pool = pool.filter((e) => e.bdId === bdIdFilter)
  if (input.floor) pool = pool.filter((e) => e.floor === input.floor!.padStart(2, '0'))

  // Score and rank
  const queryTerms = norm(input.query)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !['in', 'at', 'on', 'the', 'a', 'an', 'of', 'is', 'are', 'where'].includes(t))

  const scored = pool
    .map((e) => ({ entry: e, score: scoreEntry(e, queryTerms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)

  if (scored.length === 0) {
    const scope = bdIdFilter
      ? `${pool[0]?.building ?? bdIdFilter}${input.floor ? ` floor ${input.floor}` : ''}`
      : `campus plans`
    return {
      found: false,
      reason: `No rooms matching "${input.query}" found in ${scope}.`,
      coverage: { buildingsWithPlans, note: 'Only buildings with uploaded CAD plans are searchable.' },
    }
  }

  const matches = scored.map((x) => ({
    bdId: x.entry.bdId,
    building: x.entry.building,
    floor: x.entry.floor,
    room: x.entry.room,
    use: x.entry.use,
    areaSf: x.entry.areaSf,
    centroid: x.entry.centroid,
  }))

  // For the best match, emit the building footprint + _planFocus so the frontend
  // can open the plan and pin the room without the tool shipping room polygons.
  const best = matches[0]
  let features: Record<string, unknown> = {
    type: 'FeatureCollection',
    features: [],
    _planFocus: { bdId: best.bdId, floor: best.floor, room: best.room },
  }

  try {
    const buildings = await queryS3Layer({ layerName: 'buildings', maxResults: 500, returnGeometry: true })
    if (!('error' in buildings)) {
      const footprint = buildings.features.find(
        (f) => (f.properties as Record<string, unknown>).BD_ID === best.bdId
      )
      if (footprint) {
        features = {
          type: 'FeatureCollection',
          features: [footprint],
          _planFocus: { bdId: best.bdId, floor: best.floor, room: best.room },
        }
      }
    }
  } catch {
    // Non-fatal: map won't show footprint but text answer still works
  }

  return {
    found: true,
    matches,
    coverage: {
      buildingsWithPlans,
      note: 'Only buildings with uploaded CAD plans are searchable.',
    },
    features,
  }
}
