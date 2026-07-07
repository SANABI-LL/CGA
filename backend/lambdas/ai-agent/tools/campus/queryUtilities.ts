import { z } from 'zod'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { resolveLocation, haversineMeters } from './findCampusNearby'

const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1'
const BUCKET = process.env.GEOJSON_BUCKET || 'campusgeo-geodata-491117467175'

const s3 = new S3Client({ region: AWS_REGION })

/**
 * Campus underground-utility layers (from "Utility Information.gdb",
 * uploaded by ingest via convert_gdb.py + upload_utilities.py).
 * S3 keys are layers/utility_<layer>.geojson — the utility_ prefix keeps them
 * from colliding with the general campus layers (e.g. electrical).
 *
 * NOTE: source attributes are CAD export metadata (Layer/Color/Linetype…)
 * with no engineering attributes yet (depth, diameter, install year are
 * planned additions). Query value is therefore spatial: near a location,
 * by utility system. Attribute filtering is intentionally not offered.
 */
const UTILITY_SYSTEMS: Record<string, { layers: string[]; label: string }> = {
  steam: {
    label: 'Steam distribution (lines, condensate, vaults, LP/MP piping)',
    layers: [
      'utility_t2021_steam_line',
      'utility_t2021_steam_line_condensate',
      'utility_steam_vault',
      'utility_low_pressure_piping',
      'utility_medium_pressure_piping',
    ],
  },
  chilled_water: {
    label: 'Chilled water supply/return',
    layers: [
      'utility_chilled_water_supply',
      'utility_chilled_water_receive',
      'utility_nesb_chilled_water_supply',
      'utility_nesb_chilled_water_return',
    ],
  },
  domestic_water: { label: 'Domestic water', layers: ['utility_domestic_water'] },
  sewer: {
    label: 'Sewers (city combined + university owned)',
    layers: ['utility_city_owned_combined_sewer', 'utility_university_owned_sewer'],
  },
  stormwater: {
    label: 'Stormwater management (detention, bioswales, retention sites)',
    layers: [
      'utility_underground_stormwater_detention',
      'utility_bioswale_area',
      'utility_site_construction_with_stormwater_retention',
    ],
  },
  electrical: {
    label: 'Electrical (lines, ComEd vault feeders, conduit infrastructure)',
    layers: [
      'utility_electrical_line',
      'utility_comed_vault_feeder',
      'utility_uchicago_conduit_infrastructure',
    ],
  },
  compressed_air: {
    label: 'Compressed air (T80/T50)',
    layers: ['utility_t80_compressed_air', 'utility_t50_compressed_air'],
  },
  tunnel: { label: 'Walkable utility tunnels', layers: ['utility_new_walkable_tunnel'] },
  valves: { label: 'Valves', layers: ['utility_valves'] },
}

export const QueryUtilitiesInputSchema = z.object({
  utilityType: z.enum([
    'steam',
    'chilled_water',
    'domestic_water',
    'sewer',
    'stormwater',
    'electrical',
    'compressed_air',
    'tunnel',
    'valves',
  ]),
  nearLocation: z
    .string()
    .optional()
    .describe('Named campus location or "lat,lng" — limits results to a radius around it'),
  radiusMeters: z.number().optional().default(150),
  maxResults: z.number().max(500).optional().default(300),
})

export type QueryUtilitiesInput = z.infer<typeof QueryUtilitiesInputSchema>

interface UtilityFeature {
  type: 'Feature'
  properties: Record<string, unknown>
  geometry: { type: string; coordinates: unknown } | null
}

// Layer GeoJSON cached per Lambda instance — same lifecycle as queryS3Layer.
const layerCache = new Map<string, Promise<UtilityFeature[]>>()

function loadLayer(name: string): Promise<UtilityFeature[]> {
  let cached = layerCache.get(name)
  if (!cached) {
    cached = (async () => {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: BUCKET, Key: `layers/${name}.geojson` })
      )
      if (!response.Body) throw new Error(`Empty S3 response for ${name}`)
      const parsed = JSON.parse(await response.Body.transformToString()) as {
        features: UtilityFeature[]
      }
      return parsed.features ?? []
    })().catch((err) => {
      layerCache.delete(name) // allow retry on next invocation
      throw err
    })
    layerCache.set(name, cached)
  }
  return cached
}

