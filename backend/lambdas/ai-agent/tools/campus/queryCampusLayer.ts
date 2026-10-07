import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'

export const QueryCampusLayerInputSchema = z.object({
  layerName: z.enum(['subarea']).describe('Campus polygon layer to retrieve'),
  filterField: z.string().max(50).optional().describe(
    'Property to match, e.g. "SubArea"'
  ),
  filterValues: z.array(z.string().max(50)).max(20).optional().describe(
    'Accepted values, e.g. ["E"] or ["B","C"]. For subareas, single letters or "Subarea E" both work.'
  ),
  maxResults: z.number().int().min(1).max(300).optional().default(100),
}).strict()

export type QueryCampusLayerInput = z.infer<typeof QueryCampusLayerInputSchema>

// Normalise a value for matching against the SubArea field.
// "Subarea E", "sub-area E", "e", "E " → "E"
function normaliseSubarea(v: string): string {
  return v.trim().toUpperCase().replace(/^SUB-?AREA\s*/i, '')
}

export async function queryCampusLayer(input: QueryCampusLayerInput) {
  const raw = await queryS3Layer({ layerName: input.layerName, maxResults: 500, returnGeometry: true })
  if ('error' in raw) return raw

  let features = raw.features

  if (input.filterField && input.filterValues?.length) {
    const fieldLower = input.filterField.toLowerCase()
    const normed = input.layerName === 'subarea' && fieldLower === 'subarea'
      ? input.filterValues.map(normaliseSubarea)
      : input.filterValues.map(v => v.trim())

    features = features.filter(f => {
      const key = Object.keys(f.properties).find(k => k.toLowerCase() === fieldLower)
      if (!key) return false
      return normed.includes(String(f.properties[key]).trim().toUpperCase())
    })
  }

  const limit = input.maxResults ?? 100
  if (features.length > limit) features = features.slice(0, limit)

  return {
    // Wrap as { features: FeatureCollection } so agent.ts mapUpdate emitter
    // can do resultObj.features?.features to get the raw array (matching the
    // pattern used by queryBuildingAttributes and other map tools).
    features: { type: 'FeatureCollection' as const, features },
    count: features.length,
    layer: input.layerName,
  }
}
