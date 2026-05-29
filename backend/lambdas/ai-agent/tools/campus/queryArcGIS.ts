import { z } from 'zod'

const ARCGIS_BASE = 'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services'

const LAYER_ENDPOINTS: Record<string, string> = {
  bike_racks:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/395`,
  buildings:   `${ARCGIS_BASE}/UoC_Properties/FeatureServer/2509`,
  electrical:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/0`,
  parking:     `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/10`,
  accessible:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/20`,
  dining:      `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/30`,
}

export const QueryArcGISInputSchema = z.object({
  layerName: z.enum(['bike_racks', 'buildings', 'electrical', 'parking', 'accessible', 'dining']),
  whereClause: z.string().optional().default('1=1'),
  spatialFilter: z.string().optional(),
  maxResults: z.number().optional().default(20),
  returnGeometry: z.boolean().optional().default(true),
  outFields: z.string().optional().default('*'),
})

export type QueryArcGISInput = z.infer<typeof QueryArcGISInputSchema>

export async function queryArcGIS(input: QueryArcGISInput) {
  const endpoint = LAYER_ENDPOINTS[input.layerName]
  if (!endpoint) {
    return { error: `Unknown layer: ${input.layerName}` }
  }

  const params = new URLSearchParams({
    where: input.whereClause ?? '1=1',
    outFields: input.outFields ?? '*',
    f: 'geojson',
    outSR: '4326',
    returnGeometry: String(input.returnGeometry ?? true),
    resultRecordCount: String(Math.min(input.maxResults ?? 20, 100)),
  })

  if (input.spatialFilter) {
    params.set('geometryType', 'esriGeometryEnvelope')
    params.set('spatialRel', 'esriSpatialRelIntersects')
  }

  try {
    const response = await fetch(`${endpoint}/query?${params}`, {
      headers: { 'User-Agent': 'CampusGeo/1.0' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return { error: `ArcGIS error: ${response.status}` }
    }

    const geojson = await response.json() as {
      type: string
      features: Array<{ type: string; id?: unknown; geometry: unknown; properties: Record<string, unknown> }>
    }

    return {
      type: 'FeatureCollection' as const,
      features: geojson.features ?? [],
      count: geojson.features?.length ?? 0,
      layer: input.layerName,
    }
  } catch (err) {
    return { error: `Failed to query ArcGIS: ${err instanceof Error ? err.message : String(err)}` }
  }
}
