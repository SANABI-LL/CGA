import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'

export const GetBuildingInfoInputSchema = z.object({
  buildingIdentifier: z.string().describe('Building name or UChicago building number'),
})

export type GetBuildingInfoInput = z.infer<typeof GetBuildingInfoInputSchema>

/**
 * 获取建筑详细信息（从 S3 GeoJSON）
 *
 * 用途：
 * - "Show me Regenstein Library" → 查找建筑
 * - "What is building 170?" → 按建筑编号查询
 */
export async function getBuildingInfo(input: GetBuildingInfoInput) {
  const name = input.buildingIdentifier.trim()
  const isNumeric = /^\d+$/.test(name)

  const whereClause = isNumeric
    ? `BLDG_NUM = '${name}'`
    : `BLDG_NAME LIKE '%${name.replace(/'/g, "''")}%'`

  const result = await queryS3Layer({
    layerName: 'buildings',
    whereClause,
    maxResults: 5,
    returnGeometry: true,
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
