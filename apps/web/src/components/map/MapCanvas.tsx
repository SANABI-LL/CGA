import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'
import type { PointFeature, PolygonFeature } from '@/hooks/useArcGISLayer'

export interface MapMarker {
  id: string
  x: number
  y: number
  color: string
  icon: string
  label: string
}

interface MapCanvasProps {
  markers: MapMarker[]
  selectedId: string | null
  onMarkerClick: (marker: MapMarker) => void
  bikeFeatures: PointFeature[]
  buildingFeatures: PolygonFeature[]
  highlightIds: (string | number)[]
  onBikeClick: (pt: PointFeature | null) => void
  selectedBikeId: string | number | null
  mapFocus: { x: number; y: number; ts: number } | null
}

export function MapCanvas({
  markers,
  selectedId,
  onMarkerClick,
  bikeFeatures,
  buildingFeatures,
  highlightIds,
  onBikeClick,
  selectedBikeId,
  mapFocus,
}: MapCanvasProps) {
  return (
    <div style={{ flex: 1, position: 'relative', background: T.mapBg, overflow: 'hidden', height: '100%' }}>
      {/* Grain texture */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        opacity: 0.5, pointerEvents: 'none', zIndex: 1,
      }}/>

      {/* Static campus SVG base */}
      <svg
        width="100%" height="100%"
        viewBox="0 0 900 660"
        preserveAspectRatio="xMidYMid slice"
        style={{ position: 'absolute', inset: 0 }}
        onClick={() => { if (selectedBikeId) onBikeClick(null) }}
      >
        <rect width="900" height="660" fill={T.mapBg}/>
        {/* Horizontal streets */}
        {[[0,152,900,168],[0,322,900,336],[0,480,900,494]].map(([x1,y1,x2,y2],i) => (
          <rect key={`sh${i}`} x={x1} y={y1} width={x2-x1} height={y2-y1} fill={T.mapStreet}/>
        ))}
        {/* Vertical streets */}
        {[[122,0,136,660],[312,0,326,660],[502,0,516,660],[692,0,706,660]].map(([x1,y1,x2,y2],i) => (
          <rect key={`sv${i}`} x={x1} y={y1} width={x2-x1} height={y2-y1} fill={T.mapStreet}/>
        ))}
        {/* Street center dashes */}
        {[[0,160,900,160],[0,329,900,329],[0,487,900,487]].map(([x1,y1,x2,y2],i) => (
          <line key={`sd${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke={T.mapStreetMd} strokeWidth="0.8" strokeDasharray="14 9"/>
        ))}
        {[[129,0,129,660],[319,0,319,660],[509,0,509,660],[699,0,699,660]].map(([x,y1,x2,y2],i) => (
          <line key={`svd${i}`} x1={x} y1={y1} x2={x2} y2={y2} stroke={T.mapStreetMd} strokeWidth="0.8" strokeDasharray="14 9"/>
        ))}
        {/* Street edges */}
        {[152,168,322,336,480,494].map((y,i) => (
          <line key={`sw${i}`} x1="0" y1={y} x2="900" y2={y} stroke={T.mapStreetMd} strokeWidth="0.6"/>
        ))}
        {[122,136,312,326,502,516,692,706].map((x,i) => (
          <line key={`swv${i}`} x1={x} y1="0" x2={x} y2="660" stroke={T.mapStreetMd} strokeWidth="0.6"/>
        ))}
        {/* Main Quad green */}
        <rect x="178" y="178" width="296" height="118" fill={T.mapGreen} stroke={T.mapGreenStroke} strokeWidth="1.2" rx="3"/>
        <text x="326" y="243" textAnchor="middle" fill={T.mapGreenStroke} fontSize="10" fontFamily="'EB Garamond',serif" fontStyle="italic" letterSpacing="1.5">Main Quad</text>
        {/* Building blocks */}
        {[
          [144,170,64,64,'Cobb'],[218,170,68,64,'Stuart'],[296,170,68,64,'Pick'],
          [374,170,68,64,'Classics'],[450,170,56,64,'Rosenwald'],
          [144,346,90,70,'Crerar'],[248,346,76,70,'KGSB'],[338,346,56,70,'Ryerson'],
          [406,346,90,70,'Kersten'],[510,346,84,70,'Searle'],
          [536,170,108,84,'Regenstein'],[660,170,88,84,'Harper'],
          [660,346,88,84,'Pick Hall'],[536,346,112,70,'Crerar Lab'],
          [144,506,78,62,'Reynolds'],[238,506,86,62,'Hutchinson'],[340,506,62,62,'Bartlett'],
          [416,506,96,62,'Cathey'],[530,506,98,70,'Logan'],[660,506,88,70,'Max Palevsky'],
        ].map(([x,y,w,h,name],i) => (
          <g key={i}>
            <rect x={x} y={y} width={w} height={h} fill={T.mapBlock} stroke={T.mapBlockStroke} strokeWidth="0.8" rx="2"/>
            <text x={Number(x)+Number(w)/2} y={Number(y)+Number(h)/2+3} textAnchor="middle" fill={T.mapBlockStroke} fontSize="7" fontFamily="'Plus Jakarta Sans',sans-serif" fontWeight="500" opacity="0.7">{name}</text>
          </g>
        ))}
        {/* Street labels */}
        {[[450,147,'E 57th Street'],[450,317,'E 59th Street'],[450,475,'E 61st Street']].map(([x,y,t],i) => (
          <text key={i} x={x} y={y} textAnchor="middle" fill={T.mapStreetMd} fontSize="9.5" fontFamily="'Plus Jakarta Sans',sans-serif" fontWeight="500">{t}</text>
        ))}
        {[[116,380,'S University Ave'],[306,380,'S Ellis Ave'],[496,380,'S Woodlawn Ave'],[686,380,'S Greenwood Ave']].map(([x,y,t],i) => (
          <text key={i} x={x} y={y} textAnchor="middle" fill={T.mapStreetMd} fontSize="8.5" fontFamily="'Plus Jakarta Sans',sans-serif" fontWeight="500" transform={`rotate(-90,${x},${y})`}>{t}</text>
        ))}
      </svg>

      {/* Live building footprints */}
      {buildingFeatures.length > 0 && (
        <svg
          width="100%" height="100%"
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {buildingFeatures.map(b => {
            const isHl = highlightIds.includes(b.id)
            return (
              <polygon
                key={String(b.id)}
                points={b.svgPts}
                fill={isHl ? 'rgba(128,0,0,0.28)' : 'rgba(139,111,71,0.18)'}
                stroke={isHl ? T.maroon : '#8B6F47'}
                strokeWidth={isHl ? '0.18' : '0.08'}
                style={{ transition: 'fill 0.3s,stroke 0.3s' }}
              />
            )
          })}
        </svg>
      )}

      {/* Live bike rack dots */}
      {bikeFeatures.map(pt => {
        const isSel = pt.id === selectedBikeId
        return (
          <div
            key={String(pt.id)}
            onClick={e => { e.stopPropagation(); onBikeClick(isSel ? null : pt) }}
            style={{
              position: 'absolute',
              left: `${pt.x}%`, top: `${pt.y}%`,
              transform: 'translate(-50%,-50%)',
              zIndex: isSel ? 18 : 8,
              cursor: 'pointer',
            }}
          >
            {isSel && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)',
                background: T.cream, border: `1px solid ${T.rule}`, borderRadius: 6,
                padding: '6px 10px', whiteSpace: 'nowrap', zIndex: 30,
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)', minWidth: 160,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.ink, marginBottom: 2 }}>
                  {String(pt.attrs.RACK_TYPE ?? pt.attrs.TYPE ?? 'Bike Rack')}
                </div>
                <div style={{ fontSize: 10, color: T.inkMd, marginBottom: 3 }}>
                  {String(pt.attrs.LOCATION ?? pt.attrs.Location ?? pt.attrs.NEAR_BLDG ?? 'Campus location')}
                </div>
                <div style={{ fontSize: 9, color: T.inkXlt, fontFamily: 'JetBrains Mono,monospace' }}>
                  {pt.lat.toFixed(5)}° N, {Math.abs(pt.lng).toFixed(5)}° W
                </div>
                <div style={{
                  position: 'absolute', bottom: -5, left: '50%',
                  transform: 'translateX(-50%) rotate(45deg)',
                  width: 8, height: 8, background: T.cream,
                  borderRight: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
                }}/>
              </div>
            )}
            <div style={{
              width: isSel ? 16 : 10, height: isSel ? 16 : 10,
              borderRadius: '50%',
              background: T.green,
              border: isSel ? '2px solid white' : '1.5px solid white',
              boxShadow: isSel
                ? `0 0 0 3px ${T.green}40, 0 2px 8px rgba(0,0,0,0.25)`
                : '0 1px 4px rgba(0,0,0,0.22)',
              opacity: isSel ? 1 : 0.85,
              transition: 'all 0.15s',
            }}/>
          </div>
        )
      })}

      {/* Map focus pulse ring */}
      {mapFocus && (
        <div style={{
          position: 'absolute',
          left: `${mapFocus.x}%`, top: `${mapFocus.y}%`,
          transform: 'translate(-50%,-50%)',
          pointerEvents: 'none', zIndex: 25,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: `3px solid ${T.maroon}`,
            animation: 'zoomPulse 1.8s ease-out forwards',
          }}/>
        </div>
      )}

      {/* Static markers */}
      {markers.map(m => {
        const sel = m.id === selectedId
        return (
          <div
            key={m.id}
            onClick={() => onMarkerClick(m)}
            style={{
              position: 'absolute',
              left: `${m.x}%`, top: `${m.y}%`,
              transform: 'translate(-50%,-50%)',
              cursor: 'pointer', zIndex: sel ? 20 : 10,
            }}
          >
            {sel && (
              <div style={{
                position: 'absolute', bottom: 'calc(100% + 10px)', left: '50%',
                transform: 'translateX(-50%)',
                background: T.cream, border: `1px solid ${T.rule}`, borderRadius: 6,
                padding: '5px 12px', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 600,
                color: T.ink, boxShadow: '0 4px 20px rgba(0,0,0,0.15)', zIndex: 30,
              }}>
                {m.label}
                <div style={{
                  position: 'absolute', bottom: -5, left: '50%',
                  transform: 'translateX(-50%) rotate(45deg)',
                  width: 8, height: 8, background: T.cream,
                  borderRight: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`,
                }}/>
              </div>
            )}
            <div style={{
              width: sel ? 38 : 30, height: sel ? 38 : 30, borderRadius: '50%',
              background: sel ? m.color : T.cream,
              border: `2px solid ${m.color}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: sel
                ? `0 0 0 5px ${m.color}25,0 4px 16px rgba(0,0,0,0.2)`
                : '0 2px 8px rgba(0,0,0,0.14)',
              transition: 'all 0.2s',
            }}>
              <Ic n={m.icon as Parameters<typeof Ic>[0]['n']} size={sel ? 15 : 12} color={sel ? T.white : m.color}/>
            </div>
          </div>
        )
      })}

      {/* Floating map controls */}
      <div style={{
        position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)',
        display: 'flex', flexDirection: 'column', gap: 4, zIndex: 15,
      }}>
        {([['plus','Zoom in'],['minus','Zoom out'],['locate','My location'],['maximize','Fullscreen']] as const).map(([icon, tip]) => (
          <button
            key={icon}
            title={tip}
            style={{
              width: 34, height: 34, background: T.cream,
              border: `1px solid ${T.rule}`, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: T.inkMd, boxShadow: '0 1px 6px rgba(0,0,0,0.1)', transition: 'background 0.12s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = T.paperDkr }}
            onMouseLeave={e => { e.currentTarget.style.background = T.cream }}
          >
            <Ic n={icon} size={15} color={T.inkMd}/>
          </button>
        ))}
        <div style={{ height: 1, background: T.rule, margin: '3px 0' }}/>
        <button style={{
          width: 34, height: 34, background: T.cream,
          border: `1px solid ${T.rule}`, borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 6px rgba(0,0,0,0.1)',
        }}>
          <Ic n="compass" size={17} color={T.inkLt}/>
        </button>
      </div>

      {/* Scale bar */}
      <div style={{ position: 'absolute', bottom: 30, left: 16, display: 'flex', alignItems: 'center', gap: 7, zIndex: 15 }}>
        <div style={{ position: 'relative', width: 72, height: 10 }}>
          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1.5, background: T.inkMd }}/>
          <div style={{ position: 'absolute', top: 0, left: 0, width: 1.5, height: 10, background: T.inkMd }}/>
          <div style={{ position: 'absolute', top: 0, right: 0, width: 1.5, height: 10, background: T.inkMd }}/>
        </div>
        <span style={{ fontSize: 10, color: T.inkMd, fontFamily: 'JetBrains Mono,monospace' }}>500 ft</span>
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 16, fontSize: 9, color: T.inkLt, zIndex: 15 }}>
        © UChicago Campus Operations · © OpenStreetMap contributors
      </div>
    </div>
  )
}
