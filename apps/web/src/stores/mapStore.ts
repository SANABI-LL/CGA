import { create } from 'zustand'
import type { FeatureCollection, LayerGroup, LatLng } from '@campusgeo/shared-types'

interface MapFocus {
  center: LatLng
  zoom?: number
}

interface MapState {
  layerGroups: LayerGroup[]
  selectedFeatureId: string | null
  mapFocus: MapFocus | null
  highlightedFeatures: FeatureCollection | null
  highlightIds: string[]
  isMapReady: boolean

  toggleLayerVisibility: (layerId: string) => void
  toggleGroupExpanded: (groupId: string) => void
  setSelectedFeature: (id: string | null) => void
  setMapFocus: (focus: MapFocus | null) => void
  setHighlightedFeatures: (fc: FeatureCollection | null) => void
  setHighlightIds: (ids: string[]) => void
  setMapReady: (ready: boolean) => void
}

export const useMapStore = create<MapState>((set) => ({
  layerGroups: [
    {
      id: 'campus',
      name: 'Campus',
      icon: 'building',
      expanded: true,
      layers: [
        {
          id: 'buildings',
          name: 'Buildings',
          groupId: 'campus',
          type: 'polygon',
          arcgisUrl:
            'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services/UoC_Properties/FeatureServer/2509',
          color: '#800000',
          visible: true,
        },
      ],
    },
    {
      id: 'transportation',
      name: 'Transportation',
      icon: 'bicycle',
      expanded: true,
      layers: [
        {
          id: 'bike_racks',
          name: 'Bike Racks',
          groupId: 'transportation',
          type: 'point',
          arcgisUrl:
            'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services/2022_06_23_Web_Map_WFL1/FeatureServer/395',
          color: '#3A9970',
          visible: true,
        },
      ],
    },
    {
      id: 'utilities',
      name: 'Utilities',
      icon: 'zap',
      expanded: false,
      layers: [
        {
          id: 'electrical',
          name: 'Electrical Lines',
          groupId: 'utilities',
          type: 'line',
          arcgisUrl:
            'https://services.arcgis.com/ppFhFO7kjyIF441C/arcgis/rest/services/2022_06_23_Web_Map_WFL1/FeatureServer/0',
          color: '#C4903A',
          visible: false,
        },
      ],
    },
  ],
  selectedFeatureId: null,
  mapFocus: null,
  highlightedFeatures: null,
  highlightIds: [],
  isMapReady: false,

  toggleLayerVisibility: (layerId) =>
    set((state) => ({
      layerGroups: state.layerGroups.map((group) => ({
        ...group,
        layers: group.layers.map((layer) =>
          layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
        ),
      })),
    })),

  toggleGroupExpanded: (groupId) =>
    set((state) => ({
      layerGroups: state.layerGroups.map((group) =>
        group.id === groupId ? { ...group, expanded: !group.expanded } : group
      ),
    })),

  setSelectedFeature: (id) => set({ selectedFeatureId: id }),
  setMapFocus: (focus) => set({ mapFocus: focus }),
  setHighlightedFeatures: (fc) => set({ highlightedFeatures: fc }),
  setHighlightIds: (ids) => set({ highlightIds: ids }),
  setMapReady: (ready) => set({ isMapReady: ready }),
}))
