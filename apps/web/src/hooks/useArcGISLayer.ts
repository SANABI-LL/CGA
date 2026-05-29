import { useState, useEffect } from 'react'
import { ARCGIS_BASE, lngLatToPercent, polygonCentroid } from '@/utils/coordinates'

export const LIVE_LAYERS = {
  bike_racks: {
    url: `${ARCGIS_BASE}/2022_06_23_Web_Map_WFL1/FeatureServer/395/query?where=1%3D1&outFields=*&f=geojson&outSR=4326`,
    type: 'point' as const,
    color: '#2E7D52',
    label: 'Bike Rack',
  },
  buildings: {
    url: `${ARCGIS_BASE}/UoC_Properties/FeatureServer/2509/query?where=1%3D1&outFields=DISCRIPT1,Lat,Lon,BLDG_NUM,BLDG_USE,GIS_AREA&f=geojson&outSR=4326&resultRecordCount=300`,
    type: 'polygon' as const,
    color: '#8B6F47',
    label: 'Building',
  },
} as const

export type LayerKey = keyof typeof LIVE_LAYERS

export interface PointFeature {
  id: number | string
  attrs: Record<string, unknown>
  lng: number
  lat: number
  x: number
  y: number
}

export interface PolygonFeature {
  id: number | string
  attrs: Record<string, unknown>
  lng: number
  lat: number
  x: number
  y: number
  svgPts: string
}

type AnyFeature = PointFeature | PolygonFeature

export function useLiveLayer(key: LayerKey, active: boolean) {
  const [features, setFeatures] = useState<AnyFeature[]>([])
  const [raw, setRaw] = useState<unknown[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')

  useEffect(() => {
    if (!active) { setFeatures([]); setRaw([]); setStatus('idle'); return }
    setStatus('loading')

    fetch(LIVE_LAYERS[key].url)
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((gj: { features?: { geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[] }) => {
        const layer = LIVE_LAYERS[key]
        const feats = (gj.features ?? []).filter(f => f.geometry)
        setRaw(feats)

        if (layer.type === 'point') {
          setFeatures(feats.map(f => {
            const coords = f.geometry.coordinates as [number, number]
            return {
              id: (f.properties?.OBJECTID as number) ?? Math.random(),
              attrs: f.properties ?? {},
              lng: coords[0],
              lat: coords[1],
              ...lngLatToPercent(coords[0], coords[1]),
            }
          }))
        } else {
          setFeatures(
            feats.map(f => {
              const rawCoords = f.geometry.coordinates as unknown[]
              const isMulti = f.geometry.type === 'MultiPolygon'
              const props = f.properties ?? {}
              const attrLat = parseFloat(String(props.Lat ?? props.LAT ?? 0))
              const attrLng = parseFloat(String(props.Lon ?? props.LON ?? 0))
              let lng: number, lat: number
              const polyCoords = (isMulti ? rawCoords as unknown[][] : [rawCoords]) as unknown[][][]
              const centroidInput = polyCoords.map(r => r[0]) as unknown as number[][][]
              if (attrLat && attrLng) { lng = attrLng; lat = attrLat }
              else { [lng, lat] = polygonCentroid(centroidInput) }

              const outerRing: number[][] = isMulti
                ? (rawCoords[0] as number[][][])[0]
                : (rawCoords[0] as number[][])
              const svgPts = outerRing.map(([x, y]) => {
                const p = lngLatToPercent(x, y)
                return `${p.x},${p.y}`
              }).join(' ')

              return {
                id: (props.OBJECTID as number) ?? Math.random(),
                attrs: props,
                lng, lat, svgPts,
                ...lngLatToPercent(lng, lat),
              }
            }).filter(f => (f as PolygonFeature).svgPts)
          )
        }
        setStatus('ok')
      })
      .catch(() => setStatus('error'))
  }, [key, active])

  return { features, raw, status }
}
