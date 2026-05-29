import { MapPin, Loader2, Wrench } from 'lucide-react'
import { useQueryStore } from '@/stores/queryStore'

export function RightPanel() {
  const { aiAnswer, isLoading, currentQuery } = useQueryStore()

  if (!aiAnswer && !isLoading) return null

  return (
    <aside
      style={{
        width: 'var(--panel-right-width)',
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Panel header */}
      <div
        style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            marginBottom: currentQuery ? 'var(--space-2)' : 0,
          }}
        >
          {isLoading ? (
            <Loader2 size={16} style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite' }} />
          ) : (
            <MapPin size={16} style={{ color: 'var(--accent-primary)' }} />
          )}
          <span
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-sm)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--fg-primary)',
            }}
          >
            {isLoading ? 'Analyzing…' : 'Results'}
          </span>
        </div>

        {currentQuery && (
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--fg-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentQuery}
          </div>
        )}
      </div>

      {/* Tool calls indicator */}
      {aiAnswer && aiAnswer.toolCalls.length > 0 && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            flexShrink: 0,
          }}
        >
          {aiAnswer.toolCalls.map((tc, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
              }}
            >
              {tc.status === 'pending' ? (
                <Loader2
                  size={12}
                  style={{ color: 'var(--accent-primary)', animation: 'spin 1s linear infinite', flexShrink: 0 }}
                />
              ) : (
                <Wrench size={12} style={{ color: 'var(--status-success)', flexShrink: 0 }} />
              )}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: tc.status === 'done' ? 'var(--fg-muted)' : 'var(--fg-secondary)',
                }}
              >
                {tc.toolName}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* AI response text */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {aiAnswer && (
          <div
            style={{
              fontFamily: 'var(--font-ui)',
              fontSize: 'var(--text-base)',
              color: 'var(--fg-primary)',
              lineHeight: 'var(--leading-relaxed)',
              whiteSpace: 'pre-wrap',
            }}
            className={aiAnswer.isStreaming ? 'streaming-cursor' : ''}
          >
            {aiAnswer.text || (isLoading && !aiAnswer.text ? (
              <span style={{ color: 'var(--fg-muted)' }}>Querying campus data…</span>
            ) : null)}
          </div>
        )}
      </div>
    </aside>
  )
}
