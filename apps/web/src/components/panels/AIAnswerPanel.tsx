import { T } from '@/styles/theme'
import { Ic } from '@/components/shared/Icon'

interface ToolCall {
  toolName: string
  status: 'pending' | 'done'
}

interface AIAnswerPanelProps {
  query: string
  isLoading: boolean
  text: string
  isStreaming: boolean
  toolCalls: ToolCall[]
  timestamp: string
  onClose: () => void
}

export function AIAnswerPanel({ query, isLoading, text, isStreaming, toolCalls, timestamp, onClose }: AIAnswerPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '14px 14px 12px',
        borderBottom: `1px solid ${T.rule}`,
        flexShrink: 0,
        background: `linear-gradient(135deg,${T.amberTint},transparent 80%)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 8,
            background: T.amberTint,
            border: '1px solid rgba(176,120,48,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <Ic n="zap" size={17} color={T.amber}/>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: T.amber, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 3 }}>
              AI Analysis
            </div>
            <div style={{ fontSize: 13, fontStyle: 'italic', color: T.inkMd, fontFamily: 'EB Garamond,serif', lineHeight: 1.4 }}>
              {query}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 2, display: 'flex', flexShrink: 0, cursor: 'pointer' }}>
            <Ic n="x" size={15} color={T.inkLt}/>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px' }}>
        {isLoading && !text ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5, marginBottom: 12 }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: '50%', background: T.amber,
                  animation: `bounce 0.8s ${i * 0.15}s infinite`,
                }}/>
              ))}
            </div>
            <div style={{ fontSize: 12, color: T.inkLt }}>Analyzing campus data…</div>
            {toolCalls.length > 0 && (
              <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 5, justifyContent: 'center' }}>
                {toolCalls.map((tc, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                    background: tc.status === 'done' ? T.greenBg : T.amberTint,
                    color: tc.status === 'done' ? T.green : T.amber,
                    border: `1px solid ${tc.status === 'done' ? T.greenBd : 'rgba(176,120,48,0.3)'}`,
                  }}>
                    {tc.toolName}
                  </span>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Tool calls strip */}
            {toolCalls.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                {toolCalls.map((tc, i) => (
                  <span key={i} style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                    background: tc.status === 'done' ? T.greenBg : T.amberTint,
                    color: tc.status === 'done' ? T.green : T.amber,
                    border: `1px solid ${tc.status === 'done' ? T.greenBd : 'rgba(176,120,48,0.3)'}`,
                  }}>
                    {tc.toolName}
                  </span>
                ))}
              </div>
            )}

            {/* Main answer text */}
            <div style={{
              fontSize: 14, color: T.ink, lineHeight: 1.7, marginBottom: 14,
              fontFamily: 'EB Garamond,serif', fontStyle: 'italic',
              borderLeft: `3px solid ${T.amber}`, paddingLeft: 12,
              whiteSpace: 'pre-wrap',
            }}>
              {text || 'Thinking…'}
              {isStreaming && <span style={{ opacity: 0.5, animation: 'pulse 1s infinite' }}>▍</span>}
            </div>

            {/* Source note */}
            <div style={{
              fontSize: 10, color: T.inkXlt,
              borderTop: `1px solid ${T.ruleLt}`, paddingTop: 8,
              display: 'flex', gap: 6, alignItems: 'flex-start',
            }}>
              <Ic n="info" size={12} color={T.inkXlt}/>
              <span>Based on live UChicago ArcGIS data · {timestamp}</span>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes pulse  { 0%,100%{opacity:1} 50%{opacity:0.3} }
      `}</style>
    </div>
  )
}
