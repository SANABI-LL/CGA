import { z } from 'zod'
import { queryS3Layer } from './queryS3Layer'
import { pickBuildingProps } from './buildingFields'

export const SpatialQueryInputSchema = z.object({
  targetLayer: z
    .enum(['buildings', 'trees', 'bike_racks', 'benches', 'public_arts', 'green_roof',
           'emergency_phone', 'trash_can', 'seating'])
    .describe('Layer whose features to find within the spatial boundary'),
  withinLayer: z.enum(['subarea'])
    .describe('Polygon layer that defines the spatial boundary'),
  withinValue: z.string().max(20)
    .describe('Identity value in the boundary layer, e.g. "B" for SubArea = "B"'),
  withinField: z.string().max(50).optional()
    .describe('Field to match withinValue against (default: SubArea for subarea layer)'),
  limit: z.number().int().min(1).max(500).optional().default(300),
}).strict()

export type SpatialQueryInput = z.infer<typeof SpatialQueryInputSchema>

// Ray-casting point-in-polygon for geographic coordinates.
// Handles the standard [lng, lat] coordinate order used in GeoJSON.
function pointInRing(px: number, py: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

// Average of exterior ring = good-enough centroid for GIS containment tests.
// Planning practice: use building centroid (not footprint) to assign subareas,
// since building polygons frequently straddle district boundaries.
function polygonCentroid(rings: number[][][]): [number, number] | null {
  const ring = rings[0]
  if (!ring?.length) return null
  return [
    ring.reduce((s, c) => s + c[0], 0) / ring.length,
    ring.reduce((s, c) => s + c[1], 0) / ring.length,
  ]
}

function featureCentroid(geom: { type: string; coordinates: unknown }): [number, number] | null {
  if (geom.type === 'Point') {
    const c = geom.coordinates as number[]
    return [c[0], c[1]]
  }
  if (geom.type === 'Polygon') {
    return polygonCentroid(geom.coordinates as number[][][])
  }
  if (geom.type === 'MultiPolygon') {
    const first = (geom.coordinates as number[][][][])[0]
    return first ? polygonCentroid(first) : null
  }
  if (geom.type === 'LineString') {
    const coords = geom.coordinates as number[][]
    if (!coords.length) return null
    const mid = coords[Math.floor(coords.length / 2)]
    return [mid[0], mid[1]]
  }
  return null
}

/**
 * Spatial containment query: find features in targetLayer whose centroids
 * fall within a polygon from withinLayer.
 *
 * Use for questions like "buildings in Subarea B", "trees within Subarea C",
 * "what's inside the O district". Uses centroid-in-polygon (standard planning
 * practice — stricter 'within' misses buildings on boundaries).
 */
export async function spatialQuery(input: SpatialQueryInput) {
  // 1. Load and filter boundary polygons
  const boundaryResult = await queryS3Layer({
    layerName: input.withinLayer,
    maxResults: 100,
    returnGeometry: true,
  })
  if ('error' in boundaryResult) return boundaryResult

  const identityField = input.withinField ?? (input.withinLayer === 'subarea' ? 'SubArea' : 'OBJECTID')
  const needle = String(input.withinValue).trim().toLowerCase()

  const boundaryFeatures = boundaryResult.features.filter(f => {
    const v = f.properties[identityField]
    return v != null && String(v).trim().toLowerCase() === needle
  })

  if (!boundaryFeatures.length) {
    return {
      error: `No ${input.withinLayer} feature found where ${identityField} = "${input.withinValue}". ` +
        `Available values: ${boundaryResult.features.map(f => f.properties[identityField]).join(', ')}`,
    }
  }

  // Extract polygon ring sets for containment test
  const polygons: number[][][][] = []
  for (const bf of boundaryFeatures) {
    const g = bf.geometry
    if (g.type === 'Polygon') {
      polygons.push(g.coordinates as number[][][])
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as number[][][][]) polygons.push(poly)
    }
  }

  // 2. Load target layer
  const targetResult = await queryS3Layer({
    layerName: input.targetLayer,
    maxResults: 500,
    returnGeometry: true,
  })
  if ('error' in targetResult) return targetResult

  // 3. Centroid-in-polygon test
  const matched = targetResult.features.filter(f => {
    if (!f.geometry) return false
    const centroid = featureCentroid(f.geometry)
    if (!centroid) return false
    const [cx, cy] = centroid
    return polygons.some(polyRings => pointInRing(cx, cy, polyRings[0]))
  })

  const trimmed = matched.slice(0, input.limit ?? 300)

  // Apply field allowlist for buildings
  const features = trimmed.map(f => {
    if (input.targetLayer === 'buildings') {
      return { ...f, properties: pickBuildingProps(f.properties) }
    }
    return f
  })

  // Compact summary for model (avoids bulk geometry in reasoning context)
  const _modelSummary = input.targetLayer === 'buildings'
    ? {
        count: features.length,
        totalMatched: matched.length,
        within: `${input.withinLayer} ${identityField}=${input.withinValue}`,
        buildings: features.slice(0, 80).map(f => ({
          name: f.properties.DISCRIPT1,
          code: f.properties.BD_ID,
          year: f.properties.Year_Completed,
          chrs: f.properties.CHRS,
          fci: f.properties.FCI ?? f.properties.FCI_23,
        })),
        ...(matched.length > trimmed.length
          ? { note: `${matched.length - trimmed.length} additional features not shown (limit ${input.limit ?? 300})` }
          : {}),
      }
    : {
        count: features.length,
        totalMatched: matched.length,
        layer: input.targetLayer,
        within: `${input.withinLayer} ${identityField}=${input.withinValue}`,
        ...(matched.length > trimmed.length
          ? { note: `${matched.length - trimmed.length} additional features not shown` }
          : {}),
      }

  return {
    type: 'FeatureCollection' as const,
    features,
    count: features.length,
    totalMatched: matched.length,
    _modelSummary,
    source: 's3',
  }
}
