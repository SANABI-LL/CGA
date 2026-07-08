import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'
const BUILDINGS_KEY = process.env.BUILDINGS_KEY || 'layers/buildings.geojson'

const s3 = new S3Client({ region: AWS_REGION })

/**
 * Attribute/metric filter over the campus buildings layer — answers questions
 * like "buildings with RI above 0.52", "buildings taller than 100 ft",
 * "buildings opened before 1900". This is the tool for building METRICS;
 * the PD 43 document search is for zoning/regulatory text, not layer data.
 */

// Friendly aliases → actual field names in buildings.geojson.
// RI = Resilience Index, FCI = Facility Condition Index.
const FIELD_ALIASES: Record<string, string[]> = {
  ri: ['RI_23', 'RI_', 'RI'],
  fci: ['FCI__', 'FCI'],
  height: ['BLDG_HGT'],
  year: ['Year_Opened', 'YearOpened', 'Year_Completed'],
  area: ['Area_AC'],
  name: ['DISCRIPT1'],
  use: ['DISCRIPT2'],
  ownership: ['PROPERTY_S'],
}

export const QueryBuildingAttributesInputSchema = z.object({
  field: z
    .string()
    .describe('Attribute to filter on: "RI" (resilience index), "FCI", "height", "year", "area", "use", "ownership", or an exact field name'),
  operator: z.enum(['>', '>=', '<', '<=', '=', 'contains']),
  value: z.union([z.number(), z.string()]),
  maxResults: z.number().max(400).optional().default(300),
})

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
      const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: BUILDINGS_KEY }))
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
  if (requested in sample) return requested
  const candidates = FIELD_ALIASES[requested.toLowerCase().replace(/[^a-z]/g, '')] ?? []
  for (const c of candidates) if (c in sample) return c
  // last resort: case-insensitive match
  const lower = requested.toLowerCase()
  return Object.keys(sample).find((k) => k.toLowerCase() === lower) ?? null
}

function centroidOf(features: BuildingFeature[]): { lat: number; lng: number } | undefined {
  let sumLat = 0
  let sumLng = 0
  let n = 0
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
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
      return {
        error: `Field "${input.field}" not found. Available fields include: ${Object.keys(buildings[0].properties).join(', ')}`,
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
    return { error: `Building attribute query failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
