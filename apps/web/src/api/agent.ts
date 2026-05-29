import type { FeatureCollection } from '@campusgeo/shared-types'

interface StreamCallbacks {
  onText: (text: string) => void
  onToolCall: (toolName: string) => void
  onToolResult: (toolName: string, data: unknown) => void
  onDone: () => void
  onError: (message: string) => void
}

const API_BASE = import.meta.env.VITE_API_URL ?? ''

export async function streamAgentQuery(
  query: string,
  callbacks: StreamCallbacks
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/agent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ query }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API error ${response.status}: ${text}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (!raw || raw === '[DONE]') continue

      try {
        const event = JSON.parse(raw) as {
          type: string
          content?: string
          toolName?: string
          toolInput?: unknown
          data?: unknown
          message?: string
          mapUpdate?: { features?: FeatureCollection; center?: { lat: number; lng: number } }
        }

        switch (event.type) {
          case 'text':
            if (event.content) callbacks.onText(event.content)
            break
          case 'tool_call':
            if (event.toolName) callbacks.onToolCall(event.toolName)
            break
          case 'tool_result':
            if (event.toolName) {
              callbacks.onToolResult(event.toolName, event.mapUpdate ?? event.data)
            }
            break
          case 'done':
            callbacks.onDone()
            return
          case 'error':
            callbacks.onError(event.message ?? 'Unknown error')
            return
        }
      } catch {
        // Ignore parse errors on malformed SSE lines
      }
    }
  }

  callbacks.onDone()
}
