import type { ReactNode } from 'react'
import { useAppVersion } from '../hooks/useAppVersion'
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
      <main className="layout__content">{children}</main>
    </div>
  )
}
