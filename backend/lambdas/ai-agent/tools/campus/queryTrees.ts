import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getBucket } from './config'
import { resolveLocation, haversineMeters, distPointToPolygonMeters } from './findCampusNearby'

const s3 = new S3Client({
  region: 'us-east-1',
  forcePathStyle: false
})

export const QueryTreesInputSchema = z.object({
  species: z.string().max(200).optional().describe('Tree species common name (e.g., "Maple", "Ash", "Oak")'),
  ageClass: z.string().max(200).optional().describe('Tree age class: "Young", "Semi-mature", "Mature"'),
  condition: z.string().max(200).optional().describe('Tree condition: "Good", "Fair", "Poor"'),
  minDiameter: z.number().min(0).max(10_000).optional().describe('Minimum diameter in cm'),
  location: z.string().max(200).optional().describe('Attribute-based location tag in the tree inventory (e.g., "Main Quad"). NOT for spatial radius queries — use nearLocation for those.'),
  year: z.number().int().min(1800).max(2200).optional().describe('Year planted or last updated (e.g., 2024, 2025, 2026)'),
  notes: z.string().max(200).optional().describe('Keyword match on TreeNotes, which records planting batches like "2025 Fall" — use for "planted in fall 2025" questions'),
  nearLocation: z.string().max(200).optional().describe('Named campus location for spatial radius search, e.g. "Keller Center", "Regenstein Library". Use this — not location — when the user asks "trees near/within X" or "trees within N ft of X".'),
  radiusMeters: z.number().min(0).max(2000).optional().describe('Search radius in metres (default 150 for point anchors). For polygon landmarks (Main Quad, Midway…): omit to return trees INSIDE the polygon only; pass N to add an N-metre buffer around the boundary.'),
  ownership: z.enum(['campus', 'right-of-way']).optional().describe(
    'Filter by ownership. Use the UChicagoIn field: "campus" = trees on University-owned land (UChicagoIn is null/blank); ' +
    '"right-of-way" = trees on public land managed by another authority (CDOT, Midway Plaisance, etc.). ' +
    'Omit to return all trees.'
  ),
  sortBy: z.string().max(50).optional().describe(
    'Property field name to sort results by. Common: "EstValue" (appraised value), "CanRadius" (canopy size), "DBH1" (trunk diameter).'
  ),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction (default desc)'),
  topN: z.number().int().min(1).max(200).optional().describe('Return only the top N features after sorting. Use for "most valuable", "largest canopy", "biggest trunk" questions.'),
}).strict()

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
      Bucket: getBucket(),
      Key: 'layers/trees.geojson'
    }))

    if (!response.Body) {
      return { error: 'Tree data not found in S3' }
    }

    const bodyString = await response.Body.transformToString()
    const geojson: TreeGeoJSON = JSON.parse(bodyString)

    // 2. 应用过滤条件
    let filtered = geojson.features

    // 空间过滤：nearLocation + radiusMeters（优先于属性 location 字段）
    if (input.nearLocation) {
      const center = resolveLocation(input.nearLocation)
      if (!center) {
        return {
          error: `Unknown location "${input.nearLocation}". Try a well-known campus building name, e.g. "Regenstein Library", "Keller Center", "Main Quad".`,
        }
      }
      // Polygon anchor: default = 0 (inside only); point anchor: default = 150 m
      const radiusM = input.radiusMeters ?? (center.polygon ? 0 : 150)
      filtered = filtered.filter(f => {
        const [lng, lat] = f.geometry.coordinates
        const dist = center.polygon
          ? distPointToPolygonMeters(lng, lat, center.polygon)
          : haversineMeters(center.lat, center.lng, lat, lng)
        return dist <= radiusM
      })
      // 注入距离属性供 Agent 呈现
      filtered = filtered.map(f => {
        const [lng, lat] = f.geometry.coordinates
        const dist = center.polygon
          ? distPointToPolygonMeters(lng, lat, center.polygon)
          : haversineMeters(center.lat, center.lng, lat, lng)
        return {
          ...f,
          properties: {
            ...f.properties,
            _distanceMeters: Math.round(dist),
          },
        }
      }) as typeof filtered
    }

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

    // 过滤：TreeNotes 关键词（分词全含,不限词序——"fall 2025" 可命中 "2025 Fall"）
    if (input.notes) {
      const tokens = input.notes.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1)
      if (tokens.length) {
        filtered = filtered.filter(f => {
          const notes = f.properties.TreeNotes
          if (!notes || typeof notes !== 'string') return false
          const lower = notes.toLowerCase()
          return tokens.every(t => lower.includes(t))
        })
      }
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

    // 过滤：归属（UChicagoIn 字段）
    // 空/null/纯空白 = 校园树（芝大产权）；有值 = 公共道路树（CDOT、Midway Plaisance 等）
    if (input.ownership) {
      filtered = filtered.filter(f => {
        const v = f.properties.UChicagoIn
        const isEmpty = v == null || String(v).trim() === ''
        return input.ownership === 'campus' ? isEmpty : !isEmpty
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

    // 3. 统计信息（在 sort/topN 切片之前，基于全量过滤结果计算）
    const count = filtered.length
    const speciesCount: Record<string, number> = {}
    const ageCount: Record<string, number> = {}
    const conditionCount: Record<string, number> = {}
    let campusCount = 0
    let rowCount = 0
    const rowByAuthority: Record<string, number> = {}

    // EstValue 聚合（避免让模型自己加 5000+ 行）
    let estValTotal = 0, estValCount = 0, estValMin = Infinity, estValMax = -Infinity
    const estValByCampus = { campus: 0, campusCount: 0, rightOfWay: 0, rowCount: 0 }
    const estValByAuthority: Record<string, { total: number; count: number }> = {}

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

      // 统计归属（UChicagoIn: 空 = 校园树，有值 = 公共道路树）
      const uchicagoIn = feature.properties.UChicagoIn
      const isRow = uchicagoIn != null && String(uchicagoIn).trim() !== ''
      if (isRow) {
        rowCount++
        const authority = String(uchicagoIn).trim()
        rowByAuthority[authority] = (rowByAuthority[authority] || 0) + 1
      } else {
        campusCount++
      }

      // EstValue 聚合
      const ev = feature.properties.EstValue
      if (ev != null && ev !== '') {
        const evNum = typeof ev === 'number' ? ev : parseFloat(String(ev))
        if (!Number.isNaN(evNum)) {
          estValTotal += evNum
          estValCount++
          if (evNum < estValMin) estValMin = evNum
          if (evNum > estValMax) estValMax = evNum
          if (isRow) {
            const authority = String(uchicagoIn).trim()
            if (!estValByAuthority[authority]) estValByAuthority[authority] = { total: 0, count: 0 }
            estValByAuthority[authority].total += evNum
            estValByAuthority[authority].count++
            estValByCampus.rightOfWay += evNum
            estValByCampus.rowCount++
          } else {
            estValByCampus.campus += evNum
            estValByCampus.campusCount++
          }
        }
      }
    }

    // 4a. 排序（在 topN 切片之前）
    if (input.sortBy) {
      const sf = input.sortBy
      filtered = [...filtered].sort((a, b) => {
        const av = a.properties[sf]
        const bv = b.properties[sf]
        const an = typeof av === 'number' ? av : parseFloat(String(av ?? ''))
        const bn = typeof bv === 'number' ? bv : parseFloat(String(bv ?? ''))
        if (Number.isNaN(an) && Number.isNaN(bn)) return 0
        if (Number.isNaN(an)) return 1
        if (Number.isNaN(bn)) return -1
        return (input.sortOrder ?? 'desc') === 'asc' ? an - bn : bn - an
      })
    }
    // 4b. topN 切片（只影响地图要素，统计已基于全量计算）
    const mapSlice = input.topN ? filtered.slice(0, input.topN) : filtered

    // 4. 生成摘要
    const topSpecies = Object.entries(speciesCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ species: name, count }))

    const ownershipBreakdown = {
      campus: campusCount,
      rightOfWay: rowCount,
      byAuthority: Object.entries(rowByAuthority)
        .sort((a, b) => b[1] - a[1])
        .reduce<Record<string, number>>((acc, [k, v]) => { acc[k] = v; return acc }, {}),
      note: 'campus = University-owned land (UChicagoIn empty/null); right-of-way = public land managed by named authority',
    }

    // 5. 返回结果
    // 树是点要素，可以全量上图（上限 6000 防御异常数据）——但要把 55 个
    // CAD 字段瘦身成展示所需的 5 个，否则 5000+ 棵的属性就有数 MB。
    // 模型只读统计摘要（_modelSummary），不接收逐棵几何。
    const estValueAggregate = estValCount > 0
      ? {
          total: Math.round(estValTotal),
          mean: Math.round(estValTotal / estValCount),
          min: estValMin === Infinity ? 0 : Math.round(estValMin),
          max: estValMax === -Infinity ? 0 : Math.round(estValMax),
          treesWithValue: estValCount,
          campus: {
            total: Math.round(estValByCampus.campus),
            mean: estValByCampus.campusCount > 0 ? Math.round(estValByCampus.campus / estValByCampus.campusCount) : 0,
            count: estValByCampus.campusCount,
          },
          rightOfWay: {
            total: Math.round(estValByCampus.rightOfWay),
            mean: estValByCampus.rowCount > 0 ? Math.round(estValByCampus.rightOfWay / estValByCampus.rowCount) : 0,
            count: estValByCampus.rowCount,
          },
          byAuthority: Object.entries(estValByAuthority)
            .sort((a, b) => b[1].total - a[1].total)
            .reduce<Record<string, { total: number; mean: number; count: number }>>(
              (acc, [k, v]) => {
                acc[k] = { total: Math.round(v.total), mean: Math.round(v.total / v.count), count: v.count }
                return acc
              }, {}
            ),
          note: 'EstValue = appraised replacement value in USD (i-Tree/CTLA methodology)',
        }
      : null

    const summary = {
      totalCount: count,
      topSpecies,
      ageBreakdown: ageCount,
      conditionBreakdown: conditionCount,
      ownershipBreakdown,
      estValueAggregate,
      queryFilters: input,
    }

    // mapFeatures: use sorted/topN slice (max 6000 for point layers)
    const mapFeatures = mapSlice.slice(0, 6000).map(f => ({
      type: 'Feature' as const,
      geometry: f.geometry,
      properties: {
        TreeID: f.properties.TreeID ?? f.properties.OBJECTID,
        OBJECTID: f.properties.OBJECTID,
        CommonName: firstString(f, ['CommonName', 'Common_Nam']),
        ScientName: f.properties.ScientName ?? null,
        Condition: firstString(f, ['Condition', 'conditionC']),
        AgeClass: firstString(f, ['AgeClass', 'ageClass']),
        CanRadius: f.properties.CanRadius ?? null,
        DBH1: f.properties.DBH1 ?? null,
        EstValue: f.properties.EstValue != null && f.properties.EstValue !== ''
          ? parseFloat(String(f.properties.EstValue))
          : null,
        UChicagoIn: f.properties.UChicagoIn ?? null,
        LastUpda: f.properties.LastUpda ?? null,
        TreeNotes: firstString(f, ['TreeNotes']),
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
        fieldDictionary: {
          TreeID: 'Unique tree identifier',
          CommonName: 'Common name (e.g., "Elm", "Oak")',
          ScientName: 'Scientific name (e.g., "Ulmus americana")',
          Genus: 'Genus',
          Species: 'Species epithet',
          ITreeCode: 'i-Tree species code (4-letter)',
          AgeClass: 'Age class: Young / Semi-mature / Mature',
          Condition: 'Tree health: Good / Fair / Poor / Dead',
          HTClass: 'Height class: Short / Medium / Tall',
          CanRadius: 'Canopy radius in feet',
          DBH1: 'Diameter at breast height, primary stem (inches)',
          'DBH2-6': 'Additional stem diameters for multi-stem trees (inches)',
          EstValue: 'Appraised replacement value in USD (i-Tree/CTLA methodology). Sum for totals; sort descending for "most valuable".',
          UChicagoIn: 'Ownership: empty/blank = University-owned campus tree; non-empty = right-of-way tree, value is the managing authority (CDOT, Midway Plaisance, Medical Campus, etc.)',
          UChicagoCa: 'Ownership category label (secondary flag, prefer UChicagoIn)',
          LocType: 'Physical planting context: Open / Sidewalk / Planter / etc.',
          LocValue: 'Location quality value: Good / Fair / Poor',
          OverheadLi: 'Overhead lines present: Yes / No',
          RootInfrin: 'Root intrusion percentage: <25% / 25-50% / etc.',
          Desirabili: 'Desirability score (0–1 scale)',
          Stems: 'Number of stems',
          Active: '1 = active record',
          Dateinvent: 'Date inventoried',
          LastUpda: 'Date last updated (MM/DD/YYYY)',
          TreeNotes: 'Free-text notes (planting batches, incidents, etc.)',
          ItreeEco: 'Included in i-Tree Eco analysis: Yes / No',
          Itreecarbo: 'Carbon storage value ($)',
          Itreeinter: 'Annual stormwater interception (gallons/year)',
          Itreegross: 'Total annual ecosystem service value ($)',
        },
        note: 'EstValue IS in the inventory. Features rendered on map; per-tree geometry omitted here. Use estValueAggregate for totals — do not ask users to sum individual rows.',
      }
    }

  } catch (error) {
    // Full detail stays server-side; the caller gets a generic message so
    // S3 keys / ARNs / account ids never reach the client.
    console.error('queryTrees error:', error)
    return { error: 'Tree query failed' }
  }
}
