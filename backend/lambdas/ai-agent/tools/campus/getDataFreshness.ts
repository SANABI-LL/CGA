import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'

const s3 = new S3Client({ region: AWS_REGION })

/**
 * Answers "when was the campus data last updated" truthfully from the Daily
 * Digest pipeline's own state: last diff run time, layers tracked, and the
 * most recent detected changes. No fabricated timestamps.
 */

export const GetDataFreshnessInputSchema = z.object({})
export type GetDataFreshnessInput = z.infer<typeof GetDataFreshnessInputSchema>

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const r = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    if (!r.Body) return null
    return JSON.parse(await r.Body.transformToString()) as T
  } catch {
    return null
  }
}

export async function getDataFreshness(_input: GetDataFreshnessInput) {
  const [state, latest] = await Promise.all([
    readJson<{ updatedAt?: string; layers?: Record<string, { count: number }> }>('digest/state.json'),
    readJson<{ date?: string; generatedAt?: string; items?: unknown[] }>('digest/latest.json'),
  ])

  if (!state && !latest) {
    return {
      error: 'The daily digest pipeline has not produced any state yet — freshness is unknown.',
    }
  }

  const layers = state?.layers ?? {}
  return {
    lastDiffRunAt: state?.updatedAt ?? latest?.generatedAt,
    digestDate: latest?.date,
    layersTracked: Object.keys(layers).length,
    recentChanges: latest?.items ?? [],
    schedule: 'The diff pipeline runs nightly at 02:00 America/Chicago (EventBridge).',
    layerCounts: Object.fromEntries(
      Object.entries(layers)
        .slice(0, 30)
        .map(([k, v]) => [k.replace('layers/', ''), v.count])
    ),
  }
}
