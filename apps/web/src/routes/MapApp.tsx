import { useState, useCallback, useMemo } from 'react'
import { useSearch } from '@tanstack/react-router'
import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'
import { PhoenixLight } from '@/components/shared/PhoenixMark'
import { SearchBar } from '@/components/search/SearchBar'
import { MapCanvas } from '@/components/map/MapCanvas'
import type { MapMarker } from '@/components/map/MapCanvas'
import { AIAnswerPanel } from '@/components/panels/AIAnswerPanel'
import { LayersPanel } from '@/components/panels/LayersPanel'
import type { LayerGroup } from '@/components/panels/LayersPanel'
import { QueryHistoryPanel } from '@/components/panels/QueryHistoryPanel'
import type { QueryHistoryItem } from '@/components/panels/QueryHistoryPanel'
import { useLiveLayer } from '@/hooks/useArcGISLayer'
import type { PointFeature, PolygonFeature } from '@/hooks/useArcGISLayer'
import { lngLatToPercent, haversine } from '@/utils/coordinates'
import { useQueryStore } from '@/stores/queryStore'
import { streamAgentQuery } from '@/api/agent'

/* ── Static campus data ───────────────────────────────────────── */
const LAYER_GROUPS: LayerGroup[] = [
  { id: 'campus', label: 'Campus Buildings', icon: 'building', open: true, layers: [
    { id: 'buildings_all',      label: 'All Buildings',       color: T.inkMd, on: true,  count: 220, opacity: 70 },
    { id: 'buildings_academic', label: 'Academic Buildings',  color: T.blue,  on: true,  count: 48,  opacity: 100 },
    { id: 'buildings_res',      label: 'Residential Halls',   color: T.amber, on: false, count: 26,  opacity: 100 },
    { id: 'buildings_athletic', label: 'Athletics Facilities', color: T.green, on: false, count: 12,  opacity: 100 },
  ]},
  { id: 'dining', label: 'Dining & Retail', icon: 'coffee', open: true, layers: [
    { id: 'dining_halls', label: 'Dining Halls',   color: T.maroon, on: true,  count: 8,  opacity: 100 },
    { id: 'cafes',        label: 'Cafés & Coffee', color: T.amber,  on: true,  count: 14, opacity: 100 },
    { id: 'retail',       label: 'Campus Retail',  color: T.purple, on: false, count: 22, opacity: 100 },
    { id: 'vending',      label: 'Vending Machines',color: T.inkLt, on: false, count: 65, opacity: 60 },
  ]},
  { id: 'academic', label: 'Academic Resources', icon: 'book', open: false, layers: [
    { id: 'libraries',   label: 'Libraries',    color: T.blue,   on: true,  count: 11,  opacity: 100 },
    { id: 'study_rooms', label: 'Study Rooms',  color: '#4080C0',on: false, count: 34,  opacity: 100 },
    { id: 'classrooms',  label: 'Classrooms',   color: '#408070',on: false, count: 180, opacity: 70 },
    { id: 'labs',        label: 'Research Labs', color: T.purple, on: false, count: 42,  opacity: 100 },
  ]},
  { id: 'transport', label: 'Transportation', icon: 'route', open: false, layers: [
    { id: 'parking_lots',     label: 'Parking Lots',        color: T.yellow,   on: false, count: 18, opacity: 80 },
    { id: 'parking_garages',  label: 'Parking Garages',     color: '#806020',  on: false, count: 4,  opacity: 100 },
    { id: 'bike_racks',       label: 'Bike Racks',          color: T.green,    on: false, count: 88, opacity: 100 },
    { id: 'shuttle_stops',    label: 'Shuttle Stops',       color: '#C06040',  on: false, count: 22, opacity: 100 },
    { id: 'cta_stops',        label: 'CTA Bus/Train',       color: T.blue,     on: false, count: 15, opacity: 100 },
    { id: 'accessible_paths', label: 'Accessible Pathways', color: T.purple,   on: false, count: 1,  opacity: 80 },
  ]},
  { id: 'health', label: 'Health & Wellness', icon: 'heart', open: false, layers: [
    { id: 'health_services', label: 'Health Services', color: T.red,   on: false, count: 6,  opacity: 100 },
    { id: 'aed',             label: 'AED Locations',   color: T.red,   on: false, count: 42, opacity: 100 },
    { id: 'wellness',        label: 'Wellness Centers', color: T.green, on: false, count: 8,  opacity: 100 },
  ]},
  { id: 'infra', label: 'Infrastructure', icon: 'zap', open: false, layers: [
    { id: 'entrances',            label: 'Building Entrances',   color: T.inkLt,  on: false, count: 340, opacity: 70 },
    { id: 'accessible_entrances', label: 'Accessible Entrances', color: T.purple, on: false, count: 88,  opacity: 100 },
    { id: 'ev_charging',          label: 'EV Charging',          color: T.green,  on: false, count: 20,  opacity: 100 },
    { id: 'emergency_phones',     label: 'Emergency Phones',     color: T.red,    on: false, count: 28,  opacity: 100 },
  ]},
]

