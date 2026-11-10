import { createHash } from 'node:crypto'
import { z } from 'zod'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'
import { getAttachment } from './attachmentStore'
import { getBucket } from './config'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const MAX_GEOCODE = 20

export const GetBuildingsByIdsInputSchema = z.object({
  ids: z.array(z.string()).max(5000).describe('BD_ID values to look up, e.g. ["A06", "C03"]'),
  fields: z.array(z.string()).optional().describe('Specific property fields to include'),
}).strict()

export type GetBuildingsByIdsInput = z.infer<typeof GetBuildingsByIdsInputSchema>

// ── Address normalisation ─────────────────────────────────────────────────────

function normalizeAddr(addr: string): string {
  return addr.toLowerCase()
    .replace(/\beast\b/g, 'e').replace(/\bwest\b/g, 'w')
    .replace(/\bnorth\b/g, 'n').replace(/\bsouth\b/g, 's')
    .replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave')
    .replace(/\bdrive\b/g, 'dr').replace(/\bplace\b/g, 'pl')
    .replace(/\broad\b/g, 'rd').replace(/\bboulevard\b/g, 'blvd')
    .replace(/\s+(apt|suite|unit|ste|#)\s*\S+/gi, '')
    .replace(/\s+/g, ' ').trim()
}

// "1160-74 e 55th st" → { lo: 1160, hi: 1174, street: "e 55th st" }
function parseRange(normalized: string): { lo: number; hi: number; street: string } | null {
  const m = normalized.match(/^(\d{3,5})-(\d{2,4})\s+(.+)$/)
  if (!m) return null
  const lo = parseInt(m[1], 10)
  const frag = m[2]
  const hi = parseInt(m[1].slice(0, m[1].length - frag.length) + frag, 10)
  if (Number.isNaN(lo) || Number.isNaN(hi) || hi < lo) return null
  return { lo, hi, street: m[3] }
}

function addressMatches(buildingAddr: string, recordAddr: string): boolean {
  if (!buildingAddr || !recordAddr) return false
  const bNorm = normalizeAddr(buildingAddr)
  const rNorm = normalizeAddr(recordAddr)
  if (bNorm === rNorm) return true

  // Range: record "1160-74 e 55th st" vs building "1170 e 55th st"
  const range = parseRange(rNorm)
  if (range) {
    const bm = bNorm.match(/^(\d+)\s+(.+)$/)
    if (bm && bm[2] === range.street) {
      const n = parseInt(bm[1], 10)
      if (n >= range.lo && n <= range.hi) return true
    }
  }
  return false
}

// ── S3-cached Census geocoder ─────────────────────────────────────────────────

async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const cacheKey = `cache/geocode/${createHash('md5').update(normalizeAddr(address)).digest('hex')}.json`
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: cacheKey }))
    return JSON.parse(await obj.Body!.transformToString()) as { lat: number; lon: number }
  } catch { /* cache miss */ }

  try {
    const url =
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' +
      `address=${encodeURIComponent(address + ', Chicago, IL')}` +
      '&benchmark=Public_AR_Current&format=json'
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!resp.ok) return null
    const data = await resp.json() as {
      result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> }
    }
    const coords = data?.result?.addressMatches?.[0]?.coordinates
    if (!coords) return null
    const result = { lat: coords.y, lon: coords.x }
    s3.send(new PutObjectCommand({
      Bucket: getBucket(), Key: cacheKey,
      Body: JSON.stringify(result), ContentType: 'application/json',
    })).catch(() => { /* non-fatal cache write */ })
    return result
  } catch {
    return null
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function getBuildingsByIds(input: GetBuildingsByIdsInput, sessionId?: string) {
  const { ids } = input
  if (ids.length === 0) {
    return {
      totalInFile: 0, footprintCount: 0, pointCount: 0, notFoundCount: 0,
      found: [], notFound: [],
      features: { type: 'FeatureCollection' as const, features: [] },
      _modelSummary: { summary: '0 properties in the file.' },
    }
  }

  // Attachment records for address / coordinate fallback
  const att = sessionId ? getAttachment(sessionId) : null
  const recordsById = new Map<string, Record<string, unknown>>()
  if (att?.kind === 'table') {
    for (const rec of att.records) {
      const id = String(rec.id ?? '').trim().toUpperCase()
      if (id) recordsById.set(id, rec)
    }
  }

  const idsUpper = ids.map((id) => id.trim().toUpperCase())
  const idSet = new Set(idsUpper)
  const result = await queryS3Layer({ layerName: 'buildings', maxResults: 1000, returnGeometry: true })
  if ('error' in result) return result

  type FoundEntry = { feature: (typeof result.features)[0]; matchedBy: 'id' | 'address' }
  const matched = new Set<string>()
  const foundFeatures: FoundEntry[] = []

  // Step 1: ID match
  for (const f of result.features) {
    const bdId = String((f.properties as Record<string, unknown>)?.BD_ID ?? '').trim().toUpperCase()
    if (idSet.has(bdId)) {
      matched.add(bdId)
      foundFeatures.push({ feature: f, matchedBy: 'id' })
    }
  }

  // Step 2: Address match for unmatched IDs
  const unmatched = idsUpper.filter((id) => !matched.has(id))
  if (unmatched.length > 0 && recordsById.size > 0) {
    for (const f of result.features) {
      const bAddr = String((f.properties as Record<string, unknown>)?.ADDRESS ?? '')
      if (!bAddr) continue
      for (const id of unmatched) {
        if (matched.has(id)) continue
        const rAddr = String(recordsById.get(id)?.address ?? '')
        if (rAddr && addressMatches(bAddr, rAddr)) {
          matched.add(id)
          foundFeatures.push({ feature: f, matchedBy: 'address' })
          break
        }
      }
    }
  }

  // Step 3: Geocode remaining (capped, only if attachment provides an address)
  const toGeocode = idsUpper
    .filter((id) => !matched.has(id) && recordsById.get(id)?.address)
    .slice(0, MAX_GEOCODE)

  const geocoded: Array<{ id: string; lat: number; lon: number }> = []
  if (toGeocode.length > 0) {
    const results = await Promise.all(
      toGeocode.map(async (id) => {
        const addr = String(recordsById.get(id)!.address)
        const coords = await geocode(addr)
        return coords ? { id, ...coords } : null
      })
    )
    for (const r of results) {
      if (r) { matched.add(r.id); geocoded.push(r) }
    }
  }

  const notFound = idsUpper
    .filter((id) => !matched.has(id))
    .map((id) => ({
      id,
      reason: recordsById.get(id)?.address ? 'address not geocoded' : 'no footprint, no address',
    }))

  const features = [
    ...foundFeatures.map(({ feature: f, matchedBy }) => ({
      ...f,
      properties: { ...pickBuildingProps(f.properties as Record<string, unknown>), _matchedBy: matchedBy },
    })),
    ...geocoded.map(({ id, lat, lon }) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [lon, lat] },
      properties: { BD_ID: id, _matchedBy: 'geocode' as const },
    })),
  ]

  const totalInFile = ids.length
  const footprintCount = foundFeatures.length
  const pointCount = geocoded.length
  const notFoundCount = notFound.length

  return {
    totalInFile,
    footprintCount,
    pointCount,
    notFoundCount,
    found: [...matched],
    notFound,
    features: { type: 'FeatureCollection' as const, features },
    _modelSummary: {
      totalInFile,
      footprintCount,
      pointCount,
      notFoundCount,
      summary: `${totalInFile} properties in the file: ${footprintCount} drawn as footprints, ${pointCount} as points, ${notFoundCount} have no location.`,
    },
  }
}
