/**
 * Handler-level regression tests:
 * - the streaming truncation latch must never swallow `done` / `citation_warning`
 * - the legacy /query path must forward citation warnings in its JSON response
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

type SSEEvent = { type: string; [key: string]: unknown }

const agentMock = vi.hoisted(() => ({
  impl: undefined as undefined | ((onEvent: (e: SSEEvent) => void) => Promise<void>),
}))

vi.mock('../agent', () => ({
  runCampusGeoAgent: async (_q: string, _sid: string, onEvent: (e: SSEEvent) => void) =>
    agentMock.impl!(onEvent),
}))
vi.mock('../digest', () => ({
  runDailyDigest: async () => ({}),
  readDigestReport: async () => ({
    lastRunAt: '2026-07-14T07:00:33.781Z',
    date: 'Jul 14, 2026',
    baseline: false,
    items: [],
    layersTracked: 27,
    layerCounts: { buildings: 308, trees: 5491 },
    history: [
      { generatedAt: '2026-07-14T07:00:33.781Z', status: 'skipped', summary: 'No changes detected since the previous run', itemCount: 0 },
    ],
    schedule: 'Nightly at 02:00 America/Chicago (EventBridge)',
  }),
}))

function makeEvent(path: string, body: unknown): APIGatewayProxyEventV2 {
  return {
    requestContext: { http: { method: 'POST', path } },
    headers: { 'x-api-key': 'test-secret' },
    body: JSON.stringify(body),
  } as unknown as APIGatewayProxyEventV2
}

beforeEach(() => {
  vi.resetModules()
  process.env.API_SECRET = 'test-secret'
})

describe('streaming truncation latch', () => {
  it('still emits citation_warning and done after the byte budget trips', async () => {
    delete process.env.BUFFERED

    const written: string[] = []
    ;(globalThis as Record<string, unknown>).awslambda = {
      streamifyResponse: (fn: unknown) => fn,
      HttpResponseStream: { from: (stream: unknown) => stream },
    }
    const stream = {
      write: (chunk: string) => written.push(chunk),
      end: () => {},
    }

    // ~8 MB of text deltas (> 5 MB budget), then the terminal events
    agentMock.impl = async (onEvent) => {
      for (let i = 0; i < 400; i++) onEvent({ type: 'text', content: 'x'.repeat(20_000) })
      onEvent({ type: 'citation_warning', message: 'unverified', unverified: ['(Doc, p.1)'] })
      onEvent({ type: 'done' })
    }

    const { handler } = await import('../handler')
    await (handler as (e: APIGatewayProxyEventV2, s: unknown) => Promise<void>)(
      makeEvent('/api/agent', { query: 'long answer please' }),
      stream
    )

    expect(written.some((l) => l.includes('Response truncated'))).toBe(true)
    // terminal events must survive truncation — a missing `done` hangs the client
    expect(written.some((l) => l.includes('"type":"done"'))).toBe(true)
    expect(written.some((l) => l.includes('"type":"citation_warning"'))).toBe(true)
    // and the latch really did suppress the flood
    const textEvents = written.filter((l) => l.includes('"type":"text"'))
    expect(textEvents.length).toBeLessThan(400)
  })
})

describe('freshness endpoint (BUFFERED=1)', () => {
  it('returns the digest report as JSON without invoking the agent', async () => {
    process.env.BUFFERED = '1'
    agentMock.impl = async () => {
      throw new Error('agent must not run for freshness requests')
    }

    const { handler } = await import('../handler')
    const result = (await (handler as (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>)(
      makeEvent('/api/agent', { freshness: true })
    ))

    expect(result.statusCode).toBe(200)
    const parsed = JSON.parse(result.body ?? '{}') as {
      layersTracked: number
      history: Array<{ status: string }>
      date: string
    }
    expect(parsed.layersTracked).toBe(27)
    expect(parsed.date).toBe('Jul 14, 2026')
    expect(parsed.history[0].status).toBe('skipped')
  })

  it('still requires the API key', async () => {
    process.env.BUFFERED = '1'
    const { handler } = await import('../handler')
    const event = makeEvent('/api/agent', { freshness: true })
    ;(event.headers as Record<string, string>)['x-api-key'] = 'wrong'
    const result = (await (handler as (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>)(event))
    expect(result.statusCode).toBe(403)
  })
})

describe('legacy /query handler (BUFFERED=1)', () => {
  it('forwards citation_warning in the JSON response', async () => {
    process.env.BUFFERED = '1'

    agentMock.impl = async (onEvent) => {
      onEvent({ type: 'text', content: 'The FAR limit is 1.7 (Some Doc, p.9).' })
      onEvent({ type: 'citation_warning', message: 'unverified citations', unverified: ['(Some Doc, p.9)'] })
      onEvent({ type: 'done' })
    }

    const { handler } = await import('../handler')
    const result = (await (handler as (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyStructuredResultV2>)(
      makeEvent('/query', { q: 'what is the FAR limit?' })
    ))

    expect(result.statusCode).toBe(200)
    const parsed = JSON.parse(result.body ?? '{}') as {
      answer: string
      citationWarning?: { message: string; unverified: string[] }
    }
    expect(parsed.answer).toContain('FAR')
    expect(parsed.citationWarning?.unverified).toEqual(['(Some Doc, p.9)'])
  })
})
