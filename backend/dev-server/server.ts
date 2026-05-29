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
import { runCampusGeoAgent } from '../lambdas/ai-agent/agent'

const PORT = Number(process.env.PORT ?? 3001)
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    if (!query) {
      res.writeHead(400, { ...corsHeaders(), 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'query is required' }))
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
    res.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`)
  }
  res.end()
})

server.listen(PORT, () => {
  console.log(`[dev-server] CampusGeo agent listening on http://localhost:${PORT}`)
  console.log(`[dev-server] POST /api/agent  ·  GET /health`)
  console.log(`[dev-server] region=${process.env.AWS_REGION ?? 'us-east-1'} model=${process.env.BEDROCK_MODEL_ID ?? 'default'}`)
})
