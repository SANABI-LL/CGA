import { z } from 'zod'

export const AgentRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  sessionId: z.string().optional(),
})
export type AgentRequest = z.infer<typeof AgentRequestSchema>

export const QueryHistoryItemSchema = z.object({
  queryId: z.string(),
  queryText: z.string(),
  timestamp: z.number(),
  sessionId: z.string(),
})
export type QueryHistoryItem = z.infer<typeof QueryHistoryItemSchema>

export const BookmarkSchema = z.object({
  bookmarkId: z.string(),
  featureName: z.string(),
  featureType: z.string(),
  coordinates: z.object({ lat: z.number(), lng: z.number() }),
  layerId: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.number(),
})
export type Bookmark = z.infer<typeof BookmarkSchema>
