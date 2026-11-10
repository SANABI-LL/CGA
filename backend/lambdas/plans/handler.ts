import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { gzipSync } from 'zlib'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const BUCKET = process.env.GEOJSON_BUCKET ?? 'campusgeo-geodata-491117467175'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

// BD_ID: 1–6 uppercase alphanumeric  e.g. "A06", "E30"
const BD_ID_RE = /^[A-Z0-9]{1,6}$/
// file: transform.json | {floor}[.rooms|.gross].geojson  (floor = 1–3 chars like "01", "B1")
const FILE_RE = /^(transform\.json|[A-Za-z0-9]{1,3}(\.rooms|\.gross)?\.geojson)$/

function cors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}

function jsonErr(status: number, msg: string): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { ...cors(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: msg }),
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: cors(), body: '' }
  }

  // Resolve S3 key from path
  let s3Key: string
  const rawPath = event.rawPath ?? ''

  if (rawPath.endsWith('/api/plans/index') || rawPath.endsWith('/api/plans/index.json')) {
    // GET /api/plans/index  →  plans/index.json
    s3Key = 'plans/index.json'
  } else {
    const { bdId, file } = event.pathParameters ?? {}
    if (!bdId || !file) return jsonErr(400, 'Missing bdId or file')

    const bdUpper = bdId.toUpperCase()
    if (!BD_ID_RE.test(bdUpper)) return jsonErr(400, 'Invalid bdId')
    if (!FILE_RE.test(file)) return jsonErr(400, 'Invalid file')

    s3Key = `plans/${bdUpper}/${file}`
  }

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }))
    const bytes = await obj.Body!.transformToByteArray()

    const contentType = s3Key.endsWith('.geojson') ? 'application/geo+json' : 'application/json'
    const acceptEnc = (event.headers?.['accept-encoding'] ?? '').toLowerCase()

    // Gzip the response when the client supports it.
    // Linework GeoJSON can be ~12 MB raw (above the 10 MB API GW limit), so gzip is required
    // for that file. All modern browsers send Accept-Encoding: gzip.
    if (acceptEnc.includes('gzip')) {
      const compressed = gzipSync(bytes)
      return {
        statusCode: 200,
        headers: {
          ...cors(),
          'Content-Type': contentType,
          'Content-Encoding': 'gzip',
          'Cache-Control': 'public, max-age=3600',
          ...(obj.ETag ? { ETag: obj.ETag } : {}),
        },
        body: Buffer.from(compressed).toString('base64'),
        isBase64Encoded: true,
      }
    }

    // Warn if the uncompressed response would exceed the API GW 10 MB hard limit
    if (bytes.length > 9_000_000) {
      console.warn(`plans-proxy: ${s3Key} is ${bytes.length} B — client should send Accept-Encoding: gzip`)
    }

    return {
      statusCode: 200,
      headers: {
        ...cors(),
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
        ...(obj.ETag ? { ETag: obj.ETag } : {}),
      },
      body: Buffer.from(bytes).toString('utf-8'),
    }
  } catch (e: any) {
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) {
      return jsonErr(404, `Not found: ${s3Key}`)
    }
    console.error('plans-proxy error', s3Key, e)
    return jsonErr(500, 'Internal error')
  }
}