// Walk nested coordinate arrays, yielding [lng, lat] pairs (Z ignored).
function forEachVertex(coords: unknown, fn: (lng: number, lat: number) => void): void {
  if (!Array.isArray(coords)) return
  if (typeof coords[0] === 'number') {
    fn(coords[0] as number, coords[1] as number)
    return
  }
  for (const child of coords) forEachVertex(child, fn)
}

function minDistanceMeters(f: UtilityFeature, lat: number, lng: number): number {
  let min = Infinity
  if (f.geometry) {
    forEachVertex(f.geometry.coordinates, (vLng, vLat) => {
      const d = haversineMeters(lat, lng, vLat, vLng)
      if (d < min) min = d
    })
  }
  return min
}

// Drop Z values and round to 6 decimals (~0.1 m) to slim the map payload.
function slimCoordinates(coords: unknown): unknown {
  if (!Array.isArray(coords)) return coords
  if (typeof coords[0] === 'number') {
    return [
      Math.round((coords[0] as number) * 1e6) / 1e6,
      Math.round((coords[1] as number) * 1e6) / 1e6,
    ]
  }
  return coords.map(slimCoordinates)
}

/**
 * Spatial query over campus underground utilities. Attribute data is CAD
 * metadata only, so this tool answers "what is where": by system, optionally
 * within a radius of a named location.
 */
export async function queryUtilities(input: QueryUtilitiesInput) {
  const system = UTILITY_SYSTEMS[input.utilityType]

  let center: { lat: number; lng: number; displayName: string } | null = null
  if (input.nearLocation) {
    center = resolveLocation(input.nearLocation)
    if (!center) {
      return { error: `Unknown location "${input.nearLocation}". Try a campus building name or "lat,lng".` }
    }
  }

  try {
    const perLayer = await Promise.all(
      system.layers.map(async (name) => ({ name, features: await loadLayer(name) }))
    )

    const countByLayer: Record<string, number> = {}
    let selected: Array<{ layer: string; feature: UtilityFeature; distance?: number }> = []

    for (const { name, features } of perLayer) {
      let kept: Array<{ layer: string; feature: UtilityFeature; distance?: number }>
      if (center) {
        kept = features
          .map((feature) => ({
            layer: name,
            feature,
            distance: minDistanceMeters(feature, center.lat, center.lng),
          }))
          .filter((x) => x.distance! <= input.radiusMeters)
      } else {
        kept = features.map((feature) => ({ layer: name, feature }))
      }
      countByLayer[name] = kept.length
      selected = selected.concat(kept)
    }

    const totalMatched = selected.length
    if (center) selected.sort((a, b) => a.distance! - b.distance!)
    selected = selected.slice(0, input.maxResults)

    const outFeatures = selected.map(({ layer, feature, distance }) => ({
      type: 'Feature' as const,
      properties: {
        // utilitySystem drives per-system colors and the legend on the frontend
        utilitySystem: input.utilityType,
        utilityLayer: layer.replace(/^utility_/, ''),
        source: typeof feature.properties?.Layer === 'string' ? feature.properties.Layer : undefined,
        ...(distance !== undefined ? { distanceMeters: Math.round(distance) } : {}),
      },
      geometry: feature.geometry
        ? { ...feature.geometry, coordinates: slimCoordinates(feature.geometry.coordinates) }
        : null,
    }))

    const summary = {
      utilityType: input.utilityType,
      systemLabel: system.label,
      referenceLocation: center?.displayName,
      radiusMeters: center ? input.radiusMeters : undefined,
      totalMatched,
      returned: outFeatures.length,
      countByLayer,
      nearestDistanceMeters: center && selected.length ? Math.round(selected[0].distance!) : undefined,
      attributeNote:
        'Source attributes are CAD metadata only — depth, diameter and material are not yet available.',
    }

    return {
      ...summary,
      count: outFeatures.length,
      center: center ? { lat: center.lat, lng: center.lng } : undefined,
      features: { type: 'FeatureCollection' as const, features: outFeatures },
      // Geometry-heavy features go to the map via the SSE mapUpdate; the model
      // reasons over this compact summary instead (see executeTool in agent.ts).
      _modelSummary: { ...summary, featuresShownOnMap: outFeatures.length },
    }
  } catch (err) {
    return {
      error: `Utility query failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
