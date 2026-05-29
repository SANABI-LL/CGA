import { Layers, Clock, ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { useMapStore } from '@/stores/mapStore'
import { useQueryStore } from '@/stores/queryStore'

interface LeftRailProps {
  open: boolean
}

type Tab = 'layers' | 'history'

export function LeftRail({ open }: LeftRailProps) {
  const [activeTab, setActiveTab] = useState<Tab>('layers')
  const { layerGroups, toggleLayerVisibility, toggleGroupExpanded } = useMapStore()
  const { queryHistory } = useQueryStore()

  if (!open) return null

  return (
    <aside
      style={{
        width: 'var(--sidebar-left-width)',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        {([['layers', Layers, 'Layers'], ['history', Clock, 'History']] as const).map(
          ([tab, Icon, label]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                background: activeTab === tab ? 'var(--bg-raised)' : 'none',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                color: activeTab === tab ? 'var(--fg-primary)' : 'var(--fg-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-sm)',
                fontWeight: 'var(--weight-medium)',
                transition: 'color 150ms, background 150ms',
              }}
            >
              <Icon size={14} />
              {label}
            </button>
          )
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2) 0' }}>
        {activeTab === 'layers' && (
          <>
            {layerGroups.map((group) => (
              <div key={group.id}>
                <button
                  onClick={() => toggleGroupExpanded(group.id)}
                  style={{
                    width: '100%',
                    background: 'none',
                    border: 'none',
                    color: 'var(--fg-secondary)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-4)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 'var(--weight-semibold)',
                    letterSpacing: 'var(--tracking-wider)',
                    textTransform: 'uppercase',
                    textAlign: 'left',
                  }}
                >
                  {group.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {group.name}
                </button>

                {group.expanded &&
                  group.layers.map((layer) => (
                    <label
                      key={layer.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-2) var(--space-4) var(--space-2) var(--space-8)',
                        cursor: 'pointer',
                        color: layer.visible ? 'var(--fg-primary)' : 'var(--fg-muted)',
                        fontFamily: 'var(--font-ui)',
                        fontSize: 'var(--text-sm)',
                        transition: 'color 150ms',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={layer.visible}
                        onChange={() => toggleLayerVisibility(layer.id)}
                        style={{ accentColor: layer.color }}
                      />
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: layer.type === 'point' ? '50%' : '2px',
                          background: layer.color,
                          flexShrink: 0,
                        }}
                      />
                      {layer.name}
                    </label>
                  ))}
              </div>
            ))}
          </>
        )}

        {activeTab === 'history' && (
          <>
            {queryHistory.length === 0 ? (
              <div
                style={{
                  padding: 'var(--space-8) var(--space-4)',
                  textAlign: 'center',
                  color: 'var(--fg-muted)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                No queries yet. Ask something above.
              </div>
            ) : (
              queryHistory.map((record) => (
                <div
                  key={record.queryId}
                  style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderBottom: '1px solid var(--border-subtle)',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--bg-hover)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = 'none')
                  }
                >
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--fg-primary)',
                      marginBottom: 'var(--space-1)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {record.queryText}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-ui)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--fg-muted)',
                    }}
                  >
                    {new Date(record.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  )
}
