import { z } from 'zod'
import { queryArcGIS } from './queryArcGIS'

export const GetBuildingInfoInputSchema = z.object({
  buildingIdentifier: z.string().describe('Building name or UChicago building number'),
})

export type GetBuildingInfoInput = z.infer<typeof GetBuildingInfoInputSchema>

export async function getBuildingInfo(input: GetBuildingInfoInput) {
  const name = input.buildingIdentifier.trim()
  const isNumeric = /^\d+$/.test(name)

  const whereClause = isNumeric
    ? `BLDG_NUM = '${name}'`
    : `LOWER(BLDG_NAME) LIKE '%${name.toLowerCase().replace(/'/g, "''")}%'`

  const result = await queryArcGIS({
    layerName: 'buildings',
    whereClause,
    maxResults: 5,
    returnGeometry: true,
    outFields: '*'
  })

  if ('error' in result) return result
  if (result.features.length === 0) {
    return { error: `No buildings found matching "${input.buildingIdentifier}"` }
  }

  const buildings = result.features.map((f) => {
    const props = f.properties as Record<string, unknown>
    return {
      name: props.BLDG_NAME ?? props.NAME ?? 'Unknown',
      number: props.BLDG_NUM,
      use: props.BLDG_USE ?? props.USE_TYPE,
      address: props.ADDRESS ?? props.ADDR,
      floors: props.FLOORS ?? props.NUM_FLOORS,
      yearBuilt: props.YEAR_BUILT,
      sqft: props.SQ_FEET ?? props.SQFT,
      accessible: props.ACCESSIBLE ?? props.ADA,
      geometry: f.geometry,
    }
  })

  return {
    query: input.buildingIdentifier,
    count: buildings.length,
    buildings,
    features: {
      type: 'FeatureCollection' as const,
      features: result.features,
    },
  }
}
