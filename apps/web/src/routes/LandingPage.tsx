import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { PhoenixMark } from '@/components/shared/PhoenixMark'
import s from './LandingPage.module.css'

const EXAMPLES = [
  'Trees near Crerar Library',
  'Dining near the quad',
  'Buildings constructed before 1930',
]

export function LandingPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const handleSubmit = (q: string) => {
    const trimmed = q.trim()
    if (trimmed) {
      navigate({ to: '/map', search: { q: trimmed } })
    } else {
      navigate({ to: '/map' })
    }
  }

  return (
    <div className={s.page}>
      {/* Warm topographic background grid */}
      <svg className={s.bgGrid} aria-hidden>
        <defs>
          <pattern id="topo" width="48" height="48" patternUnits="userSpaceOnUse">
            <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#c8bfad" strokeWidth="0.4"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#topo)" opacity="0.35"/>
      </svg>

      {/* Institutional header */}
      <header className={s.header}>
        <PhoenixMark size={14} color="#8a8a85"/>
        <span className={s.institution}>University of Chicago</span>
        <span className={s.coords}>41.7886° N, 87.5987° W</span>
      </header>

      {/* Editorial main content */}
      <main className={s.main}>
        <p className={`${s.eyebrow} ${s.animate} ${s.delay1}`}>
          Campus Geospatial Intelligence
        </p>

        <hr className={`${s.rule} ${s.animate} ${s.delay1}`}/>

        <h1 className={`${s.title} ${s.animate} ${s.delay2}`}>
          CampusGeo
        </h1>

        <p className={`${s.subtitle} ${s.animate} ${s.delay2}`}>
          Natural-language queries over the University of Chicago geospatial
          database. Buildings, trees, transit, services, and more.
        </p>

        <form
          className={`${s.queryForm} ${s.animate} ${s.delay3}`}
          onSubmit={e => { e.preventDefault(); handleSubmit(query) }}
        >
          <input
            className={s.queryInput}
            placeholder="Ask about the campus —"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className={s.submitBtn}>
            Map results
          </button>
        </form>

        <p className={`${s.examples} ${s.animate} ${s.delay4}`}>
          e.g.{' '}
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              <button
                type="button"
                className={s.exampleBtn}
                onClick={() => handleSubmit(ex)}
              >
                {ex}
              </button>
              {i < EXAMPLES.length - 1 && ' · '}
            </span>
          ))}
        </p>
      </main>

      {/* Attribution footer */}
      <footer className={s.foot}>
        <span className={s.footNote}>
          ArcGIS Feature Services · University of Chicago Campus Data
        </span>
      </footer>
    </div>
  )
}