const MAP_MARKERS: MapMarker[] = [
  { id: 'reg',   x: 56, y: 33, color: T.blue,   icon: 'book',    label: 'Regenstein Library' },
  { id: 'hutch', x: 42, y: 51, color: T.maroon, icon: 'coffee',  label: 'Hutchinson Commons' },
  { id: 'crerar',x: 37, y: 45, color: T.blue,   icon: 'book',    label: 'Crerar Library' },
  { id: 'm4',    x: 62, y: 49, color: T.amber,  icon: 'coffee',  label: 'Bartlett Dining' },
  { id: 'm5',    x: 49, y: 61, color: T.amber,  icon: 'coffee',  label: 'Cathey Dining' },
  { id: 'm6',    x: 30, y: 55, color: T.purple, icon: 'route',   label: 'Shuttle Stop' },
  { id: 'm7',    x: 66, y: 41, color: T.maroon, icon: 'building',label: 'Harper Memorial' },
  { id: 'm8',    x: 44, y: 38, color: T.green,  icon: 'building',label: 'Pick Hall' },
]

/* ── Helpers ──────────────────────────────────────────────────── */
function toHistoryItems(records: { queryId: string; queryText: string; featureIds: string[]; timestamp: number }[]): QueryHistoryItem[] {
  return records.map((r, i) => ({
    id: r.queryId,
    q: r.queryText,
    time: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    count: r.featureIds.length || 0,
  }))
}

