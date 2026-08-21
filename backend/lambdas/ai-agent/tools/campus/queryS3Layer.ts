import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'

const s3 = new S3Client({
  region: 'us-east-1',
  forcePathStyle: false
})

import { getBucket } from './config'

const S3_LAYER_FILES: Record<string, string> = {
  // Core layers
  buildings: 'layers/buildings.geojson',
  dining: 'layers/Cafe__Market__Restaurant_and_Dining_Hall.geojson',
  accessible: 'layers/all-gender-restrooms.geojson',
  leed_buildings: 'layers/leed-buildings.geojson',
  trees: 'layers/trees.geojson',
  parking: 'layers/parking.geojson',
  bike_racks: 'layers/bike_racks.geojson',
  // Campus amenities & furniture
  emergency_phone: 'layers/emergency_phone.geojson',
  trash_can: 'layers/trash_can.geojson',
  benches: 'layers/benches.geojson',
  seating: 'layers/seating.geojson',
  public_arts: 'layers/public_arts.geojson',
  green_roof: 'layers/green_roof.geojson',
  // Accessibility
  ada_route: 'layers/ada_route.geojson',
  accessible_entrance: 'layers/accessible_public_entrance.geojson',
  controlled_entrance: 'layers/accessible_controlled_access_entrance.geojson',
  accessibility_info: 'layers/accessibility_information.geojson',
  inaccessible_entrance: 'layers/inaccessible_main_entrance.geojson',
  inaccessible_building: 'layers/inaccessible_building.geojson',
  // Fire & safety
  hydrant: 'layers/hydrant.geojson',
  fire_escape: 'layers/fire_escape.geojson',
  sprinkler: 'layers/sprinkler.geojson',
  standpipe: 'layers/standpipe.geojson',
  fire_lane: 'layers/fire_lane.geojson',
  post_indicator_valve: 'layers/post_indicator_valve.geojson',
  // Landmarks & heritage
  landmark: 'layers/individual_landmark.geojson',
  nrhp: 'layers/nrhp.geojson',
  nhl: 'layers/nhl.geojson',
  // Parking & transit
  surface_parking: 'layers/surface_parking.geojson',
  metra_station: 'layers/metrastations.geojson',
}

// Internal helper schema (not exposed as a model tool) — outFields stays for
// in-process callers, but inputs are still clamped defensively.
export const QueryS3LayerInputSchema = z.object({
  layerName: z.enum([
    'buildings', 'dining', 'accessible', 'leed_buildings', 'trees', 'bike_racks', 'parking',
    'trash_can', 'benches', 'seating', 'public_arts', 'green_roof', 'emergency_phone',
    'ada_route', 'accessible_entrance', 'controlled_entrance',
    'accessibility_info', 'inaccessible_entrance', 'inaccessible_building',
    'hydrant', 'fire_escape', 'sprinkler', 'standpipe', 'fire_lane', 'post_indicator_valve',
    'landmark', 'nrhp', 'nhl',
    'surface_parking', 'metra_station',
  ]),
  whereClause: z.string().max(500).optional().describe('SQL-like WHERE clause (e.g., "DISCRIPT1 LIKE \'%Library%\'")'),
  maxResults: z.number().int().min(1).max(500).optional().default(100),
  returnGeometry: z.boolean().optional().default(true),
  outFields: z.array(z.string()).optional().describe('Fields to return (default: all)'),
  sortBy: z.string().optional().describe('Property name to sort results by'),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  topN: z.number().int().min(1).max(500).optional().describe('Return only the top N after sorting'),
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
      // Same generic string as the catch below — S3 keys never reach a client.
      console.error(`queryS3Layer: empty S3 response for ${s3Key}`)
      return { error: `Failed to query layer ${input.layerName}` }
    }

    const bodyString = await response.Body.transformToString()
    const geojson = JSON.parse(bodyString) as GeoJSONFeatureCollection

    // 2. 应用 WHERE 过滤
    let features = geojson.features || []

    if (input.whereClause && input.whereClause !== '1=1') {
      const filtered = filterByWhereClause(features, input.whereClause)
      if (filtered === null) {
        return { error: `Unsupported filter: ${input.whereClause}` }
      }
      features = filtered
    }

    // 3. Sort (if requested) then cap — missing values sort to end, never as 0
    if (input.sortBy) {
      const sk = input.sortBy
      features = features
        .map((f) => {
          const v = f.properties[sk]
          const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
          return { f, n: Number.isFinite(n) ? n : null }
        })
        .sort((a, b) => {
          if (a.n === null && b.n === null) return 0
          if (a.n === null) return 1
          if (b.n === null) return -1
          return input.sortOrder === 'asc' ? a.n - b.n : b.n - a.n
        })
        .map((x) => x.f)
    }
    const cap = input.topN ?? input.maxResults
    if (cap && features.length > cap) {
      features = features.slice(0, cap)
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
function filterByWhereClause(features: GeoJSONFeature[], whereClause: string): GeoJSONFeature[] | null {
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
      const raw = f.properties[field]
      if (raw == null || raw === '') return false
      const fieldValue = parseFloat(String(raw))
      if (Number.isNaN(fieldValue)) return false
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

  // Unsupported clause: return null so the caller can surface a structured error
  // to the model instead of silently returning 0 or all features.
  console.warn(`Unsupported WHERE clause: ${clause}`)
  return null
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
