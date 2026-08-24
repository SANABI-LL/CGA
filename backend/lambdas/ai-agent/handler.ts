import { randomUUID } from 'node:crypto'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { runCampusGeoAgent } from './agent'
import { runDailyDigest, readDigestReport } from './digest'
import { queryS3Layer } from './tools/campus/queryS3Layer'
import { getSessionHistory, appendSessionTurn } from './session'

const MAX_QUERY_LENGTH = 2000

// tool_result events on the "data" path (no mapUpdate) are forwarded only for
// these tools — the frontend uses them to render structured cards directly.
// All other data-only tool_results are suppressed to keep payload small.
const PASSTHROUGH_DATA_TOOLS = new Set(['check_hours', 'get_campus_events', 'get_academic_calendar'])

// Shared-secret gate: the API must never be anonymously callable, whichever
// front door (CloudFront, API Gateway, Function URL) the request came through.
// Fail closed — a Lambda without API_SECRET configured rejects everything.
function isAuthorized(event: APIGatewayProxyEventV2): boolean {
  const secret = process.env.API_SECRET
  if (!secret) return false
  const provided =
    event.headers?.['x-api-key'] ?? event.headers?.['authorization']?.replace(/^Bearer\s+/i, '')
  return provided === secret
}

// Generic client-facing error + correlation id; full detail stays in CloudWatch.
function logInternalError(err: unknown): string {
  const ref = randomUUID()
  console.error(`[${ref}]`, err)
  return ref
}

// This Lambda uses Lambda streaming (Response Streaming) for SSE
// Deploy with FunctionUrlConfig.InvokeMode = RESPONSE_STREAM
//
// BUFFERED=1 switches to a standard (non-streaming) API Gateway handler that
// runs the full agent loop and returns the complete SSE transcript in one
// response body. Needed when the org's SCP blocks Function URL invocation and
// traffic must flow through API Gateway, which cannot stream. The frontend's
// SSE parser consumes the buffered transcript unchanged — it just arrives all
// at once instead of incrementally.

