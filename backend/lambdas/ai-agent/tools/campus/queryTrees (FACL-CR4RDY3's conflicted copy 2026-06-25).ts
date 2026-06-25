import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' })
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'

export const QueryTreesInputSchema = z.object({
  species: z.string().optional().describe('Tree species common name (e.g., "Maple", "Ash", "Oak")'),
  ageClass: z.string().optional().describe('Tree age class: "Young", "Semi-mature", "Mature"'),
  condition: z.string().optional().describe('Tree condition: "Good", "Fair", "Poor"'),
  minDiameter: z.number().optional().describe('Minimum diameter in cm'),
  location: z.string().optional().describe('Location description (e.g., "Main Quad")'),
})

export type QueryTreesInput = z.infer<typeof QueryTreesInputSchema>

interface TreeFeature {
  type: 'Feature'
  properties: {
    treeId?: string
    hostId?: string
    Common_Nam?: string
    ageClass?: string
    conditionC?: string
    Diameter?: number
    dbh1?: string
    heightClas?: string
    canopyRadi?: string
    locationRa?: string
    [key: string]: unknown
  }
  geometry: {
    type: 'Point'
    coordinates: [number, number]
  }
}

interface TreeGeoJSON {
  type: 'FeatureCollection'
  features: TreeFeature[]
}

/**
 * Query campus tree data with filtering
 *
 * 用途：
 * - "去年种了多少棵树？" → 过滤 YEAR_PLANTED
 * - "Main Quad 有多少橡树？" → 过滤 LOCATION + SPECIES
 * - "统计所有树木" → 返回总数
 */
export async function queryTrees(input: QueryTreesInput) {
  try {
    // 1. 从 S3 读取树木 GeoJSON
    const response = await s3.send(new GetObjectCommand({
      Bucket: BUCKET,
      Key: 'layers/trees.geojson'
    }))

    if (!response.Body) {
      return { error: 'Tree data not found in S3' }
    }

    const bodyString = await response.Body.transformToString()
    const geojson: TreeGeoJSON = JSON.parse(bodyString)

    // 2. 应用过滤条件
    let filtered = geojson.features

    // 过滤：树种
    if (input.species) {
      const sp = input.species.toLowerCase()
      filtered = filtered.filter(f => {
        const species = f.properties.Common_Nam || f.properties.hostId
        return species && typeof species === 'string' &&
               species.toLowerCase().includes(sp)
      })
    }

    // 过滤：年龄等级
    if (input.ageClass) {
      const age = input.ageClass.toLowerCase()
      filtered = filtered.filter(f => {
        const ageClass = f.properties.ageClass
        return ageClass && typeof ageClass === 'string' &&
               ageClass.toLowerCase().includes(age)
      })
    }

    // 过滤：状态
    if (input.condition) {
      const cond = input.condition.toLowerCase()
      filtered = filtered.filter(f => {
        const condition = f.properties.conditionC
        return condition && typeof condition === 'string' &&
               condition.toLowerCase().includes(cond)
      })
    }

    // 过滤：最小直径
    if (input.minDiameter) {
      filtered = filtered.filter(f => {
        const diameter = f.properties.Diameter
        return diameter !== undefined && diameter >= input.minDiameter!
      })
    }

    // 过滤：位置
    if (input.location) {
      const loc = input.location.toLowerCase()
      filtered = filtered.filter(f => {
        const location = f.properties.locationRa
        return location && typeof location === 'string' &&
               location.toLowerCase().includes(loc)
      })
    }

    // 3. 统计信息
    const count = filtered.length
    const speciesCount: Record<string, number> = {}
    const ageCount: Record<string, number> = {}
    const conditionCount: Record<string, number> = {}

    for (const feature of filtered) {
      // 统计树种
      const species = feature.properties.Common_Nam || 'Unknown'
      speciesCount[species] = (speciesCount[species] || 0) + 1

      // 统计年龄等级
      const age = feature.properties.ageClass
      if (age) {
        ageCount[age] = (ageCount[age] || 0) + 1
      }

      // 统计状态
      const condition = feature.properties.conditionC
      if (condition) {
        conditionCount[condition] = (conditionCount[condition] || 0) + 1
      }
    }

    // 4. 生成摘要
    const topSpecies = Object.entries(speciesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ species: name, count }))

    // 5. 返回结果
    return {
      summary: {
        totalCount: count,
        topSpecies,
        ageBreakdown: ageCount,
        conditionBreakdown: conditionCount,
        queryFilters: input
      },
      features: {
        type: 'FeatureCollection' as const,
        features: filtered
      }
    }

  } catch (error) {
    console.error('queryTrees error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error querying trees'
    }
  }
}
