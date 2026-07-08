import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'

/**
 * Daily Digest pipeline (MVP of the Phase-4 data-update pipeline).
 *
 * Runs on an EventBridge schedule (routed here by handler.ts when
 * event.source === 'aws.events'). For every watched layer on S3 it compares
 * an ETag/feature-id fingerprint against the previous snapshot, identifies
 * added/removed features, and publishes digest/latest.json in the shape the
 * print-flow Daily Digest panel consumes:
 *
 *   { date, generatedAt, baseline, items: [{ icon, headline, detail, sub }] }
 *
 * First run only establishes the baseline (baseline: true, no items).
 */

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'
const STATE_KEY = 'digest/state.json'
const LATEST_KEY = 'digest/latest.json'

const s3 = new S3Client({ region: AWS_REGION })

interface WatchedLayer {
  label: string
  icon: 'leaf' | 'pen' | 'building' | 'diff'
  /** properties used to describe added features, first present wins */
  nameFields: string[]
}

const WATCHED: Record<string, WatchedLayer> = {
  'layers/trees.geojson': { label: 'Campus Trees', icon: 'leaf', nameFields: ['CommonName', 'Common_Nam', 'ScientName', 'TreeNotes'] },
  'layers/buildings.geojson': { label: 'Campus Buildings', icon: 'building', nameFields: ['DISCRIPT1'] },
  'layers/Cafe__Market__Restaurant_and_Dining_Hall.geojson': { label: 'Dining', icon: 'building', nameFields: ['Name', 'NAME'] },
  'layers/all-gender-restrooms.geojson': { label: 'All-Gender Restrooms', icon: 'building', nameFields: ['Building', 'Name'] },
  'layers/leed-buildings.geojson': { label: 'LEED Buildings', icon: 'building', nameFields: ['Name', 'DISCRIPT1'] },
}
// The 22 utility layers share one config each
for (const name of [
  'bioswale_area', 'chilled_water_receive', 'chilled_water_supply', 'city_owned_combined_sewer',
  'comed_vault_feeder', 'domestic_water', 'electrical_line', 'low_pressure_piping',
  'medium_pressure_piping', 'nesb_chilled_water_return', 'nesb_chilled_water_supply',
  'new_walkable_tunnel', 'site_construction_with_stormwater_retention', 'steam_vault',
  't2021_steam_line', 't2021_steam_line_condensate', 't50_compressed_air', 't80_compressed_air',
  'uchicago_conduit_infrastructure', 'underground_stormwater_detention', 'university_owned_sewer',
  'valves',
]) {
  WATCHED[`layers/utility_${name}.geojson`] = {
    label: `Utilities · ${name.replace(/_/g, ' ')}`,
    icon: 'diff',
    nameFields: ['Layer'],
  }
}

interface LayerFingerprint {
  etag: string
  count: number
  ids: Array<string | number>
}

interface DigestState {
  updatedAt: string
  layers: Record<string, LayerFingerprint>
}

interface DigestItem {
  icon: string
  headline: string
  detail: string
  sub: string
}

interface RawFeature {
  id?: string | number
  properties?: Record<string, unknown>
}

function featureId(f: RawFeature, index: number): string | number {
  return (
    f.id ??
    (f.properties?.OBJECTID as string | number | undefined) ??
    (f.properties?.TreeID as string | number | undefined) ??
    (f.properties?.Handle as string | number | undefined) ??
    `idx-${index}`
  )
}

function describeAdded(features: RawFeature[], cfg: WatchedLayer): string {
  const names = new Map<string, number>()
  for (const f of features.slice(0, 50)) {
    for (const field of cfg.nameFields) {
      const v = f.properties?.[field]
      if (typeof v === 'string' && v.trim()) {
        names.set(v.trim(), (names.get(v.trim()) ?? 0) + 1)
        break
      }
    }
  }
  if (!names.size) return `${features.length} new feature${features.length !== 1 ? 's' : ''}`
  return Array.from(names.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, n]) => (n > 1 ? `${n} ${name}` : name))
    .join(' · ')
}

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!r.Body) return null
    return JSON.parse(await r.Body.transformToString()) as T
  } catch {
    return null
  }
}

export async function runDailyDigest() {
  const prevState = await readJson<DigestState>(STATE_KEY)
  const isBaseline = !prevState
  const newState: DigestState = { updatedAt: new Date().toISOString(), layers: {} }
  const items: DigestItem[] = []
  const errors: string[] = []

  for (const [key, cfg] of Object.entries(WATCHED)) {
    let etag: string
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
      etag = head.ETag ?? ''
    } catch {
      continue // layer not present — skip silently
    }

    const prev = prevState?.layers[key]
    if (prev && prev.etag === etag) {
      newState.layers[key] = prev // unchanged — skip the download entirely
      continue
    }

    const gj = await readJson<{ features: RawFeature[] }>(key)
    if (!gj?.features) {
      errors.push(`unreadable: ${key}`)
      if (prev) newState.layers[key] = prev
      continue
    }

    const ids = gj.features.map((f, i) => featureId(f, i))
    newState.layers[key] = { etag, count: gj.features.length, ids }
    if (!prev) continue // newly watched layer — baseline it without an item

    const prevIds = new Set(prev.ids)
    const added = gj.features.filter((f, i) => !prevIds.has(featureId(f, i)))
    const removed = prev.count - (gj.features.length - added.length)

    if (!added.length && removed <= 0) continue // etag changed but content-equivalent

    const parts: string[] = []
    if (added.length) parts.push(`${added.length} added`)
    if (removed > 0) parts.push(`${removed} removed`)
    items.push({
      icon: cfg.icon,
      headline: `${cfg.label}: ${parts.join(', ')}`,
      detail: added.length ? describeAdded(added, cfg) : `${removed} feature${removed !== 1 ? 's' : ''} no longer present`,
      sub: `${cfg.label} · ${key.replace('layers/', '')}`,
    })
  }

  const now = new Date()
  const latest = {
    date: now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }),
    generatedAt: now.toISOString(),
    baseline: isBaseline,
    items,
    ...(errors.length ? { errors } : {}),
  }

  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: STATE_KEY,
    Body: JSON.stringify(newState), ContentType: 'application/json',
  }))
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: LATEST_KEY,
    Body: JSON.stringify(latest), ContentType: 'application/json',
    CacheControl: 'no-cache',
  }))

  return { ok: true, baseline: isBaseline, layersTracked: Object.keys(newState.layers).length, items }
}
