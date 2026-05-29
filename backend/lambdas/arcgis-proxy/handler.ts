import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'

const ARCGIS_BASE = 'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services'

const LAYER_ENDPOINTS: Record<string, string> = {
  bike_racks:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/395`,
  buildings:   `${ARCGIS_BASE}/UoC_Properties/FeatureServer/2509`,
  electrical:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/0`,
  parking:     `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/10`,
  accessible:  `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/20`,
  dining:      `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/30`,
}

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' }
  }

  const layer = event.pathParameters?.layer
  if (!layer || !LAYER_ENDPOINTS[layer]) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Unknown layer: ${layer}` }),
    }
  }

  const params = new URLSearchParams({
    where: event.queryStringParameters?.where ?? '1=1',
    outFields: event.queryStringParameters?.fields ?? '*',
    f: 'geojson',
    outSR: '4326',
    returnGeometry: 'true',
    resultRecordCount: String(Math.min(parseInt(event.queryStringParameters?.limit ?? '100'), 500)),
  })

  try {
    const response = await fetch(`${LAYER_ENDPOINTS[layer]}/query?${params}`, {
      headers: { 'User-Agent': 'CampusGeo/1.0' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      return {
        statusCode: 502,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `ArcGIS error: ${response.status}` }),
      }
    }

    const data = await response.text()
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300', // 5-minute browser cache
      },
      body: data,
    }
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) }),
    }
  }
}
