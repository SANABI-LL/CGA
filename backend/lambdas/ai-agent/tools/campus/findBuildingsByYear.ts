import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'

export const FindBuildingsByYearInputSchema = z.object({
  before: z.number().int().min(1850).max(2100).optional().describe('Return buildings completed before this year (exclusive)'),
  after: z.number().int().min(1850).max(2100).optional().describe('Return buildings completed after this year (exclusive)'),
  maxResults: z.number().int().min(1).max(200).optional().default(60),
}).strict()

export type FindBuildingsByYearInput = z.infer<typeof FindBuildingsByYearInputSchema>

type Props = Record<string, unknown>

// Mirrors getBuildingInfo.yearFrom — reads both year columns.
function yearFrom(props: Props): number | undefined {
  const completed = props.Year_Completed
  if (typeof completed === 'number' && completed > 0) return Math.round(completed)
  const opened = props.Year_Opened
  if (typeof opened === 'string' && opened.length >= 4) {
    const y = parseInt(opened.slice(0, 4), 10)
    if (!Number.isNaN(y)) return y
  }
  return undefined
}

export async function findBuildingsByYear(input: FindBuildingsByYearInput) {
  if (input.before == null && input.after == null) {
    return { error: 'Provide at least one of before or after.' }
  }

  const raw = await queryS3Layer({
    layerName: 'buildings',
    maxResults: 500,
    returnGeometry: true,
  })

  if ('error' in raw) return raw

  let unknownYearCount = 0
  const matched = []

  for (const f of raw.features) {
    const year = yearFrom(f.properties)
    if (year == null) {
      unknownYearCount++
      continue
    }
    if (input.before != null && year >= input.before) continue
    if (input.after != null && year <= input.after) continue
    matched.push({ ...f, properties: { ...f.properties, _yearResolved: year } })
  }

  const features = matched.slice(0, input.maxResults)

  return {
    type: 'FeatureCollection' as const,
    features,
    count: features.length,
    unknownYearCount,
    layer: 'buildings',
    source: 's3',
    _modelSummary: {
      count: features.length,
      unknownYearCount,
      filter: { before: input.before, after: input.after },
      summary: `Found ${features.length} buildings${input.before ? ` built before ${input.before}` : ''}${input.after ? ` built after ${input.after}` : ''}. ${unknownYearCount} buildings had no year data and were excluded.`,
    },
  }
}
