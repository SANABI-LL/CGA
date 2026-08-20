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

import { getBucket } from './tools/campus/config'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const STATE_KEY = 'digest/state.json'
const LATEST_KEY = 'digest/latest.json'
const HISTORY_KEY = 'digest/history.json'
const HISTORY_MAX = 30

const s3 = new S3Client({ region: AWS_REGION })

interface WatchedLayer {
  label: string
  icon: 'leaf' | 'pen' | 'building' | 'diff'
  /** properties used to describe added features, first present wins */
  nameFields: string[]
}

const WATCHED: Record<string, WatchedLayer> = {
  // Core layers
  'layers/trees.geojson': { label: 'Campus Trees', icon: 'leaf', nameFields: ['CommonName', 'Common_Nam', 'ScientName', 'TreeNotes'] },
  'layers/buildings.geojson': { label: 'Campus Buildings', icon: 'building', nameFields: ['DISCRIPT1'] },
  'layers/Cafe__Market__Restaurant_and_Dining_Hall.geojson': { label: 'Dining', icon: 'building', nameFields: ['Name', 'NAME'] },
  'layers/all-gender-restrooms.geojson': { label: 'All-Gender Restrooms', icon: 'building', nameFields: ['Building', 'Name'] },
  'layers/leed-buildings.geojson': { label: 'LEED Buildings', icon: 'building', nameFields: ['Name', 'DISCRIPT1'] },
  // Campus amenities & furniture
  'layers/bike_racks.geojson': { label: 'Bike Racks', icon: 'diff', nameFields: ['Type', 'FID'] },
  'layers/emergency_phone.geojson': { label: 'Emergency Phones', icon: 'diff', nameFields: ['Location', 'Number'] },
  'layers/trash_can.geojson': { label: 'Trash Cans', icon: 'diff', nameFields: ['Type', 'FID'] },
  'layers/benches.geojson': { label: 'Benches', icon: 'diff', nameFields: ['Type', 'Feature_ID', 'FID'] },
  'layers/seating.geojson': { label: 'Outdoor Seating Areas', icon: 'diff', nameFields: ['FID'] },
  'layers/public_arts.geojson': { label: 'Public Art', icon: 'pen', nameFields: ['Title', 'Author'] },
  'layers/green_roof.geojson': { label: 'Green Roofs', icon: 'leaf', nameFields: ['Type', 'FID'] },
  // Accessibility
  'layers/ada_route.geojson': { label: 'ADA Routes', icon: 'diff', nameFields: ['Name'] },
  'layers/accessible_public_entrance.geojson': { label: 'Accessible Public Entrances', icon: 'building', nameFields: ['Orientation', 'OBJECTID'] },
  'layers/accessible_controlled_access_entrance.geojson': { label: 'Accessible Controlled Entrances', icon: 'building', nameFields: ['Orientation', 'OBJECTID'] },
  'layers/accessibility_information.geojson': { label: 'Building Accessibility Info', icon: 'building', nameFields: ['Building', 'Address'] },
  'layers/inaccessible_main_entrance.geojson': { label: 'Inaccessible Main Entrances', icon: 'diff', nameFields: ['OBJECTID'] },
  'layers/inaccessible_building.geojson': { label: 'Inaccessible Buildings', icon: 'building', nameFields: ['Building', 'Alias', 'OBJECTID'] },
  // Fire & safety
  'layers/hydrant.geojson': { label: 'Fire Hydrants', icon: 'diff', nameFields: ['ASSET_ID', 'TYPE', 'FID'] },
  'layers/fire_escape.geojson': { label: 'Fire Escapes', icon: 'diff', nameFields: ['FID'] },
  'layers/sprinkler.geojson': { label: 'Fire Sprinklers', icon: 'diff', nameFields: ['FID'] },
  'layers/standpipe.geojson': { label: 'Standpipes', icon: 'diff', nameFields: ['FID'] },
  'layers/fire_lane.geojson': { label: 'Fire Lanes', icon: 'diff', nameFields: ['FID'] },
  'layers/post_indicator_valve.geojson': { label: 'Post Indicator Valves', icon: 'diff', nameFields: ['FID'] },
  // Landmarks & heritage
  'layers/individual_landmark.geojson': { label: 'City Landmarks', icon: 'pen', nameFields: ['LANDMARK_N', 'ADDRESS'] },
  'layers/nrhp.geojson': { label: 'NRHP Historic Places', icon: 'pen', nameFields: ['Name'] },
  'layers/nhl.geojson': { label: 'National Historic Landmarks', icon: 'pen', nameFields: ['LANDMARK_N', 'ADDRESS'] },
  // Parking & transit
  'layers/surface_parking.geojson': { label: 'Surface Parking Lots', icon: 'diff', nameFields: ['SFPARK_ID', 'FID'] },
  'layers/metrastations.geojson': { label: 'Metra Train Stations', icon: 'building', nameFields: ['NAME', 'LINES', 'ADDRESS'] },
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

// One line per nightly run, newest first — feeds the frontend "Recent syncs" list.
interface HistoryEntry {
  generatedAt: string
  status: 'applied' | 'skipped' | 'held'
  summary: string
  itemCount: number
  baseline?: boolean
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
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }))
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
      const head = await s3.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
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
    Bucket: getBucket(), Key: STATE_KEY,
    Body: JSON.stringify(newState), ContentType: 'application/json',
  }))
  await s3.send(new PutObjectCommand({
    Bucket: getBucket(), Key: LATEST_KEY,
    Body: JSON.stringify(latest), ContentType: 'application/json',
    CacheControl: 'no-cache',
  }))

  // Append this run to the rolling history (newest first, capped) — a failed
  // history write must not fail the digest itself.
  try {
    const entry: HistoryEntry = {
      generatedAt: latest.generatedAt,
      itemCount: items.length,
      ...(isBaseline ? { baseline: true } : {}),
      status: errors.length ? 'held' : items.length ? 'applied' : 'skipped',
      summary: isBaseline
        ? 'Baseline established for watched layers'
        : items.length
        ? items.slice(0, 3).map((i) => i.headline).join(' · ')
        : 'No changes detected since the previous run',
    }
    const history = (await readJson<HistoryEntry[]>(HISTORY_KEY)) ?? []
    history.unshift(entry)
    await s3.send(new PutObjectCommand({
      Bucket: getBucket(), Key: HISTORY_KEY,
      Body: JSON.stringify(history.slice(0, HISTORY_MAX)), ContentType: 'application/json',
      CacheControl: 'no-cache',
    }))
  } catch (err) {
    console.error('digest history write failed:', err)
  }

  return { ok: true, baseline: isBaseline, layersTracked: Object.keys(newState.layers).length, items }
}

/**
 * Read-only digest report for the frontend provenance panel ("source of
 * truth" / recent syncs / daily digest). No LLM involved — plain S3 reads,
 * safe fields only (no S3 keys, no per-feature ids).
 */
export async function readDigestReport() {
  const [state, latest, history] = await Promise.all([
    readJson<DigestState>(STATE_KEY),
    readJson<{ date?: string; generatedAt?: string; baseline?: boolean; items?: DigestItem[] }>(LATEST_KEY),
    readJson<HistoryEntry[]>(HISTORY_KEY),
  ])

  const layers = state?.layers ?? {}
  return {
    lastRunAt: state?.updatedAt ?? latest?.generatedAt ?? null,
    date: latest?.date ?? null,
    baseline: latest?.baseline ?? null,
    items: latest?.items ?? [],
    layersTracked: Object.keys(layers).length,
    layerCounts: Object.fromEntries(
      Object.entries(layers)
        .slice(0, 30)
        .map(([k, v]) => [k.replace('layers/', '').replace('.geojson', ''), v.count])
    ),
    history: history ?? [],
    schedule: 'Nightly at 02:00 America/Chicago (EventBridge)',
  }
}
