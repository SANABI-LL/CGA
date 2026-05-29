import { useState } from 'react'
import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'

const SUGGESTIONS = [
  'Dining near the quad',
  'Libraries open now',
  'Accessible entrances',
  'Parking near Booth',
  'EV charging stations',
  'Shuttle stops',
]

interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  loading: boolean
  onHistoryClick: () => void
}

export function SearchBar({ value, onChange, onSubmit, loading, onHistoryClick }: SearchBarProps) {
  const [focused, setFocused] = useState(false)
  const [showDrop, setShowDrop] = useState(false)

  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 560 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, height: 38,
        background: T.cream,
        border: `1px solid ${focused ? T.maroon : T.rule}`,
        borderRadius: 8, padding: '0 12px',
        boxShadow: focused ? `0 0 0 3px ${T.maroonRing}` : '0 1px 4px rgba(0,0,0,0.07)',
        transition: 'all 0.15s',
      }}>
        <Ic n="zap" size={15} color={loading ? T.amber : T.maroon}/>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => { setFocused(true); setShowDrop(true) }}
          onBlur={() => { setFocused(false); setTimeout(() => setShowDrop(false), 150) }}
          onKeyDown={e => e.key === 'Enter' && onSubmit()}
          placeholder="Ask anything about campus…"
          style={{
            flex: 1, background: 'none', border: 'none', outline: 'none',
            fontFamily: 'EB Garamond,Georgia,serif',
            fontStyle: 'italic', fontSize: 16,
            color: value ? T.ink : T.inkXlt,
          }}
        />
        {value && (
          <button onClick={() => onChange('')} style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}>
            <Ic n="x" size={13} color={T.inkLt}/>
          </button>
        )}
        <button onClick={onHistoryClick} title="Query history" style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}>
          <Ic n="clock" size={14} color={T.inkLt}/>
        </button>
        <div style={{ width: 1, height: 18, background: T.rule }}/>
        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          style={{
            background: value.trim() ? T.maroon : T.paperDkr,
            color: value.trim() ? T.white : T.inkLt,
            border: 'none', borderRadius: 6, padding: '5px 14px',
            fontSize: 12, fontWeight: 600,
            transition: 'all 0.15s', flexShrink: 0,
            boxShadow: value.trim() ? '0 2px 6px rgba(128,0,0,0.3)' : 'none',
            cursor: value.trim() ? 'pointer' : 'default',
          }}
        >
          {loading ? '…' : 'Ask'}
        </button>
      </div>

      {showDrop && !value && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
          background: T.cream, border: `1px solid ${T.rule}`, borderRadius: 8,
          padding: '6px 0', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
        }}>
          <div style={{ fontSize: 9, color: T.inkXlt, padding: '4px 13px 7px', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600 }}>
            Suggested
          </div>
          {SUGGESTIONS.map(s => (
            <div
              key={s}
              onMouseDown={() => { onChange(s); setShowDrop(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 9, padding: '8px 13px',
                cursor: 'pointer', fontSize: 13, color: T.inkMd,
                fontFamily: 'EB Garamond,serif', fontStyle: 'italic',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = T.paperDk }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
            >
              <Ic n="search" size={12} color={T.inkXlt}/>{s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