/* ── MapApp ───────────────────────────────────────────────────── */
export function MapApp() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const search = useSearch({ from: '/map' as any }) as { q?: string }

  // UI state
  const [query, setQuery] = useState(search.q ?? '')
  const [layers, setLayers] = useState<LayerGroup[]>(LAYER_GROUPS)
  const [layerSearch, setLayerSearch] = useState('')
  const [leftPanel, setLeftPanel] = useState<'layers' | 'query' | null>('layers')
  const [rightPanel, setRightPanel] = useState<string | null>(null)
  const [selectedMarker, setSelectedMarker] = useState<MapMarker | null>(null)
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null)
  const [highlightIds, setHighlightIds] = useState<(string | number)[]>([])
  const [selectedBikeId, setSelectedBikeId] = useState<string | number | null>(null)
  const [mapFocus, setMapFocus] = useState<{ x: number; y: number; ts: number } | null>(null)
  const [queryTimestamp, setQueryTimestamp] = useState('')

  // AI state from store
  const { isLoading, aiAnswer, queryHistory, startQuery, appendAIText, addToolCall, completeToolCall, finishQuery, setError } = useQueryStore()

  // Live ArcGIS layers
  const bikeRacksOn = useMemo(
    () => layers.find(g => g.id === 'transport')?.layers.find(l => l.id === 'bike_racks')?.on ?? false,
    [layers]
  )
  const buildingsOn = useMemo(
    () => layers.find(g => g.id === 'campus')?.layers.find(l => l.id === 'buildings_all')?.on ?? false,
    [layers]
  )
  const { features: bikeFeatures, status: bikeStatus } = useLiveLayer('bike_racks', bikeRacksOn)
  const { features: buildingFeatures, status: buildingStatus } = useLiveLayer('buildings', buildingsOn)

  const autoEnableLayer = useCallback((groupId: string, layerId: string) => {
    setLayers(gs => gs.map(g =>
      g.id === groupId
        ? { ...g, layers: g.layers.map(l => l.id === layerId ? { ...l, on: true } : l) }
        : g
    ))
  }, [])

  const zoomToPoint = useCallback((x: number, y: number) => {
    setMapFocus({ x, y, ts: Date.now() })
    setTimeout(() => setMapFocus(null), 2000)
  }, [])

  const handleMarkerClick = useCallback((m: MapMarker) => {
    if (selectedMarker?.id === m.id) {
      setSelectedMarker(null)
      setRightPanel(null)
    } else {
      setSelectedMarker(m)
      setRightPanel(`feature:${m.id}`)
    }
  }, [selectedMarker])

  const handleBikeClick = useCallback((pt: PointFeature | null) => {
    setSelectedBikeId(pt?.id ?? null)
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!query.trim()) return
    const q = query.trim()

    // Auto-enable relevant layers
    const ql = q.toLowerCase()
    if (ql.includes('bike') || ql.includes('rack') || ql.includes('cycling')) autoEnableLayer('transport', 'bike_racks')
    if (ql.includes('building') || ql.includes('footprint')) autoEnableLayer('campus', 'buildings_all')
    if (ql.includes('dining') || ql.includes('food') || ql.includes('eat')) autoEnableLayer('dining', 'dining_halls')
    if (ql.includes('librar')) autoEnableLayer('academic', 'libraries')

    setRightPanel('ai')
    setSelectedMarker(null)
    setHighlightIds([])
    setQueryTimestamp(new Date().toLocaleTimeString())
    startQuery(q)

    try {
      await streamAgentQuery(q, {
        onText: appendAIText,
        onToolCall: addToolCall,
        onToolResult: (toolName) => completeToolCall(toolName),
        onDone: finishQuery,
        onError: setError,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Query failed')
    }

    // After query, highlight nearby bike racks if relevant
    if (ql.includes('bike') && bikeFeatures.length > 0) {
      const refPoints: Record<string, { lat: number; lng: number }> = {
        regenstein: { lat: 41.7922, lng: -87.5999 },
        crerar:     { lat: 41.7908, lng: -87.6020 },
        hutch:      { lat: 41.7893, lng: -87.5997 },
      }
      let ref: { lat: number; lng: number } | null = null
      if (ql.includes('regenstein') || ql.includes('reg')) ref = refPoints.regenstein
      else if (ql.includes('crerar')) ref = refPoints.crerar
      else if (ql.includes('hutch')) ref = refPoints.hutch
      if (ref) {
        const sorted = [...bikeFeatures].sort((a, b) =>
          haversine(ref!.lat, ref!.lng, a.lat, a.lng) - haversine(ref!.lat, ref!.lng, b.lat, b.lng)
        )
        setHighlightIds(sorted.slice(0, 5).map(b => b.id))
      }
    }
  }, [query, bikeFeatures, autoEnableLayer, startQuery, appendAIText, addToolCall, completeToolCall, finishQuery, setError])

  const historyItems = useMemo(() => toHistoryItems(queryHistory), [queryHistory])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: T.paper }}>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <div style={{
        height: 54, display: 'flex', alignItems: 'center',
        padding: '0 16px', gap: 14, flexShrink: 0,
        background: T.paper, borderBottom: `1px solid ${T.rule}`,
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)', zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: T.maroon,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(128,0,0,0.3)',
          }}>
            <PhoenixLight size={18} color={T.white}/>
          </div>
          <div>
            <div style={{ fontFamily: 'EB Garamond,Georgia,serif', fontSize: 18, color: T.maroon, lineHeight: 1.1, fontWeight: 500, letterSpacing: '0.01em' }}>
              CampusGeo
            </div>
            <div style={{ fontSize: 8.5, color: T.inkLt, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 500 }}>
              University of Chicago
            </div>
          </div>
        </div>
        <div style={{ width: 1, height: 22, background: T.rule, flexShrink: 0 }}/>

        <SearchBar
          value={query}
          onChange={setQuery}
          onSubmit={handleSubmit}
          loading={isLoading}
          onHistoryClick={() => setLeftPanel(p => p === 'query' ? 'layers' : 'query')}
        />

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto', flexShrink: 0 }}>
          {([['share','Share'],['printer','Print'],['filter','Filter']] as const).map(([ic, lb]) => (
            <button
              key={ic}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                background: 'none', border: `1px solid ${T.rule}`, borderRadius: 6,
                padding: '6px 10px', color: T.inkMd, fontSize: 12, fontWeight: 500,
                transition: 'background 0.12s', cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.paperDk }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
            >
              <Ic n={ic} size={14} color={T.inkMd}/>{lb}
            </button>
          ))}
          <div style={{ width: 1, height: 22, background: T.rule }}/>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', background: T.maroon,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: T.white,
            boxShadow: '0 2px 6px rgba(128,0,0,0.25)',
          }}>JS</div>
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Icon rail */}
        <div style={{
          width: 52, background: T.paperDk, borderRight: `1px solid ${T.rule}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          paddingTop: 6, flexShrink: 0, gap: 2,
        }}>
          {([
            ['layers', 'Layers',  'layers'],
            ['query',  'History', 'clock'],
          ] as const).map(([id, lb, ic]) => {
            const active = leftPanel === id
            return (
              <button
                key={id}
                onClick={() => setLeftPanel(p => p === id ? null : id)}
                title={lb}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  padding: '8px 8px', background: active ? T.maroonTint : 'none', border: 'none',
                  borderRight: active ? `2px solid ${T.maroon}` : '2px solid transparent',
                  color: active ? T.maroon : T.inkLt, cursor: 'pointer', width: '100%',
                  transition: 'all 0.12s',
                }}
              >
                <Ic n={ic} size={17} color={active ? T.maroon : T.inkLt}/>
                <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{lb}</span>
              </button>
            )
          })}
          <div style={{ flex: 1 }}/>
          <button
            title="Filter"
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
              padding: '8px', background: 'none', border: 'none',
              color: T.inkLt, cursor: 'pointer', width: '100%', marginBottom: 8,
            }}
          >
            <Ic n="filter" size={17} color={T.inkLt}/>
            <span style={{ fontSize: 8.5, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: T.inkLt }}>Filter</span>
          </button>
        </div>

        {/* Left expandable panel */}
        {leftPanel && (
          <div style={{
            width: 272, background: T.paperDk, borderRight: `1px solid ${T.rule}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
            animation: 'slideIn 0.18s ease-out both',
          }}>
            {leftPanel === 'layers' && (
              <LayersPanel
                groups={layers}
                setGroups={fn => setLayers(gs => fn(gs))}
                search={layerSearch}
                setSearch={setLayerSearch}
              />
            )}
            {leftPanel === 'query' && (
              <QueryHistoryPanel
                queries={historyItems}
                activeId={activeHistoryId ?? ''}
                onSelect={id => setActiveHistoryId(String(id))}
                onClose={() => setLeftPanel('layers')}
              />
            )}
          </div>
        )}

        {/* Map */}
        <MapCanvas
          markers={MAP_MARKERS}
          selectedId={selectedMarker?.id ?? null}
          onMarkerClick={handleMarkerClick}
          bikeFeatures={bikeFeatures as PointFeature[]}
          buildingFeatures={buildingFeatures as PolygonFeature[]}
          highlightIds={highlightIds}
          onBikeClick={handleBikeClick}
          selectedBikeId={selectedBikeId}
          mapFocus={mapFocus}
        />

        {/* Right panel */}
        {rightPanel && (
          <div style={{
            width: 316, background: T.paper, borderLeft: `1px solid ${T.rule}`,
            display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
            animation: 'slideIn 0.18s ease-out both',
          }}>
            {rightPanel === 'ai' && aiAnswer && (
              <AIAnswerPanel
                query={query}
                isLoading={isLoading}
                text={aiAnswer.text}
                isStreaming={aiAnswer.isStreaming}
                toolCalls={aiAnswer.toolCalls}
                timestamp={queryTimestamp}
                onClose={() => { setRightPanel(null); setHighlightIds([]) }}
              />
            )}
          </div>
        )}
      </div>

      {/* ── Status bar ──────────────────────────────────────── */}
      <div style={{
        height: 24, background: T.paperDk, borderTop: `1px solid ${T.rule}`,
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 14, flexShrink: 0,
      }}>
        <span style={{ fontSize: 10, color: T.inkLt, fontFamily: 'JetBrains Mono,monospace' }}>
          41.7886° N, 87.5987° W
        </span>
        <div style={{ width: 1, height: 11, background: T.rule }}/>
        <span style={{ fontSize: 10, color: T.inkLt }}>Zoom 16 · 1:2,000</span>
        <div style={{ width: 1, height: 11, background: T.rule }}/>
        <span style={{ fontSize: 10, color: T.inkLt }}>WGS 84</span>
        <div style={{ flex: 1 }}/>
        <span style={{ fontSize: 10, color: T.inkMd, fontWeight: 500 }}>
          {layers.reduce((a, g) => a + g.layers.filter(l => l.on).length, 0)} layers visible
        </span>
        {bikeStatus === 'loading' && (
          <>
            <div style={{ width: 1, height: 11, background: T.rule }}/>
            <span style={{ fontSize: 10, color: T.amber, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.amber, animation: 'pulse 1s infinite' }}/>
              Loading bike racks…
            </span>
          </>
        )}
        {bikeStatus === 'ok' && bikeRacksOn && (
          <>
            <div style={{ width: 1, height: 11, background: T.rule }}/>
            <span style={{ fontSize: 10, color: T.green, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.green }}/>
              {bikeFeatures.length} bike racks
            </span>
          </>
        )}
        {buildingStatus === 'loading' && (
          <>
            <div style={{ width: 1, height: 11, background: T.rule }}/>
            <span style={{ fontSize: 10, color: T.amber, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.amber, animation: 'pulse 1s infinite' }}/>
              Loading buildings…
            </span>
          </>
        )}
        {buildingStatus === 'ok' && buildingsOn && (
          <>
            <div style={{ width: 1, height: 11, background: T.rule }}/>
            <span style={{ fontSize: 10, color: T.inkMd, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#8B6F47' }}/>
              {buildingFeatures.length} buildings loaded
            </span>
          </>
        )}
        {(bikeStatus === 'error' || buildingStatus === 'error') && (
          <>
            <div style={{ width: 1, height: 11, background: T.rule }}/>
            <span style={{ fontSize: 10, color: T.red }}>Some layers unavailable</span>
          </>
        )}
        <div style={{ width: 1, height: 11, background: T.rule }}/>
        <span style={{ fontSize: 10, color: T.inkLt }}>© UChicago Campus Operations</span>
      </div>

      <style>{`
        @keyframes slideIn   { from { transform: translateX(-6px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
        @keyframes pulse     { 0%,100%{opacity:1} 50%{opacity:0.3} }
        @keyframes zoomPulse { 0% { transform:translate(-50%,-50%) scale(0.3); opacity:1 } 100% { transform:translate(-50%,-50%) scale(3.5); opacity:0 } }
      `}</style>
    </div>
  )
}