async function bufferedHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  // EventBridge daily schedule (no requestContext on scheduled events)
  if ((event as unknown as { source?: string }).source === 'aws.events') {
    try {
      const result = await runDailyDigest()
      return { statusCode: 200, body: JSON.stringify(result) }
    } catch (err) {
      // Log full detail server-side; return 500 so EventBridge retry policy
      // can attempt redelivery (requires RetryPolicy configured on the target).
      const ref = logInternalError(err)
      return { statusCode: 500, body: JSON.stringify({ error: 'Digest failed', ref }) }
    }
  }

  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() }
  }

  if (!isAuthorized(event)) {
    return {
      statusCode: 403,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden' }),
    }
  }

  // Legacy contract used by print-flow.html: POST /query {q} →
  // one-shot JSON {answer, features, intent, mapAction}.
  if (event.requestContext.http.path.endsWith('/query')) {
    return legacyQueryHandler(event)
  }

  // Lightweight data-provenance endpoint for the frontend digest panel —
  // plain S3 reads, no LLM. Reachable today as POST /api/agent
  // {"freshness": true} (no new API Gateway route needed); the path check
  // means a dedicated /api/freshness route needs no code change later.
  let peekBody: Record<string, unknown> = {}
  try { peekBody = JSON.parse(event.body ?? '{}') as Record<string, unknown> } catch { /* fall through to normal 400 */ }
  if (event.requestContext.http.path.endsWith('/freshness') || peekBody.freshness === true) {
    try {
      return {
        statusCode: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
        body: JSON.stringify(await readDigestReport()),
      }
    } catch (err) {
      const ref = logInternalError(err)
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal error', ref }),
      }
    }
  }

  // Lightweight S3 layer fetch — no AI, no auth beyond the shared secret.
  // Frontend calls this on page load to pre-fetch buildings for map context.
  // Supported: { layerData: 'buildings' } (and other queryS3Layer layerNames).
  if (typeof peekBody.layerData === 'string') {
    try {
      const result = await queryS3Layer({
        layerName: peekBody.layerData as Parameters<typeof queryS3Layer>[0]['layerName'],
        maxResults: 500,
        returnGeometry: true,
      })
      return {
        statusCode: 200,
        headers: {
          ...corsHeaders(),
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=3600',
        },
        body: JSON.stringify(result),
      }
    } catch (err) {
      const ref = logInternalError(err)
      return {
        statusCode: 500,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Internal error', ref }),
      }
    }
  }

  let query: string
  let sessionId: string
  try {
    const body = JSON.parse(event.body ?? '{}') as { query?: string; sessionId?: string }
    query = body.query?.trim() ?? ''
    sessionId = body.sessionId ?? `anon-${Date.now()}`
    if (!query || query.length > MAX_QUERY_LENGTH) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: query ? `query exceeds ${MAX_QUERY_LENGTH} characters` : 'query is required',
        }),
      }
    }
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const sessionHistory = await getSessionHistory(sessionId)

  const events: string[] = []
  const turnAcc = { toolsUsed: new Set<string>(), featureCount: 0, answerText: '' }
  try {
    await runCampusGeoAgent(
      query,
      sessionId,
      (eventObj) => {
        if (eventObj.type === 'tool_call' && typeof eventObj.toolName === 'string') {
          turnAcc.toolsUsed.add(eventObj.toolName)
        }
        if (eventObj.type === 'text' && typeof eventObj.content === 'string') {
          turnAcc.answerText += eventObj.content
        }
        // Suppress data-only tool_result events for all but the passthrough tools.
        // mapUpdate tool_results (GeoJSON) are always forwarded for the map.
        if (eventObj.type === 'tool_result' && !(eventObj as MapUpdateEvent).mapUpdate) {
          if (!PASSTHROUGH_DATA_TOOLS.has((eventObj as { toolName?: string }).toolName ?? '')) return
        }
        const cap = mapCapFor((eventObj as MapUpdateEvent).mapUpdate?.features)
        const capped = capMapUpdate(eventObj, cap)
        const feats = (capped as MapUpdateEvent).mapUpdate?.features?.features
        if (Array.isArray(feats)) turnAcc.featureCount += feats.length
        events.push(`data: ${JSON.stringify(capped)}\n\n`)
      },
      sessionHistory
    )
  } catch (err) {
    const ref = logInternalError(err)
    events.push(`data: ${JSON.stringify({ type: 'error', message: 'Internal error', ref })}\n\n`)
  }

  await appendSessionTurn(sessionId, {
    query,
    toolsUsed: [...turnAcc.toolsUsed],
    featureCount: turnAcc.featureCount,
    summary: turnAcc.answerText.slice(0, 150),
  })

  let body = events.join('')
  // Lambda's buffered response limit is 6 MB; retry with a tighter feature cap
  // rather than letting the runtime reject the whole payload.
  if (body.length > 5_000_000) {
    body = events
      .map((line) => {
        try {
          const obj = JSON.parse(line.slice(6)) as Record<string, unknown>
          return `data: ${JSON.stringify(capMapUpdate(obj, 50))}\n\n`
        } catch {
          return line
        }
      })
      .join('')
  }

  return {
    statusCode: 200,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
    body,
  }
}

