import { useEffect, useRef } from 'react'
import { useMapStore } from '@/stores/mapStore'
import { CAMPUS_CENTER } from '@campusgeo/shared-types'

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<unknown>(null)
  const highlightRef = useRef<unknown>(null)

  const { layerGroups, mapFocus, highlightedFeatures, setMapReady } = useMapStore()

  useEffect(() => {
    if (!containerRef.current) return

    let cancelled = false

    // Dynamically import ArcGIS to avoid bundling issues
    Promise.all([
      import('@arcgis/core/Map'),
      import('@arcgis/core/views/MapView'),
      import('@arcgis/core/layers/FeatureLayer'),
      import('@arcgis/core/layers/GeoJSONLayer'),
      import('@arcgis/core/config'),
    ]).then(([MapModule, ViewModule, , , ConfigModule]) => {
      if (cancelled || !containerRef.current) return

      // Point assets to ArcGIS CDN
      ConfigModule.default.assetsPath = 'https://js.arcgis.com/4.32/@arcgis/core/assets'

      const map = new MapModule.default({
        basemap: 'dark-gray-vector',
      })

      const view = new ViewModule.default({
        container: containerRef.current,
        map,
        center: [CAMPUS_CENTER.lng, CAMPUS_CENTER.lat],
        zoom: 16,
        constraints: {
          minZoom: 14,
          maxZoom: 20,
        },
        ui: {
          components: ['zoom', 'compass'],
        },
        popup: {
          dockEnabled: false,
          dockOptions: { buttonEnabled: false },
        },
      })

      viewRef.current = view

      view.when(() => {
        if (!cancelled) setMapReady(true)
      })
    })

    return () => {
      cancelled = true
      if (viewRef.current) {
        const v = viewRef.current as { destroy: () => void }
        v.destroy()
        viewRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to map focus changes (e.g. when AI agent returns a location)
  useEffect(() => {
    if (!viewRef.current || !mapFocus) return
    const view = viewRef.current as { goTo: (target: unknown) => Promise<void> }
    view.goTo({ center: [mapFocus.center.lng, mapFocus.center.lat], zoom: mapFocus.zoom ?? 17 })
  }, [mapFocus])

  // React to highlighted features from AI results
  useEffect(() => {
    if (!viewRef.current) return

    const view = viewRef.current as {
      map: { remove: (l: unknown) => void; add: (l: unknown) => void }
    }

    // Remove previous highlight layer
    if (highlightRef.current) {
      view.map.remove(highlightRef.current)
      highlightRef.current = null
    }

    if (!highlightedFeatures || highlightedFeatures.features.length === 0) return

    import('@arcgis/core/layers/GeoJSONLayer').then(({ default: GeoJSONLayer }) => {
      const blob = new Blob([JSON.stringify(highlightedFeatures)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)

      const highlightLayer = new GeoJSONLayer({
        url,
        renderer: {
          type: 'simple',
          symbol: {
            type: 'simple-marker',
            color: [196, 144, 58, 0.9],
            outline: { color: [255, 255, 255, 0.8], width: 1.5 },
            size: 10,
          },
        } as unknown as __esri.Renderer,
      })

      highlightRef.current = highlightLayer
      view.map.add(highlightLayer)
    })
  }, [highlightedFeatures])

  // React to layer group visibility changes
  useEffect(() => {
    if (!viewRef.current) return
    // Layer visibility is handled by individual FeatureLayer references
    // This is a simplified approach; full layer management would use layer IDs
  }, [layerGroups])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--map-dark, #1A1714)',
      }}
    />
  )
}
