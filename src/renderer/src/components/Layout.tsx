import type { ReactNode } from 'react'
import { useState } from 'react'
import { useAppVersion } from '../hooks/useAppVersion'
import { useUpdateReady } from '../hooks/useUpdateReady'
import './Layout.css'

export type Page = 'dashboard' | 'leaderboard' | 'maps' | 'settings'

interface LayoutProps {
  page: Page
  onNavigate: (page: Page) => void
  children: ReactNode
}

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'maps', label: 'Maps' },
  { id: 'settings', label: 'Settings' }
]

export default function Layout({ page, onNavigate, children }: LayoutProps): React.JSX.Element {
  const version = useAppVersion()
  const updateReadyVersion = useUpdateReady()
  // Resets on next window open by design (fresh mount) — cheap and low-
  // stakes to just show it again rather than persisting a dismissal, and it
  // stays true either way ("still pending") until the next real quit.
  const [dismissed, setDismissed] = useState(false)

  return (
    <div className="layout">
      <nav className="layout__sidebar">
        <div className="layout__brand">
          <span className="layout__brand-mark">MARBLEGRID</span>
          {version && <span className="layout__brand-version">v{version}</span>}
        </div>
        <ul className="layout__nav">
          {NAV_ITEMS.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`layout__nav-item${page === item.id ? ' layout__nav-item--active' : ''}`}
                onClick={() => onNavigate(item.id)}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <main className="layout__content">
        {updateReadyVersion && !dismissed && (
          <div className="update-banner" role="status">
            <span>
              Update <strong>v{updateReadyVersion}</strong> is downloaded — it&apos;ll apply next
              time you fully quit MarbleGrid.
            </span>
            <button
              type="button"
              className="update-banner__dismiss"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