async function legacyQueryHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyStructuredResultV2> {
  let q: string
  try {
    q = (JSON.parse(event.body ?? '{}') as { q?: string }).q?.trim() ?? ''
  } catch {
    q = ''
  }
  if (!q || q.length > MAX_QUERY_LENGTH) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: q ? `q exceeds ${MAX_QUERY_LENGTH} characters` : 'q is required',
      }),
    }
  }

  let answer = ''
  let intent = 'query'
  // The agent may call several tools (e.g. one query per utility system) —
  // merge every mapUpdate's features instead of keeping only the last one.
  const featureChunks: unknown[][] = []
  let center: { lat: number; lng: number } | undefined
  let citationWarning: { message: string; unverified: string[] } | undefined

  try {
    await runCampusGeoAgent(q, `legacy-${Date.now()}`, (eventObj) => {
      if (eventObj.type === 'text' && typeof eventObj.content === 'string') {
        answer += eventObj.content
      }
      if (eventObj.type === 'tool_call' && typeof eventObj.toolName === 'string') {
        intent = eventObj.toolName
      }
      // This is the live path under BUFFERED=1 — dropping citation_warning
      // here would silence the fabricated-citation control entirely.
      if (eventObj.type === 'citation_warning') {
        citationWarning = {
          message: typeof eventObj.message === 'string' ? eventObj.message : 'Unverified citations detected.',
          unverified: Array.isArray(eventObj.unverified) ? (eventObj.unverified as string[]) : [],
        }
      }
      const mapUpdate = (eventObj as MapUpdateEvent).mapUpdate
      if (mapUpdate?.features) {
        const fc = capMapUpdate(eventObj as MapUpdateEvent, mapCapFor(mapUpdate.features)).mapUpdate?.features as
          | { features?: unknown[] }
          | undefined
        if (fc?.features) featureChunks.push(fc.features)
        const c = (mapUpdate as { center?: { lat: number; lng: number } }).center
        if (c && !center) center = c
      }
    })
  } catch (err) {
    const ref = logInternalError(err)
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error', ref }),
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer,
      intent,
      // Byte budget keeps the merged one-shot payload well under the 6 MB
      // Lambda response limit; round-robin across tool calls so no utility
      // system is cut out entirely, while cheap point sets can ship whole
      features: { type: 'FeatureCollection', features: interleave(featureChunks, 4_500_000) },
      mapAction: center ? { center: [center.lng, center.lat], zoom: 16 } : undefined,
      citationWarning,
    }),
  }
}

// Round-robin merge across tool calls under a byte budget: dense polyline
// chunks stop early, cheap point features (e.g. 5k trees) can all fit.
function interleave(chunks: unknown[][], byteBudget: number): unknown[] {
  const merged: unknown[] = []
  let bytes = 0
  for (let i = 0; bytes < byteBudget; i++) {
    let added = false
    for (const chunk of chunks) {
      if (i < chunk.length) {
        bytes += JSON.stringify(chunk[i]).length
        merged.push(chunk[i])
        added = true
        if (bytes >= byteBudget) break
      }
    }
    if (!added) break
  }
  return merged
}

// Per-tool map cap: point-only results are cheap to render and ship, so they
// get a much higher ceiling than vertex-dense lines/polygons.
function mapCapFor(fc: unknown): number {
  const feats = (fc as { features?: Array<{ geometry?: { type?: string } }> } | undefined)?.features
  if (!Array.isArray(feats) || !feats.length) return 300
  const pointsOnly = feats.every((f) => {
    const t = f?.geometry?.type
    return t === 'Point' || t === 'MultiPoint'
  })
  return pointsOnly ? 6000 : 300
}

interface MapUpdateEvent {
  mapUpdate?: { features?: { features?: unknown[] }; truncatedTo?: number }
  [key: string]: unknown
}

function capMapUpdate(eventObj: MapUpdateEvent, maxFeatures: number): MapUpdateEvent {
  const features = eventObj.mapUpdate?.features?.features
  if (!Array.isArray(features) || features.length <= maxFeatures) return eventObj
  return {
    ...eventObj,
    mapUpdate: {
      ...eventObj.mapUpdate,
      features: { ...eventObj.mapUpdate!.features, features: features.slice(0, maxFeatures) },
      truncatedTo: maxFeatures,
    },
  }
}

