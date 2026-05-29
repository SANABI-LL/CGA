import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'

export interface QueryHistoryItem {
  id: number | string
  q: string
  time: string
  count: number
}

interface QueryHistoryPanelProps {
  queries: QueryHistoryItem[]
  activeId: number | string
  onSelect: (id: number | string) => void
  onClose: () => void
}

export function QueryHistoryPanel({ queries, activeId, onSelect, onClose }: QueryHistoryPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        padding: '12px 14px 10px', borderBottom: `1px solid ${T.rule}`,
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Ic n="clock" size={14} color={T.amber}/>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>Query History</span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 3, display: 'flex', cursor: 'pointer' }}>
          <Ic n="x" size={14} color={T.inkLt}/>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {queries.length === 0 ? (
          <div style={{ padding: '24px 14px', textAlign: 'center', color: T.inkLt, fontSize: 12 }}>
            No queries yet
          </div>
        ) : (
          queries.map(q => (
            <div
              key={q.id}
              onClick={() => onSelect(q.id)}
              style={{
                padding: '9px 14px', cursor: 'pointer',
                background: q.id === activeId ? T.maroonTint : 'transparent',
                borderLeft: q.id === activeId ? `2px solid ${T.maroon}` : '2px solid transparent',
                transition: 'background 0.12s',
              }}
              onMouseEnter={e => { if (q.id !== activeId) e.currentTarget.style.background = T.cream }}
              onMouseLeave={e => { if (q.id !== activeId) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ fontSize: 13, color: T.ink, lineHeight: 1.4, marginBottom: 3, fontFamily: 'EB Garamond,serif', fontStyle: 'italic' }}>
                {q.q}
              </div>
              <div style={{ fontSize: 10, color: T.inkXlt, fontFamily: 'JetBrains Mono,monospace' }}>
                {q.time} · {q.count} result{q.count !== 1 ? 's' : ''}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
