/**
 * One functional test per agent tool, run against the REAL layer data
 * (the local GDB→GeoJSON conversion output that is uploaded to S3), so any
 * invented/mistyped field name fails here instead of shipping.
 *
 * S3 and Bedrock clients are mocked; no AWS access or network is needed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.hoisted(() => {
  process.env.GEOJSON_BUCKET = 'test-bucket'
  // Force getShuttleArrivals onto its keyless mock-data path
  delete process.env.TRANSLOC_API_KEY
})

// ── S3 mock: serves the real local conversion output for the layers that
// exist in the repo, and small inline fixtures for the rest ────────────────
vi.mock('@aws-sdk/client-s3', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const path = await import('node:path')
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

  const FILE_KEYS: Record<string, string> = {
    'layers/buildings.geojson': 'gis_output/geojson/Building_Information_2026.geojson',
    'layers/trees.geojson': 'gis_output/geojson/0708_tree.json',
    'layers/Cafe__Market__Restaurant_and_Dining_Hall.geojson':
      'gis_output/geojson/Cafe__Market__Restaurant_and_Dining_Hall.geojson',
  }

  const INLINE_KEYS: Record<string, unknown> = {
    // Tunnel segment passing right by Regenstein Library (41.7921, -87.5997)
    'layers/utility_new_walkable_tunnel.geojson': {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { Layer: 'TUNNEL-WALKABLE' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-87.5997, 41.7921],
              [-87.5992, 41.7924],
            ],
          },
        },
      ],
    },
    'documents/pd43_index.json': {
      version: 1,
      model: 'test',
      dimensions: 4,
      corpus: 'PD 43 test corpus',
      documents: ['Chicago Zoning Ordinance 17-8', 'PD 43 Statement'],
      chunks: [
        {
          id: 0,
          doc: 'Chicago Zoning Ordinance 17-8',
          page: 12,
          text: 'The maximum floor area ratio for subarea A shall not exceed 1.7 as established by the planned development.',
          embedding: [0, 0, 0, 0],
        },
        {
          id: 1,
          doc: 'PD 43 Statement',
          page: 3,
          text: 'Institutional planned development boundaries and permitted uses within the campus district.',
          embedding: [0, 0, 0, 0],
        },
      ],
    },
    'digest/state.json': {
      updatedAt: '2026-07-14T07:00:00Z',
      layers: { 'layers/buildings.geojson': { count: 308 } },
    },
    'digest/latest.json': { date: '2026-07-14', generatedAt: '2026-07-14T07:00:05Z', items: [] },
  }

  class GetObjectCommand {
    constructor(public input: { Bucket: string; Key: string }) {}
  }
  class S3Client {
    async send(cmd: GetObjectCommand) {
      const key = cmd.input.Key
      let body: string
      if (FILE_KEYS[key]) {
        body = readFileSync(path.join(repoRoot, FILE_KEYS[key]), 'utf8')
      } else if (key in INLINE_KEYS) {
        body = JSON.stringify(INLINE_KEYS[key])
      } else {
        throw new Error(`No test fixture for S3 key: ${key}`)
      }
      return { Body: { transformToString: async () => body } }
    }
  }
  return { S3Client, GetObjectCommand }
})

// ── Bedrock mock: embedding calls fail so searchDocuments exercises its
// lexical (BM25) fallback — zero model calls, still a real retrieval path ──
vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class BedrockRuntimeClient {
    async send() {
      throw new Error('Bedrock unavailable in tests')
    }
  }
  class InvokeModelCommand {
    constructor(public input: unknown) {}
  }
  class ConverseStreamCommand {
    constructor(public input: unknown) {}
  }
  return { BedrockRuntimeClient, InvokeModelCommand, ConverseStreamCommand }
})

import { getBuildingInfo, GetBuildingInfoInputSchema } from '../tools/campus/getBuildingInfo'
import { findCampusNearby, FindCampusNearbyInputSchema, resolveLocation } from '../tools/campus/findCampusNearby'
import { checkHours, CheckHoursInputSchema } from '../tools/campus/checkHours'
import { queryTrees, QueryTreesInputSchema } from '../tools/campus/queryTrees'
import { queryUtilities, QueryUtilitiesInputSchema } from '../tools/campus/queryUtilities'
import { queryBuildingAttributes, QueryBuildingAttributesInputSchema } from '../tools/campus/queryBuildingAttributes'
import { searchDocuments, SearchDocumentsInputSchema } from '../tools/campus/searchDocuments'
import { getDataFreshness } from '../tools/campus/getDataFreshness'
import { getShuttleArrivals, GetShuttleArrivalsInputSchema } from '../tools/campus/getShuttleArrivals'
import { getBikeStations, GetBikeStationsInputSchema } from '../tools/campus/getBikeStations'
import { findUnverifiedCitations } from '../agent'

describe('get_building_info', () => {
  it('finds a known building by name', async () => {
    const r = await getBuildingInfo(GetBuildingInfoInputSchema.parse({ buildingIdentifier: 'Regenstein' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.count).toBeGreaterThan(0)
    expect(String(r.buildings[0].name)).toMatch(/Regenstein/i)
    expect(r.buildings[0].address).toBeTruthy()
    expect(r.buildings[0].yearBuilt).toBe(1970)
    expect(r.buildings[0].sqft).toBeGreaterThan(0)
  })

  it('finds a building by building code (BD_ID)', async () => {
    const r = await getBuildingInfo(GetBuildingInfoInputSchema.parse({ buildingIdentifier: 'C03' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(String(r.buildings[0].name)).toMatch(/Regenstein/i)
  })

  it('only ships allow-listed properties on features', async () => {
    const r = await getBuildingInfo(GetBuildingInfoInputSchema.parse({ buildingIdentifier: 'Regenstein' }))
    if ('error' in r) throw new Error('unexpected error')
    const props = r.features.features[0].properties as Record<string, unknown>
    expect(props.DISCRIPT1).toBeTruthy()
    // internal facilities columns must never leave the backend
    expect(props).not.toHaveProperty('Unassigned_Space')
    expect(props).not.toHaveProperty('FCI_COST__Current_Deficiencies_')
  })
})

describe('find_campus_nearby', () => {
  it('finds buildings near a known location with sane distances', async () => {
    const r = await findCampusNearby(
      FindCampusNearbyInputSchema.parse({ referenceLocation: 'Regenstein Library', featureType: 'building' })
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.count).toBeGreaterThan(0)
    const d = (r.features.features[0].properties as { distanceMeters?: number }).distanceMeters
    expect(typeof d).toBe('number')
    expect(Number.isFinite(d)).toBe(true)
  })

  it('rejects prototype-key location names instead of resolving garbage', () => {
    expect(resolveLocation('__proto__')).toBeNull()
    expect(resolveLocation('constructor')).toBeNull()
    expect(resolveLocation(' ')).toBeNull()
  })
})

describe('check_hours', () => {
  it('finds hours for a known location', async () => {
    // 2026-07-15T15:00Z = 10:00 Wednesday in Chicago → Regenstein open
    const r = await checkHours(
      CheckHoursInputSchema.parse({ locationName: 'Regenstein Library', checkTime: '2026-07-15T15:00:00Z' })
    )
    expect(r.found).toBe(true)
    expect(r.isOpen).toBe(true)
  })

  it('does not invent hours for prototype-chain keys', async () => {
    const r = await checkHours(CheckHoursInputSchema.parse({ locationName: 'constructor' }))
    expect(r.found).toBe(false)
  })
})

describe('query_trees', () => {
  it('finds a known species in the inventory', async () => {
    const r = await queryTrees(QueryTreesInputSchema.parse({ species: 'Maple' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.summary.totalCount).toBeGreaterThan(0)
    expect(r.features.features[0].properties.CommonName).toMatch(/maple/i)
  })
})

describe('query_campus_utilities', () => {
  it('finds tunnel segments near a known building', async () => {
    const r = await queryUtilities(
      QueryUtilitiesInputSchema.parse({ utilityType: 'tunnel', nearLocation: 'Regenstein Library' })
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.count).toBeGreaterThan(0)
    expect(r.referenceLocation).toMatch(/Regenstein/i)
  })

  it('rejects prototype-key locations with a clean error', async () => {
    const r = await queryUtilities(
      QueryUtilitiesInputSchema.parse({ utilityType: 'tunnel', nearLocation: '__proto__' })
    )
    expect('error' in r).toBe(true)
  })

  it('rejects too-short locations without loading layers', async () => {
    const r = await queryUtilities(QueryUtilitiesInputSchema.parse({ utilityType: 'tunnel', nearLocation: ' ' }))
    expect('error' in r).toBe(true)
  })
})

describe('query_building_attributes', () => {
  it('filters buildings by RI against the real field (RI_23)', async () => {
    const r = await queryBuildingAttributes(
      QueryBuildingAttributesInputSchema.parse({ field: 'RI', operator: '>', value: 0.5 })
    )
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.field).toBe('RI_23')
    expect(r.totalMatched).toBeGreaterThan(0)
    expect(r.topMatches[0].name).toBeTruthy()
  })
})

describe('search_planning_documents', () => {
  it('retrieves a relevant passage (lexical fallback path)', async () => {
    const r = await searchDocuments(SearchDocumentsInputSchema.parse({ query: 'maximum floor area ratio' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.passages.length).toBeGreaterThan(0)
    expect(r.passages[0].document).toBe('Chicago Zoning Ordinance 17-8')
    expect(r.passages[0].page).toBe(12)
  })
})

describe('get_data_freshness', () => {
  it('reports digest state', async () => {
    const r = await getDataFreshness({})
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.lastDiffRunAt).toBeTruthy()
    expect(r.layersTracked).toBeGreaterThan(0)
  })
})

describe('get_shuttle_arrivals', () => {
  it('returns arrivals for a known stop (mock-data path without API key)', async () => {
    const r = await getShuttleArrivals(GetShuttleArrivalsInputSchema.parse({ stopName: 'Keller Center' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.arrivals.length).toBeGreaterThan(0)
  })
})

describe('get_bike_stations', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url)
        if (u.includes('station_information')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                stations: [
                  { station_id: 'st-1', name: 'University Ave & 57th St', lat: 41.7925, lon: -87.599, capacity: 15 },
                ],
              },
            }),
          }
        }
        if (u.includes('station_status')) {
          return {
            ok: true,
            json: async () => ({
              data: {
                stations: [
                  { station_id: 'st-1', num_bikes_available: 4, num_docks_available: 11, is_installed: 1, is_renting: 1 },
                ],
              },
            }),
          }
        }
        throw new Error(`unexpected fetch: ${u}`)
      })
    )
  })

  it('finds stations near a known location', async () => {
    const r = await getBikeStations(GetBikeStationsInputSchema.parse({ nearLocation: 'Regenstein Library' }))
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.stations.length).toBeGreaterThan(0)
    expect(r.stations[0].bikesAvailable).toBe(4)
  })
})

describe('citation validation (agent)', () => {
  it('flags citations when nothing was retrieved — the pure-fabrication case', () => {
    const text = 'The FAR limit is 1.7 (Chicago Zoning Ordinance 17-8, p.12).'
    expect(findUnverifiedCitations(text, [])).toHaveLength(1)
  })

  it('accepts citations matching retrieved passages, including page ranges', () => {
    const retrieved = [{ document: 'Chicago Zoning Ordinance 17-8', page: 12 }]
    expect(findUnverifiedCitations('See (Chicago Zoning Ordinance 17-8, p.12).', retrieved)).toHaveLength(0)
    expect(findUnverifiedCitations('See (Chicago Zoning Ordinance 17-8, pp. 12-14).', retrieved)).toHaveLength(0)
    expect(findUnverifiedCitations('See [Chicago Zoning Ordinance 17-8, p. 12].', retrieved)).toHaveLength(0)
  })

  it('flags a citation whose page was never retrieved', () => {
    const retrieved = [{ document: 'Chicago Zoning Ordinance 17-8', page: 12 }]
    expect(findUnverifiedCitations('See (Chicago Zoning Ordinance 17-8, p.99).', retrieved)).toHaveLength(1)
  })
})
