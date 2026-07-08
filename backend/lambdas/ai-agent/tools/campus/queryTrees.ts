import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'us-east-1',
  forcePathStyle: false
})
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'

export const QueryTreesInputSchema = z.object({
  species: z.string().optional().describe('Tree species common name (e.g., "Maple", "Ash", "Oak")'),
  ageClass: z.string().optional().describe('Tree age class: "Young", "Semi-mature", "Mature"'),
  condition: z.string().optional().describe('Tree condition: "Good", "Fair", "Poor"'),
  minDiameter: z.number().optional().describe('Minimum diameter in cm'),
  location: z.string().optional().describe('Location description (e.g., "Main Quad")'),
  year: z.number().optional().describe('Year planted or last updated (e.g., 2024, 2025, 2026)'),
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

    // 字段名兼容：当前 S3 数据用 CommonName/AgeClass/Condition/DBH1，
    // 旧转换产物用 Common_Nam/ageClass/conditionC/Diameter
    const firstString = (f: TreeFeature, keys: string[]): string | null => {
      for (const key of keys) {
        const v = f.properties[key]
        if (v && typeof v === 'string') return v
      }
      return null
    }

    // 过滤：树种（常用名/学名/属名都可命中，如 "Maple" → "Maple-Sugar"）
    if (input.species) {
      const sp = input.species.toLowerCase()
      filtered = filtered.filter(f => {
        const species = firstString(f, ['CommonName', 'Common_Nam', 'ScientName', 'Genus', 'hostId'])
        return species !== null && species.toLowerCase().includes(sp)
      })
    }

    // 过滤：年龄等级
    if (input.ageClass) {
      const age = input.ageClass.toLowerCase()
      filtered = filtered.filter(f => {
        const ageClass = firstString(f, ['AgeClass', 'ageClass'])
        return ageClass !== null && ageClass.toLowerCase().includes(age)
      })
    }

    // 过滤：状态
    if (input.condition) {
      const cond = input.condition.toLowerCase()
      filtered = filtered.filter(f => {
        const condition = firstString(f, ['Condition', 'conditionC'])
        return condition !== null && condition.toLowerCase().includes(cond)
      })
    }

    // 过滤：最小直径（DBH1 为字符串英寸值）
    if (input.minDiameter) {
      filtered = filtered.filter(f => {
        const raw = f.properties.Diameter ?? f.properties.DBH1
        const diameter = typeof raw === 'string' ? parseFloat(raw) : raw
        return typeof diameter === 'number' && !Number.isNaN(diameter) && diameter >= input.minDiameter!
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

    // 过滤：年份（种植年份或最后更新年份）
    if (input.year) {
      filtered = filtered.filter(f => {
        // 检查 Dateinvent 或 LastUpda 字段
        const dateInvent = f.properties.Dateinvent
        const lastUpdate = f.properties.LastUpda

        // 尝试从日期字符串中提取年份
        const extractYear = (dateStr: any): number | null => {
          if (!dateStr || typeof dateStr !== 'string') return null

          // 匹配 "MM/DD/YYYY" 或 "YYYY-MM-DD" 格式
          const match = dateStr.match(/(\d{4})/)
          return match ? parseInt(match[1]) : null
        }

        const inventYear = extractYear(dateInvent)
        const updateYear = extractYear(lastUpdate)

        // 如果任一年份匹配，返回 true
        return inventYear === input.year || updateYear === input.year
      })
    }

    // 3. 统计信息
    const count = filtered.length
    const speciesCount: Record<string, number> = {}
    const ageCount: Record<string, number> = {}
    const conditionCount: Record<string, number> = {}

    for (const feature of filtered) {
      // 统计树种（新旧字段名兼容，同过滤逻辑）
      const species = firstString(feature, ['CommonName', 'Common_Nam']) || 'Unknown'
      speciesCount[species] = (speciesCount[species] || 0) + 1

      // 统计年龄等级
      const age = firstString(feature, ['AgeClass', 'ageClass'])
      if (age) {
        ageCount[age] = (ageCount[age] || 0) + 1
      }

      // 统计状态
      const condition = firstString(feature, ['Condition', 'conditionC'])
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
    // 树是点要素，可以全量上图（上限 6000 防御异常数据）——但要把 55 个
    // CAD 字段瘦身成展示所需的 5 个，否则 5000+ 棵的属性就有数 MB。
    // 模型只读统计摘要（_modelSummary），不接收逐棵几何。
    const summary = {
      totalCount: count,
      topSpecies,
      ageBreakdown: ageCount,
      conditionBreakdown: conditionCount,
      queryFilters: input
    }
    const mapFeatures = filtered.slice(0, 6000).map(f => ({
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: {
        TreeID: f.properties.TreeID ?? f.properties.OBJECTID,
        OBJECTID: f.properties.OBJECTID,
        CommonName: firstString(f, ['CommonName', 'Common_Nam']),
        Condition: firstString(f, ['Condition', 'conditionC']),
        AgeClass: firstString(f, ['AgeClass', 'ageClass'])
      }
    }))

    return {
      summary,
      features: {
        type: 'FeatureCollection' as const,
        features: mapFeatures
      },
      _modelSummary: {
        ...summary,
        featuresShownOnMap: mapFeatures.length,
        note: 'Features are rendered on the map; per-tree geometry omitted here.'
      }
    }

  } catch (error) {
    console.error('queryTrees error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error querying trees'
    }
  }
}