const streamingHandler = () => awslambda.streamifyResponse(
  async (event: APIGatewayProxyEventV2, responseStream) => {
    // CORS preflight
    if (event.requestContext.http.method === 'OPTIONS') {
      const headers = {
        statusCode: 204,
        headers: corsHeaders(),
      } satisfies APIGatewayProxyStructuredResultV2

      const metadata = awslambda.HttpResponseStream.from(responseStream, headers as never)
      metadata.end()
      return
    }

    if (!isAuthorized(event)) {
      const metadata = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 403,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      } as never)
      metadata.write(JSON.stringify({ error: 'Forbidden' }))
      metadata.end()
      return
    }

    // Parse request
    let query: string
    let sessionId: string

    try {
      const body = JSON.parse(event.body ?? '{}') as { query?: string; sessionId?: string }
      query = body.query?.trim() ?? ''
      sessionId = body.sessionId ?? `anon-${Date.now()}`

      if (!query || query.length > MAX_QUERY_LENGTH) {
        const metadata = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        } as never)
        metadata.write(
          JSON.stringify({
            error: query ? `query exceeds ${MAX_QUERY_LENGTH} characters` : 'query is required',
          })
        )
        metadata.end()
        return
      }
    } catch {
      const metadata = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      } as never)
      metadata.write(JSON.stringify({ error: 'Invalid JSON body' }))
      metadata.end()
      return
    }

    const sessionHistory = await getSessionHistory(sessionId)

    // Stream SSE response
    const metadata = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    } as never)

    // Same caps as the buffered path: per-event feature cap plus a total
    // event-count and byte budget, so streaming mode can't ship an unbounded
    // payload to the client. Terminal/control events are exempt: the client
    // hangs forever if `done` never arrives, and citation_warning is a safety
    // signal — both are tiny, so they always go out even after truncation.
    let eventCount = 0
    let bytesSent = 0
    let truncated = false
    const MAX_EVENTS = 500
    const MAX_BYTES = 5_000_000
    const TERMINAL_EVENT_TYPES = new Set(['done', 'citation_warning', 'error'])

    const streamTurnAcc = { toolsUsed: new Set<string>(), featureCount: 0, answerText: '' }

    try {
      await runCampusGeoAgent(query, sessionId, (eventObj) => {
        if (eventObj.type === 'tool_call' && typeof eventObj.toolName === 'string') {
          streamTurnAcc.toolsUsed.add(eventObj.toolName)
        }
        if (eventObj.type === 'text' && typeof eventObj.content === 'string') {
          streamTurnAcc.answerText += eventObj.content
        }
        // Suppress data-only tool_result events for all but the passthrough tools.
        // mapUpdate tool_results (GeoJSON) are always forwarded for the map.
        if (eventObj.type === 'tool_result' && !(eventObj as MapUpdateEvent).mapUpdate) {
          if (!PASSTHROUGH_DATA_TOOLS.has((eventObj as { toolName?: string }).toolName ?? '')) return
        }
        const isTerminal = TERMINAL_EVENT_TYPES.has(eventObj.type)
        if (!isTerminal) {
          if (truncated) return
          if (eventCount >= MAX_EVENTS || bytesSent >= MAX_BYTES) {
            truncated = true
            metadata.write(`data: ${JSON.stringify({ type: 'error', message: 'Response truncated: size limit reached' })}\n\n`)
            return
          }
        }
        const cap = mapCapFor((eventObj as MapUpdateEvent).mapUpdate?.features)
        const capped = capMapUpdate(eventObj as MapUpdateEvent, cap)
        const feats = capped.mapUpdate?.features?.features
        if (Array.isArray(feats)) streamTurnAcc.featureCount += feats.length
        const line = `data: ${JSON.stringify(capped)}\n\n`
        // Text deltas are numerous but tiny — the byte budget bounds them;
        // only payload-bearing events count toward the event cap.
        if (eventObj.type === 'tool_result' || (eventObj as MapUpdateEvent).mapUpdate) eventCount++
        bytesSent += line.length
        metadata.write(line)
      }, sessionHistory)
    } catch (err) {
      const ref = logInternalError(err)
      metadata.write(`data: ${JSON.stringify({ type: 'error', message: 'Internal error', ref })}\n\n`)
    }

    metadata.end()

    // Write session turn after stream closes so DynamoDB latency doesn't delay the client.
    await appendSessionTurn(sessionId, {
      query,
      toolsUsed: [...streamTurnAcc.toolsUsed],
      featureCount: streamTurnAcc.featureCount,
      summary: streamTurnAcc.answerText.slice(0, 150),
    })
  }
)

export const handler = process.env.BUFFERED === '1' ? bufferedHandler : streamingHandler()

function corsHeaders() {
  // No wildcard fallback: default to the local dev origin; production sets
  // ALLOWED_ORIGIN explicitly on the Lambda.
  const origin = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

// Type augmentation for Lambda streaming
declare const awslambda: {
  streamifyResponse: (
    handler: (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream) => Promise<void>
  ) => unknown
  HttpResponseStream: {
    from: (
      stream: NodeJS.WritableStream,
      metadata: Record<string, unknown>
    ) => NodeJS.WritableStream & { write: (chunk: string) => void; end: () => void }
  }
}
