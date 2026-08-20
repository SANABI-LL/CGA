import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'

const s3 = new S3Client({ region: 'us-east-1' })

export const GetBuildingUpdatesInputSchema = z.object({
  days: z.number().int().min(1).max(30).optional().default(7)
    .describe('How many days back to look for changes (default 7)'),
  layer: z.enum(['buildings', 'trees', 'dining', 'utilities', 'all']).optional().default('all')
    .describe('Filter by layer type, or "all" for everything'),
}).strict()

export type GetBuildingUpdatesInput = z.infer<typeof GetBuildingUpdatesInputSchema>

// Shape written by digest.ts → digest/history.json
interface HistoryEntry {
  generatedAt: string
  status: 'applied' | 'skipped' | 'held'
  summary: string
  itemCount: number
  baseline?: boolean
}

// Shape written by digest.ts → digest/latest.json
interface DigestItem {
  icon: string
  headline: string
  detail: string
  sub: string
}

interface DigestLatest {
  date: string
  generatedAt: string
  baseline?: boolean
  items: DigestItem[]
}

async function readS3Json<T>(key: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }))
    return JSON.parse(await r.Body!.transformToString()) as T
  } catch {
    return null
  }
}

const LAYER_KEYWORDS: Record<string, string[]> = {
  buildings: ['Campus Buildings', 'LEED'],
  trees: ['Campus Trees'],
  dining: ['Dining'],
  utilities: ['Utilities'],
}

function matchesLayer(headline: string, layer: string): boolean {
  if (layer === 'all') return true
  const keywords = LAYER_KEYWORDS[layer] ?? []
  return keywords.some((kw) => headline.includes(kw))
}

export async function getBuildingUpdates(input: GetBuildingUpdatesInput) {
  const [history, latest] = await Promise.all([
    readS3Json<HistoryEntry[]>('digest/history.json'),
    readS3Json<DigestLatest>('digest/latest.json'),
  ])

  if (!history && !latest) {
    return {
      error: 'Campus data digest not yet initialized. Try again after the daily sync runs (07:00 UTC).',
    }
  }

  const cutoff = new Date(Date.now() - input.days * 24 * 60 * 60 * 1000)

  // Recent history entries within the time window
  const recentRuns = (history ?? [])
    .filter((e) => !e.baseline && new Date(e.generatedAt) >= cutoff)
    .map((e) => ({
      date: e.generatedAt.slice(0, 10),
      status: e.status,
      summary: e.summary,
      changeCount: e.itemCount,
    }))

  // Detailed items from the most recent run that had changes
  const latestItems = (latest?.items ?? [])
    .filter((item) => matchesLayer(item.headline, input.layer))
    .map((item) => ({
      headline: item.headline,
      detail: item.detail,
      context: item.sub,
    }))

  const lastSync = latest?.generatedAt ?? history?.[0]?.generatedAt ?? null

  return {
    recentRuns,
    latestChanges: latestItems,
    lastSynced: lastSync,
    layer: input.layer,
    daysCovered: input.days,
    _modelSummary: {
      recentRunCount: recentRuns.length,
      totalChanges: recentRuns.reduce((s, r) => s + r.changeCount, 0),
      lastSynced: lastSync,
      latestHeadlines: latestItems.slice(0, 5).map((i) => i.headline),
      layer: input.layer,
    },
  }
}
