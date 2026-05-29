import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { runCampusGeoAgent } from './agent'

// This Lambda uses Lambda streaming (Response Streaming) for SSE
// Deploy with FunctionUrlConfig.InvokeMode = RESPONSE_STREAM

export const handler = awslambda.streamifyResponse(
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
