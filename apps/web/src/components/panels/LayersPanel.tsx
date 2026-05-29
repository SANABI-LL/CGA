import { useState, useMemo } from 'react'
import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'

export interface LayerItem {
  id: string
  label: string
  color: string
  on: boolean
  count: number
  opacity: number
}

export interface LayerGroup {
  id: string
  label: string
  icon: string
  open: boolean
  layers: LayerItem[]
}

interface LayersPanelProps {
  groups: LayerGroup[]
  setGroups: (fn: (gs: LayerGroup[]) => LayerGroup[]) => void
  search: string
  setSearch: (s: string) => void
}

export function LayersPanel({ groups, setGroups, search, setSearch }: LayersPanelProps) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(groups.map(g => [g.id, g.open]))
  )
  const [hov, setHov] = useState<string | null>(null)

  const toggleLayer = (gid: string, lid: string) =>
    setGroups(gs => gs.map(g =>
      g.id === gid ? { ...g, layers: g.layers.map(l => l.id === lid ? { ...l, on: !l.on } : l) } : g
    ))

  const setOp = (gid: string, lid: string, v: number) =>
    setGroups(gs => gs.map(g =>
      g.id === gid ? { ...g, layers: g.layers.map(l => l.id === lid ? { ...l, opacity: v } : l) } : g
    ))

  const filt = useMemo(() => {
    if (!search.trim()) return groups
    const q = search.toLowerCase()
    return groups
      .map(g => ({ ...g, layers: g.layers.filter(l => l.label.toLowerCase().includes(q)) }))
      .filter(g => g.layers.length)
  }, [groups, search])

  const activeN = groups.reduce((a, g) => a + g.layers.filter(l => l.on).length, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 14px 10px', borderBottom: `1px solid ${T.rule}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Ic n="layers" size={15} color={T.maroon}/>
            <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Map Layers</span>
          </div>
          <span style={{
            fontSize: 11, color: T.maroon, fontWeight: 600,
            background: T.maroonTint, border: `1px solid ${T.maroonRing}`,
            borderRadius: 20, padding: '1px 9px',
          }}>{activeN} on</span>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: T.cream, border: `1px solid ${T.rule}`, borderRadius: 6, padding: '7px 10px',
        }}>
          <Ic n="search" size={13} color={T.inkLt}/>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter layers…"
            style={{ background: 'none', border: 'none', outline: 'none', flex: 1, fontSize: 12, color: search ? T.ink : T.inkXlt }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', padding: 0, display: 'flex', cursor: 'pointer' }}>
              <Ic n="x" size={12} color={T.inkLt}/>
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0 8px' }}>
        {filt.map(g => {
          const isOpen = open[g.id]
          const activeG = g.layers.filter(l => l.on).length
          return (
            <div key={g.id}>
              <button
                onClick={() => setOpen(s => ({ ...s, [g.id]: !s[g.id] }))}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', background: 'none', border: 'none',
                  textAlign: 'left', cursor: 'pointer',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = T.paperDkr }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
              >
                <Ic n={g.icon as Parameters<typeof Ic>[0]['n']} size={13} color={T.inkLt}/>
                <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.inkMd }}>{g.label}</span>
                {activeG > 0 && (
                  <span style={{ fontSize: 10, color: T.maroon, fontWeight: 700, background: T.maroonTint, borderRadius: 20, padding: '0 7px' }}>
                    {activeG}
                  </span>
                )}
                <Ic n={isOpen ? 'chevronDown' : 'chevronRight'} size={13} color={T.inkXlt}/>
              </button>

              {isOpen && g.layers.map(l => {
                const isHov = hov === l.id
                return (
                  <div
                    key={l.id}
                    onMouseEnter={() => setHov(l.id)}
                    onMouseLeave={() => setHov(null)}
                    style={{ paddingLeft: 34, paddingRight: 14, background: isHov ? T.cream : 'transparent', transition: 'background 0.12s' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, paddingBottom: l.on && isHov ? 2 : 6 }}>
                      <div style={{ width: 9, height: 9, borderRadius: 2, background: l.color, flexShrink: 0, opacity: l.on ? 1 : 0.3 }}/>
                      <span style={{ flex: 1, fontSize: 12, color: l.on ? T.ink : T.inkLt, transition: 'color 0.15s' }}>{l.label}</span>
                      <span style={{ fontSize: 10, color: T.inkXlt, fontFamily: 'JetBrains Mono,monospace', marginRight: 4 }}>{l.count}</span>
                      <div
                        onClick={() => toggleLayer(g.id, l.id)}
                        style={{
                          width: 28, height: 16, borderRadius: 8,
                          background: l.on ? T.maroon : T.rule,
                          position: 'relative', cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                        }}
                      >
                        <div style={{
                          position: 'absolute', top: 2, left: l.on ? 'calc(100% - 14px)' : 2,
                          width: 12, height: 12, borderRadius: '50%', background: T.white,
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }}/>
                      </div>
                    </div>
                    {l.on && isHov && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 7 }}>
                        <Ic n="eye" size={11} color={T.inkXlt}/>
                        <input
                          type="range" min="10" max="100" value={l.opacity}
                          onChange={e => setOp(g.id, l.id, +e.target.value)}
                          style={{ flex: 1, height: 2, accentColor: T.maroon, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: 10, color: T.inkLt, fontFamily: 'JetBrains Mono,monospace', width: 28, textAlign: 'right' }}>{l.opacity}%</span>
                      </div>
                    )}
                  </div>
                )
              })}
              <div style={{ borderBottom: `1px solid ${T.ruleLt}`, margin: '3px 0' }}/>
            </div>
          )
        })}
        {filt.length === 0 && (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: T.inkLt, fontSize: 12 }}>
            No layers match "{search}"
          </div>
        )}
      </div>

      <div style={{ padding: '8px 14px', borderTop: `1px solid ${T.rule}`, fontSize: 10, color: T.inkXlt, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, color: T.inkLt }}>Sources: </span>UChicago Campus Operations · Facilities Services
      </div>
    </div>
  )
}
