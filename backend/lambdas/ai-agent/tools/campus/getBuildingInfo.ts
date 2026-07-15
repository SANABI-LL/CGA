import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const GetBuildingInfoInputSchema = z.object({
  buildingIdentifier: z.string().max(200).describe('Building name (e.g. "Regenstein Library") or building code (e.g. "C03")'),
}).strict()

export type GetBuildingInfoInput = z.infer<typeof GetBuildingInfoInputSchema>

type BuildingProps = Record<string, unknown>

// The four name-bearing columns that actually exist in layers/buildings.geojson:
// DISCRIPT1 is the primary building name; the others carry alternates.
function matchesName(props: BuildingProps, needle: string): boolean {
  const haystacks = [props.DISCRIPT1, props.OtherNames, props.Facility_Name, props.DISCRIPT2]
  return haystacks.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle))
}

// Building codes are alphanumeric strings like "C03" — exact match only,
// so a code query never substring-collides with building names.
function matchesCode(props: BuildingProps, needle: string): boolean {
  return [props.BD_ID, props.Building_Code].some(
    (v) => typeof v === 'string' && v.trim().toLowerCase() === needle
  )
}

// Year_Completed is numeric; Year_Opened is an ISO date string ("1970-10-01T…").
function yearFrom(props: BuildingProps): number | undefined {
  const completed = props.Year_Completed
  if (typeof completed === 'number' && completed > 0) return Math.round(completed)
  const opened = props.Year_Opened
  if (typeof opened === 'string' && opened.length >= 4) {
    const y = parseInt(opened.slice(0, 4), 10)
    if (!Number.isNaN(y)) return y
  }
  return undefined
}

/**
 * 获取建筑详细信息（从 S3 GeoJSON）
 *
 * 用途：
 * - "Show me Regenstein Library" → 按名称查找建筑
 * - "What is building C03?" → 按建筑代码查询
 */
export async function getBuildingInfo(input: GetBuildingInfoInput) {
  const needle = input.buildingIdentifier.trim().toLowerCase()
  if (needle.length < 2) {
    return { error: 'Building identifier is too short.' }
  }

  // The layer holds 308 features; load it whole and match across the real
  // name/code columns (the WHERE-clause parser only supports single fields).
  const result = await queryS3Layer({
    layerName: 'buildings',
    maxResults: 500,
    returnGeometry: true,
  })

  if ('error' in result) return result

  const matched = result.features
    .filter((f) => {
      const props = f.properties as BuildingProps
      return matchesCode(props, needle) || matchesName(props, needle)
    })
    .slice(0, 5)

  if (matched.length === 0) {
    return { error: `No buildings found matching "${input.buildingIdentifier}"` }
  }

  const buildings = matched.map((f) => {
    const props = f.properties as BuildingProps
    return {
      name: props.DISCRIPT1 ?? props.Facility_Name ?? 'Unknown',
      code: props.BD_ID ?? props.Building_Code,
      description: props.DISCRIPT2,
      address: props.ADDRESS,
      yearBuilt: yearFrom(props),
      sqft: props.Gross_Area__s_f__,
      heightFt: props.BLDG_HGT,
      architects: props.Architects,
      heritage: props.Heritage,
      notes: props.Notes,
      geometry: f.geometry,
    }
  })

  return {
    query: input.buildingIdentifier,
    count: buildings.length,
    buildings,
    features: {
      type: 'FeatureCollection' as const,
      // Allow-listed properties only — never ship raw layer columns
      features: matched.map((f) => ({
        ...f,
        properties: pickBuildingProps(f.properties as BuildingProps),
      })),
    },
  }
}
