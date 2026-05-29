import { Menu, X } from 'lucide-react'

interface TopBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export function TopBar({ sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <header
      style={{
        height: 'var(--topbar-height)',
        background: 'var(--bg-brand)',
        borderBottom: '1px solid var(--maroon-800)',
        boxShadow: 'var(--shadow-brand)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 var(--space-4)',
        gap: 'var(--space-3)',
        flexShrink: 0,
        zIndex: 100,
      }}
    >
      <button
        onClick={onToggleSidebar}
        style={{
          background: 'none',
          border: 'none',
          color: 'rgba(255,255,255,0.8)',
          cursor: 'pointer',
          padding: 'var(--space-2)',
          borderRadius: 'var(--radius-md)',
          display: 'flex',
          alignItems: 'center',
        }}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <img
        src="/assets/phoenix.svg"
        alt="UChicago Phoenix"
        style={{ height: 28, width: 'auto' }}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-bold)',
            color: 'var(--fg-on-brand)',
            letterSpacing: 'var(--tracking-wide)',
            lineHeight: 1.2,
          }}
        >
          CampusGeo
        </span>
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--text-xs)',
            color: 'rgba(255,255,255,0.6)',
            letterSpacing: 'var(--tracking-wider)',
            textTransform: 'uppercase',
            lineHeight: 1,
          }}
        >
          University of Chicago
        </span>
      </div>

      <div style={{ flex: 1 }} />

      <span
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--text-xs)',
          color: 'rgba(255,255,255,0.5)',
          letterSpacing: 'var(--tracking-wide)',
        }}
      >
        AI Geospatial Agent
      </span>
    </header>
  )
}
