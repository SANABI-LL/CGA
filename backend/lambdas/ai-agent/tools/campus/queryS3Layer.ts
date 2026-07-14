import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'us-east-1',
  forcePathStyle: false
})

import { getBucket } from './config'

/**
 * S3 上的图层映射（已迁移）
 * 未迁移的图层（bike_racks, electrical, parking）仍使用 queryArcGIS
 */
const S3_LAYER_FILES: Record<string, string> = {
  buildings: 'layers/buildings.geojson',
  dining: 'layers/Cafe__Market__Restaurant_and_Dining_Hall.geojson',
  accessible: 'layers/all-gender-restrooms.geojson',
  leed_buildings: 'layers/leed-buildings.geojson',
  trees: 'layers/trees.geojson',
}

// Internal helper schema (not exposed as a model tool) — outFields stays for
// in-process callers, but inputs are still clamped defensively.
export const QueryS3LayerInputSchema = z.object({
  layerName: z.enum(['buildings', 'dining', 'accessible', 'leed_buildings', 'trees']),
  whereClause: z.string().max(500).optional().describe('SQL-like WHERE clause (e.g., "BLDG_NAME LIKE \'%Library%\'")'),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
  returnGeometry: z.boolean().optional().default(true),
  outFields: z.array(z.string()).optional().describe('Fields to return (default: all)'),
}).strict()

export type QueryS3LayerInput = z.infer<typeof QueryS3LayerInputSchema>

export interface GeoJSONFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: {
    type: string
    coordinates: unknown
  }
}

export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection'
  features: GeoJSONFeature[]
}

/**
 * 从 S3 读取 GeoJSON 并应用过滤
 *
 * 用途：
 * - 替代 ArcGIS REST API 查询
 * - 支持简单的属性过滤（WHERE 子句）
 * - 支持字段选择（outFields）
 */
export async function queryS3Layer(input: QueryS3LayerInput) {
  const s3Key = S3_LAYER_FILES[input.layerName]
  if (!s3Key) {
    return { error: `Layer ${input.layerName} not available in S3` }
  }

  try {
    // 1. 从 S3 读取 GeoJSON
    const response = await s3.send(new GetObjectCommand({
      Bucket: getBucket(),
      Key: s3Key
    }))

    if (!response.Body) {
      return { error: `Empty response from S3 for ${s3Key}` }
    }

    const bodyString = await response.Body.transformToString()
    const geojson = JSON.parse(bodyString) as GeoJSONFeatureCollection

    // 2. 应用 WHERE 过滤
    let features = geojson.features || []

    if (input.whereClause && input.whereClause !== '1=1') {
      features = filterByWhereClause(features, input.whereClause)
    }

    // 3. 限制结果数量
    if (input.maxResults && features.length > input.maxResults) {
      features = features.slice(0, input.maxResults)
    }

    // 4. 字段选择
    if (input.outFields && input.outFields.length > 0 && !input.outFields.includes('*')) {
      features = features.map(f => ({
        ...f,
        properties: pickFields(f.properties, input.outFields!)
      }))
    }

    // 5. 移除 geometry（如果不需要）
    if (!input.returnGeometry) {
      features = features.map(f => ({
        ...f,
        geometry: { type: 'Point', coordinates: [] } // 保留结构但清空数据
      }))
    }

    return {
      type: 'FeatureCollection' as const,
      features,
      count: features.length,
      layer: input.layerName,
      source: 's3',
    }
  } catch (err) {
    console.error(`queryS3Layer error (${input.layerName}):`, err)
    return { error: `Failed to query layer ${input.layerName}` }
  }
}

/**
 * 简化的 WHERE 子句解析（支持常见模式）
 *
 * 支持的模式：
 * - "FIELD = 'value'"
 * - "FIELD LIKE '%value%'"
 * - "FIELD > 100"
 * - "FIELD IS NOT NULL"
 *
 * 不支持：复杂的 AND/OR、嵌套括号
 */
function filterByWhereClause(features: GeoJSONFeature[], whereClause: string): GeoJSONFeature[] {
  const clause = whereClause.trim()

  // LIKE pattern: FIELD LIKE '%value%'
  const likeMatch = clause.match(/(\w+)\s+LIKE\s+'%(.+?)%'/i)
  if (likeMatch) {
    const [, field, value] = likeMatch
    const lowerValue = value.toLowerCase()
    return features.filter(f => {
      const fieldValue = String(f.properties[field] || '').toLowerCase()
      return fieldValue.includes(lowerValue)
    })
  }

  // Equality: FIELD = 'value'
  const eqMatch = clause.match(/(\w+)\s*=\s*'([^']+)'/i)
  if (eqMatch) {
    const [, field, value] = eqMatch
    return features.filter(f => String(f.properties[field]) === value)
  }

  // Numeric comparison: FIELD > 100
  const numMatch = clause.match(/(\w+)\s*([><=]+)\s*(\d+(\.\d+)?)/i)
  if (numMatch) {
    const [, field, op, value] = numMatch
    const numValue = parseFloat(value)
    return features.filter(f => {
      const fieldValue = parseFloat(String(f.properties[field] || '0'))
      if (op === '>') return fieldValue > numValue
      if (op === '<') return fieldValue < numValue
      if (op === '>=') return fieldValue >= numValue
      if (op === '<=') return fieldValue <= numValue
      if (op === '=') return fieldValue === numValue
      return false
    })
  }

  // IS NOT NULL
  const notNullMatch = clause.match(/(\w+)\s+IS\s+NOT\s+NULL/i)
  if (notNullMatch) {
    const [, field] = notNullMatch
    return features.filter(f => f.properties[field] != null && f.properties[field] !== '')
  }

  // Fallback: return all (treat as '1=1')
  console.warn(`Unsupported WHERE clause: ${clause}, returning all features`)
  return features
}

/**
 * 选择指定字段
 */
function pickFields(properties: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    if (properties[field] !== undefined) {
      result[field] = properties[field]
    }
  }
  return result
}
