export const ARCGIS_BASE = 'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services'

export const CAMPUS_BOUNDS = {
  minLng: -87.6080,
  maxLng: -87.5930,
  minLat:  41.7820,
  maxLat:  41.7970,
}

export function lngLatToPercent(lng: number, lat: number): { x: number; y: number } {
  const x = (lng - CAMPUS_BOUNDS.minLng) / (CAMPUS_BOUNDS.maxLng - CAMPUS_BOUNDS.minLng) * 100
  const y = (1 - (lat - CAMPUS_BOUNDS.minLat) / (CAMPUS_BOUNDS.maxLat - CAMPUS_BOUNDS.minLat)) * 100
  return { x, y }
}

export function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function polygonCentroid(coords: number[][][]): [number, number] {
  const ring = Array.isArray(coords[0][0]) ? (coords[0] as number[][]) : (coords as unknown as number[][])
  let sx = 0, sy = 0
  ring.forEach(([x, y]) => { sx += x; sy += y })
  return [sx / ring.length, sy / ring.length]
}
