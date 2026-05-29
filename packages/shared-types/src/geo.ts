import { z } from 'zod'

export const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})
export type LatLng = z.infer<typeof LatLngSchema>

export const CampusBoundsSchema = z.object({
  minLng: z.number(),
  maxLng: z.number(),
  minLat: z.number(),
  maxLat: z.number(),
})

export const CAMPUS_BOUNDS = {
  minLng: -87.6080,
  maxLng: -87.5930,
  minLat: 41.7820,
  maxLat: 41.7970,
} as const

export const CAMPUS_CENTER: LatLng = { lat: 41.7886, lng: -87.5987 }

export const GeoPointSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([z.number(), z.number()]),
})

export const GeoLineStringSchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.tuple([z.number(), z.number()])),
})

export const GeoPolygonSchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
})

export const GeometrySchema = z.union([GeoPointSchema, GeoLineStringSchema, GeoPolygonSchema])
export type Geometry = z.infer<typeof GeometrySchema>

export const FeatureSchema = z.object({
  type: z.literal('Feature'),
  id: z.union([z.string(), z.number()]).optional(),
  geometry: GeometrySchema.nullable(),
  properties: z.record(z.unknown()).nullable(),
})
export type Feature = z.infer<typeof FeatureSchema>

export const FeatureCollectionSchema = z.object({
  type: z.literal('FeatureCollection'),
  features: z.array(FeatureSchema),
})
export type FeatureCollection = z.infer<typeof FeatureCollectionSchema>

export type LayerType = 'point' | 'line' | 'polygon'

export interface CampusLayer {
  id: string
  name: string
  groupId: string
  type: LayerType
  arcgisUrl: string
  color: string
  visible: boolean
}

export interface LayerGroup {
  id: string
  name: string
  icon: string
  layers: CampusLayer[]
  expanded: boolean
}

// ArcGIS REST API base
export const ARCGIS_BASE = 'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services'

export const CAMPUS_LAYERS: CampusLayer[] = [
  {
    id: 'bike_racks',
    name: 'Bike Racks',
    groupId: 'transportation',
    type: 'point',
    arcgisUrl: `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/395`,
    color: '#3A9970',
    visible: true,
  },
  {
    id: 'buildings',
    name: 'Buildings',
    groupId: 'campus',
    type: 'polygon',
    arcgisUrl: `${ARCGIS_BASE}/UoC_Properties/FeatureServer/2509`,
    color: '#800000',
    visible: true,
  },
]
