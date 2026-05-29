import { z } from 'zod'
import type { FeatureCollection, LatLng } from './geo'

// SSE event types streamed from Lambda to frontend
export const AgentEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    toolName: z.string(),
    toolInput: z.record(z.unknown()),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolName: z.string(),
    data: z.unknown(),
    mapUpdate: z
      .object({
        features: z.custom<FeatureCollection>().optional(),
        focusPoint: z.custom<LatLng>().optional(),
        highlightIds: z.array(z.string()).optional(),
      })
      .optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done') }),
])

export type AgentEvent = z.infer<typeof AgentEventSchema>

export interface QueryRecord {
  queryId: string
  queryText: string
  aiResponse: string
  featureIds: string[]
  timestamp: number
  sessionId: string
}

export interface AIAnswerState {
  text: string
  isStreaming: boolean
  features: FeatureCollection | null
  toolCalls: Array<{ toolName: string; status: 'pending' | 'done' }>
}
