import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const GetBuildingsByIdsInputSchema = z.object({
  ids: z.array(z.string()).max(5000).describe('BD_ID values to look up, e.g. ["A06", "C03"]'),
  fields: z.array(z.string()).optional().describe('Specific property fields to include in results'),
}).strict()

export type GetBuildingsByIdsInput = z.infer<typeof GetBuildingsByIdsInputSchema>

export async function getBuildingsByIds(input: GetBuildingsByIdsInput) {
  const { ids } = input
  if (ids.length === 0) {
    return {
      foundCount: 0, notFoundCount: 0, found: [], notFound: [],
      features: { type: 'FeatureCollection' as const, features: [] },
    }
  }

  const normalised = new Map(ids.map((id) => [id.trim().toUpperCase(), id.trim()]))

  const result = await queryS3Layer({ layerName: 'buildings', maxResults: 1000, returnGeometry: true })
  if ('error' in result) return result

  const foundKeys = new Set<string>()
  const foundFeatures: typeof result.features = []

  for (const f of result.features) {
    const bdId = String((f.properties as Record<string, unknown>)?.BD_ID ?? '').trim().toUpperCase()
    if (normalised.has(bdId)) {
      foundKeys.add(bdId)
      foundFeatures.push(f)
    }
  }

  const notFound = [...normalised.keys()].filter((id) => !foundKeys.has(id))

  return {
    foundCount: foundKeys.size,
    notFoundCount: notFound.length,
    found: [...foundKeys],
    notFound,
    features: {
      type: 'FeatureCollection' as const,
      features: foundFeatures.map((f) => ({
        ...f,
        properties: pickBuildingProps(f.properties as Record<string, unknown>),
      })),
    },
    _modelSummary: {
      foundCount: foundKeys.size,
      notFoundCount: notFound.length,
      found: [...foundKeys],
      notFound: notFound.slice(0, 30),
    },
  }
}
