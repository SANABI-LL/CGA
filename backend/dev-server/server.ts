/**
 * Local development server for the CampusGeo agent.
 *
 * Wraps `runCampusGeoAgent` in a plain Node HTTP server so the frontend can run
 * the full query → tool → map loop locally, without deploying the Lambda
 * Function URL. It reproduces the SSE contract of the production handler
 * (`backend/lambdas/ai-agent/handler.ts`): POST /api/agent, body { query },
 * response `text/event-stream` emitting `data: {json}\n\n` lines.
 *
 * Run:  pnpm --filter @campusgeo/dev-server dev
 * Then point the frontend at it via apps/web/.env.local:
 *   VITE_API_URL=http://localhost:3001
 *
 * Requires AWS credentials in the environment (same as the Lambda) so the
 * Bedrock client can authenticate — e.g. AWS_PROFILE or AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY, plus AWS_REGION and optionally BEDROCK_MODEL_ID.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { runCampusGeoAgent } from '../lambdas/ai-agent/agent'

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' })
const GEOJSON_BUCKET = process.env.GEOJSON_BUCKET ?? 'campusgeo-geodata-491117467175'

const BD_ID_RE = /^[A-Z0-9]{1,6}$/
const FILE_RE = /^(transform\.json|[A-Za-z0-9]{1,3}(\.rooms|\.gross)?\.geojson)$/

async function handlePlans(url: string, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // Returns true if the request was handled (404 or success), false if not a plans route
  const headers = { ...corsPlanHeaders() }

  let s3Key: string
  if (url === '/api/plans/index' || url === '/api/plans/index.json') {
    s3Key = 'plans/index.json'
  } else {
    const m = url.match(/^\/api\/plans\/([^/]+)\/([^/]+)$/)
    if (!m) return false
    const [, bdId, file] = m
    const bdUpper = bdId.toUpperCase()
    if (!BD_ID_RE.test(bdUpper) || !FILE_RE.test(file)) {
      res.writeHead(400, { ...headers, 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Invalid bdId or file' }))
      return true
    }
    s3Key = `plans/${bdUpper}/${file}`
  }

  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: GEOJSON_BUCKET, Key: s3Key }))
    const bytes = await obj.Body!.transformToByteArray()
    const contentType = s3Key.endsWith('.geojson') ? 'application/geo+json' : 'application/json'
    const acceptEnc = (req.headers['accept-encoding'] ?? '').toString().toLowerCase()

    if (acceptEnc.includes('gzip')) {
      const compressed = gzipSync(bytes)
      res.writeHead(200, { ...headers, 'Content-Type': contentType, 'Content-Encoding': 'gzip', 'Cache-Control': 'public, max-age=3600' })
      res.end(compressed)
    } else {
      res.writeHead(200, { ...headers, 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' })
      res.end(Buffer.from(bytes))
    }
  } catch (e: any) {
    const status = (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) ? 404 : 500
    res.writeHead(status, { ...headers, 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: status === 404 ? `Not found: ${s3Key}` : 'Internal error' }))
  }
  return true
}

function corsPlanHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  }
}

const PORT = Number(process.env.PORT ?? 3001)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173'
const MAX_QUERY_LENGTH = 2000

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders())
    res.end()
    return
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...corsHeaders(), 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', model: process.env.BEDROCK_MODEL_ID ?? 'default' }))
    return
  }

  // Plans proxy: GET /api/plans/*
  if (req.method === 'GET' && req.url?.startsWith('/api/plans/')) {
    await handlePlans(req.url, req, res)
    return
  }

  if (req.method !== 'POST' || req.url !== '/api/agent') {
    res.writeHead(404, { ...corsHeaders(), 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not found' }))
    return
  }

  // Parse request body
  let query: string
  let sessionId: string
  try {
    const body = JSON.parse((await readBody(req)) || '{}') as { query?: string; sessionId?: string }
    query = body.query?.trim() ?? ''
    sessionId = body.sessionId ?? `local-${Date.now()}`
    if (!query || query.length > MAX_QUERY_LENGTH) {
      res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: query ? `query exceeds ${MAX_QUERY_LENGTH} characters` : 'query is required',
        })
      )
      return
    }
  } catch {
    res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid JSON body' }))
    return
  }

  // Stream SSE response
  res.writeHead(200, {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })

  try {
    await runCampusGeoAgent(query, sessionId, (eventObj) => {
      res.write(`data: ${JSON.stringify(eventObj)}\n\n`)
    })
  } catch (err) {
    // Generic message to the client; full detail stays in the local console.
    console.error('[dev-server] agent error:', err)
    res.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal error' })}\n\n`)
  }
  res.end()
})

server.listen(PORT, () => {
  console.log(`[dev-server] CampusGeo agent listening on http://localhost:${PORT}`)
  console.log(`[dev-server] POST /api/agent  ·  GET /health  ·  GET /api/plans/*`)
  console.log(`[dev-server] region=${process.env.AWS_REGION ?? 'us-east-1'} model=${process.env.BEDROCK_MODEL_ID ?? 'default'}`)
})
