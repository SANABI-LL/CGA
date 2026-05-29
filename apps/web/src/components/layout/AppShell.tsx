import { useState } from 'react'
import { TopBar } from './TopBar'
import { MapView } from '../map/MapView'
import { LeftRail } from '../sidebar/LeftRail'
import { RightPanel } from '../panels/RightPanel'
import { QueryBar } from '../search/QueryBar'

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100dvh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--bg-canvas)',
      }}
    >
      <TopBar
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {/* Left sidebar — collapsible */}
        <LeftRail open={sidebarOpen} />

        {/* Map fills remaining space */}
        <main style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <MapView />

          {/* Query bar floats over map */}
          <div
            style={{
              position: 'absolute',
              bottom: 'var(--space-6)',
              left: '50%',
              transform: 'translateX(-50%)',
              width: 'min(640px, calc(100% - var(--space-8)))',
              zIndex: 50,
            }}
          >
            <QueryBar />
          </div>
        </main>

        {/* Right results panel */}
        <RightPanel />
      </div>
    </div>
  )
}
