import { useState, useRef, type KeyboardEvent } from 'react'
import { Zap, ArrowRight } from 'lucide-react'
import { useQueryStore } from '@/stores/queryStore'
import { useMapStore } from '@/stores/mapStore'
import { streamAgentQuery } from '@/api/agent'
import type { FeatureCollection } from '@campusgeo/shared-types'

const EXAMPLE_QUERIES = [
  'Show the electrical lines under Regenstein Library',
  'Where are the nearest bike stations at GCIS?',
  'When will the next shuttle arrive at Keller Center?',
  'Find accessible entrances on 57th Street',
  'Parking near Booth School of Business',
]

export function QueryBar() {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { isLoading, startQuery, appendAIText, addToolCall, completeToolCall, finishQuery, setError } =
    useQueryStore()
  const { setHighlightedFeatures, setMapFocus } = useMapStore()

  const handleSubmit = async () => {
    const query = input.trim()
    if (!query || isLoading) return

    setInput('')
    setFocused(false)
    startQuery(query)

    try {
      await streamAgentQuery(query, {
        onText: (text) => appendAIText(text),
        onToolCall: (toolName) => addToolCall(toolName),
        onToolResult: (toolName, data) => {
          completeToolCall(toolName)
          // If tool returned GeoJSON, update map
          const result = data as { features?: FeatureCollection; center?: { lat: number; lng: number } }
          if (result?.features) {
            setHighlightedFeatures(result.features)
          }
          if (result?.center) {
            setMapFocus({ center: result.center, zoom: 17 })
          }
        },
        onDone: () => finishQuery(),
        onError: (msg) => setError(msg),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div
      style={{
        background: 'var(--bg-surface)',
        border: `1px solid ${focused ? 'var(--border-accent)' : 'var(--border-default)'}`,
        borderRadius: 'var(--radius-xl)',
        boxShadow: focused ? 'var(--shadow-lg), 0 0 0 2px rgba(196,144,58,0.15)' : 'var(--shadow-lg)',
        transition: 'border-color 150ms, box-shadow 150ms',
        overflow: 'hidden',
      }}
    >
      {/* Suggestion chips (show when not loading and input empty) */}
      {!isLoading && !input && focused && (
        <div
          style={{
            padding: 'var(--space-3) var(--space-4) 0',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
          }}
        >
          {EXAMPLE_QUERIES.slice(0, 3).map((q) => (
            <button
              key={q}
              onClick={() => {
                setInput(q)
                inputRef.current?.focus()
              }}
              style={{
                background: 'var(--bg-raised)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-pill)',
                color: 'var(--fg-secondary)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 'var(--text-xs)',
                padding: '4px 12px',
                transition: 'background 150ms, color 150ms',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-overlay)'
                e.currentTarget.style.color = 'var(--fg-primary)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--bg-raised)'
                e.currentTarget.style.color = 'var(--fg-secondary)'
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 'var(--space-3) var(--space-4)',
          gap: 'var(--space-3)',
        }}
      >
        <Zap
          size={18}
          style={{
            color: isLoading ? 'var(--accent-primary)' : 'var(--fg-muted)',
            flexShrink: 0,
            transition: 'color 200ms',
            animation: isLoading ? 'pulse 1.5s ease-in-out infinite' : 'none',
          }}
        />

        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={isLoading ? 'Analyzing campus data…' : 'Ask about campus locations, facilities, or routes…'}
          disabled={isLoading}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: isLoading ? 'var(--fg-muted)' : 'var(--fg-primary)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-base)',
            cursor: isLoading ? 'not-allowed' : 'text',
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={!input.trim() || isLoading}
          style={{
            background: input.trim() && !isLoading ? 'var(--brand-primary)' : 'var(--bg-raised)',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            color: input.trim() && !isLoading ? 'var(--fg-on-brand)' : 'var(--fg-disabled)',
            cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-2)',
            transition: 'background 150ms, color 150ms',
            flexShrink: 0,
          }}
          aria-label="Submit query"
        >
          <ArrowRight size={16} />
        </button>
      </div>
    </div>
  )
}
