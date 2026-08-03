import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

import { getBucket } from './config'
import { BUILDING_FIELD_ALLOWLIST } from './buildingFields'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUILDINGS_KEY = process.env.BUILDINGS_KEY || 'layers/buildings.geojson'

const s3 = new S3Client({ region: AWS_REGION })

/**
 * Attribute/metric filter over the campus buildings layer — answers questions
 * like "buildings with RI above 0.52", "buildings taller than 100 ft",
 * "buildings opened before 1900". This is the tool for building METRICS;
 * the PD 43 document search is for zoning/regulatory text, not layer data.
 */

// Friendly aliases → actual field names in buildings.geojson (every candidate
// verified to exist in the layer). RI = Resilience Index, FCI = Facility
// Condition Index. A Map so lookups can never hit prototype-chain keys.
const FIELD_ALIASES = new Map<string, string[]>([
  ['ri', ['RI', 'RI_23']],
  ['fci', ['FCI', 'FCI_23']],
  ['height', ['BLDG_HGT']],
  ['year', ['Year_Completed', 'Year_Opened']],
  ['area', ['Area_AC']],
  ['sqft', ['Gross_Area_SF']],
  ['name', ['DISCRIPT1']],
  ['use', ['DISCRIPT2']],
  ['ownership', ['PROPERTY_S']],
  ['architect', ['Architects']],
  ['architects', ['Architects']],
  ['cost', ['FCI_Cost']],
  ['replacement', ['Replacement']],
  ['ricost', ['RI_Cost_Total']],
])

export const QueryBuildingAttributesInputSchema = z.object({
  field: z
    .string()
    .max(100)
    .describe('Attribute to filter on: "RI" (resilience index), "FCI", "height", "year", "area", "use", "ownership", "architect" (building architect/firm name), or an exact field name'),
  operator: z.enum(['>', '>=', '<', '<=', '=', 'contains']),
  value: z.union([z.number(), z.string().max(200)]),
  maxResults: z.number().int().min(1).max(400).optional().default(300),
}).strict()

export type QueryBuildingAttributesInput = z.infer<typeof QueryBuildingAttributesInputSchema>

interface BuildingFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown } | null
}

let buildingsPromise: Promise<BuildingFeature[]> | null = null

function loadBuildings(): Promise<BuildingFeature[]> {
  if (!buildingsPromise) {
    buildingsPromise = (async () => {
      const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: BUILDINGS_KEY }))
      if (!r.Body) throw new Error('Empty S3 response for buildings layer')
      const parsed = JSON.parse(await r.Body.transformToString()) as { features: BuildingFeature[] }
      return parsed.features ?? []
    })().catch((err) => {
      buildingsPromise = null
      throw err
    })
  }
  return buildingsPromise
}

function resolveField(requested: string, sample: Record<string, unknown>): string | null {
  // Only allow-listed fields are queryable — internal facilities columns are
  // not reachable even by exact name, and `Object.hasOwn` avoids matching
  // prototype-chain properties like "constructor".
  const isAllowed = (f: string) => BUILDING_FIELD_ALLOWLIST.has(f) && Object.hasOwn(sample, f)
  if (isAllowed(requested)) return requested
  const candidates = FIELD_ALIASES.get(requested.toLowerCase().replace(/[^a-z]/g, '')) ?? []
  for (const c of candidates) if (isAllowed(c)) return c
  // last resort: case-insensitive match within the allow-list
  const lower = requested.toLowerCase()
  return [...BUILDING_FIELD_ALLOWLIST].find((k) => k.toLowerCase() === lower && Object.hasOwn(sample, k)) ?? null
}

function centroidOf(features: BuildingFeature[]): { lat: number; lng: number } | undefined {
  let sumLat = 0
  let sumLng = 0
  let n = 0
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    // A coordinate point has numeric first element; only use [0]=lng [1]=lat
    // (ignore any Z at [2] — buildings.geojson carries a tiny elevation value
    // that would corrupt the centroid average if treated as lat/lng)
    if (typeof c[0] === 'number' && typeof c[1] === 'number') {
      sumLng += c[0] as number
      sumLat += c[1] as number
      n++
      return
    }
    for (const child of c) walk(child)
  }
  for (const f of features.slice(0, 50)) if (f.geometry) walk(f.geometry.coordinates)
  return n ? { lat: sumLat / n, lng: sumLng / n } : undefined
}

export async function queryBuildingAttributes(input: QueryBuildingAttributesInput) {
  try {
    const buildings = await loadBuildings()
    if (!buildings.length) return { error: 'Buildings layer is empty' }

    const field = resolveField(input.field, buildings[0].properties)
    if (!field) {
      // Deliberately generic: do not enumerate layer columns to the caller.
      return {
        error: 'Field not available. Queryable attributes: RI, FCI, height, year, area, use, ownership, name.',
      }
    }

    const numericValue = typeof input.value === 'number' ? input.value : parseFloat(input.value)
    const matches = buildings.filter((f) => {
      const raw = f.properties[field]
      if (raw === null || raw === undefined) return false
      if (input.operator === 'contains') {
        return String(raw).toLowerCase().includes(String(input.value).toLowerCase())
      }
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw))
      if (Number.isNaN(num) || Number.isNaN(numericValue)) {
        return input.operator === '=' && String(raw) === String(input.value)
      }
      switch (input.operator) {
        case '>': return num > numericValue
        case '>=': return num >= numericValue
        case '<': return num < numericValue
        case '<=': return num <= numericValue
        case '=': return num === numericValue
      }
    })

    // Sort by the filtered field (desc for >/>=, asc otherwise) so "top" answers read naturally
    const dir = input.operator === '<' || input.operator === '<=' ? 1 : -1
    matches.sort((a, b) => {
      const av = parseFloat(String(a.properties[field]))
      const bv = parseFloat(String(b.properties[field]))
      return (Number.isNaN(av) ? 0 : av) > (Number.isNaN(bv) ? 0 : bv) ? dir : -dir
    })

    const kept = matches.slice(0, input.maxResults)
    const outFeatures = kept.map((f) => ({
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: {
        BD_ID: f.properties.BD_ID,
        name: f.properties.DISCRIPT1,
        use: f.properties.DISCRIPT2,
        address: f.properties.ADDRESS,
        [field]: f.properties[field],
      },
    }))

    const summary = {
      field,
      operator: input.operator,
      value: input.value,
      totalMatched: matches.length,
      returned: kept.length,
      topMatches: kept.slice(0, 12).map((f) => ({
        name: f.properties.DISCRIPT1,
        [field]: f.properties[field],
      })),
    }

    return {
      ...summary,
      count: kept.length,
      center: centroidOf(kept),
      features: { type: 'FeatureCollection' as const, features: outFeatures },
      _modelSummary: {
        ...summary,
        featuresShownOnMap: kept.length,
        note: 'Matching buildings are rendered on the map; geometry omitted here.',
      },
    }
  } catch (err) {
    console.error('queryBuildingAttributes error:', err)
    return { error: 'Building attribute query failed' }
  }
}
