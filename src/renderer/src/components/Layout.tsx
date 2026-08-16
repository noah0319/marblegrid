import type { ReactNode } from 'react'
import { useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
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
  const [installing, setInstalling] = useState(false)
  const [installError, setInstallError] = useState(false)

  // Real report (2026-08-16): someone force-closed via Task Manager after a
  // download finished, reopened, still on the old version — Task Manager's
  // "End Task" on a tray-backgrounded app skips the graceful quit sequence
  // that autoInstallOnAppQuit relies on entirely, and right-click-tray-icon
  // "Quit" isn't something a non-technical user reliably finds on their
  // own. This gives them a direct, deterministic path instead.
  async function handleInstallNow(): Promise<void> {
    setInstalling(true)
    setInstallError(false)
    try {
      const res = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/update/install-now`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('request failed')
      // Success means the app is about to quit and relaunch on its own —
      // deliberately leaving `installing` true rather than resetting it;
      // the window has seconds left regardless, and "Restarting..." is the
      // correct thing to show for however long that takes.
    } catch {
      setInstalling(false)
      setInstallError(true)
    }
  }

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
              Update <strong>v{updateReadyVersion}</strong> is downloaded — restart to apply it
              now, or it&apos;ll happen automatically next time you quit MarbleGrid.
              {installError && (
                <>
                  {' '}
                  Couldn&apos;t restart automatically — right-click the tray icon and choose Quit
                  to apply it instead.
                </>
              )}
            </span>
            <div className="update-banner__actions">
              {!installError && (
                <button
                  type="button"
                  className="update-banner__install"
                  onClick={() => void handleInstallNow()}
                  disabled={installing}
                >
                  {installing ? 'Restarting…' : 'Restart & Update Now'}
                </button>
              )}
              <button
                type="button"
                className="update-banner__dismiss"
                onClick={() => setDismissed(true)}
                aria-label="Dismiss"
                disabled={installing}
              >
                ×
              </button>
            </div>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
