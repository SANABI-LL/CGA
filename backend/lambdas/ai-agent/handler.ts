import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { runCampusGeoAgent } from './agent'

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
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders() }
  }

  // Legacy contract used by print-flow.html: POST /query {q} →
  // one-shot JSON {answer, features, intent, mapAction}.
  if (event.requestContext.http.path.endsWith('/query')) {
    return legacyQueryHandler(event)
  }

  let query: string
  let sessionId: string
  try {
    const body = JSON.parse(event.body ?? '{}') as { query?: string; sessionId?: string }
    query = body.query?.trim() ?? ''
    sessionId = body.sessionId ?? `anon-${Date.now()}`
    if (!query) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'query is required' }),
      }
    }
  } catch {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body' }),
    }
  }

  const events: string[] = []
  try {
    await runCampusGeoAgent(query, sessionId, (eventObj) => {
      events.push(`data: ${JSON.stringify(capMapUpdate(eventObj, 300))}\n\n`)
    })
  } catch (err) {
    events.push(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`)
  }

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
  if (!q) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'q is required' }),
    }
  }

  let answer = ''
  let intent = 'query'
  // The agent may call several tools (e.g. one query per utility system) —
  // merge every mapUpdate's features instead of keeping only the last one.
  const allFeatures: unknown[] = []
  let center: { lat: number; lng: number } | undefined

  try {
    await runCampusGeoAgent(q, `legacy-${Date.now()}`, (eventObj) => {
      if (eventObj.type === 'text' && typeof eventObj.content === 'string') {
        answer += eventObj.content
      }
      if (eventObj.type === 'tool_call' && typeof eventObj.toolName === 'string') {
        intent = eventObj.toolName
      }
      const mapUpdate = (eventObj as MapUpdateEvent).mapUpdate
      if (mapUpdate?.features) {
        const fc = capMapUpdate(eventObj as MapUpdateEvent, 300).mapUpdate?.features as
          | { features?: unknown[] }
          | undefined
        if (fc?.features) allFeatures.push(...fc.features)
        const c = (mapUpdate as { center?: { lat: number; lng: number } }).center
        if (c && !center) center = c
      }
    })
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: String(err) }),
    }
  }

  return {
    statusCode: 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer,
      intent,
      // 600-feature ceiling keeps the merged one-shot payload well under the
      // 6 MB Lambda response limit even for dense polyline layers
      features: { type: 'FeatureCollection', features: allFeatures.slice(0, 600) },
      mapAction: center ? { center: [center.lng, center.lat], zoom: 16 } : undefined,
    }),
  }
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

    // Parse request
    let query: string
    let sessionId: string

    try {
      const body = JSON.parse(event.body ?? '{}') as { query?: string; sessionId?: string }
      query = body.query?.trim() ?? ''
      sessionId = body.sessionId ?? `anon-${Date.now()}`

      if (!query) {
        const metadata = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 400,
          headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
        } as never)
        metadata.write(JSON.stringify({ error: 'query is required' }))
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

    try {
      await runCampusGeoAgent(query, sessionId, (eventObj) => {
        metadata.write(`data: ${JSON.stringify(eventObj)}\n\n`)
      })
    } catch (err) {
      metadata.write(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`)
    }

    metadata.end()
  }
)

export const handler = process.env.BUFFERED === '1' ? bufferedHandler : streamingHandler()

function corsHeaders() {
  const origin = process.env.ALLOWED_ORIGIN ?? '*'
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
