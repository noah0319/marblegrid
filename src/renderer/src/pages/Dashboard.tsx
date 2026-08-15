import { useState } from 'react'
import StatTile from '../components/StatTile'
import { useStats } from '../hooks/useStats'
import { useAppSettings } from '../hooks/useAppSettings'
import { formatCompactNumber, formatFullNumber } from '@shared/format'
import './Dashboard.css'

type Scope = 'season' | 'today'

export default function Dashboard(): React.JSX.Element {
  const { season, today, loading } = useStats()
  const { settings: appSettings } = useAppSettings()
  const [scope, setScope] = useState<Scope>('season')

  const stats = scope === 'season' ? season : today

  return (
    <div>
      <div className="dashboard__header">
        <h1 className="dashboard__title">Dashboard</h1>
        <div className="dashboard__scope-toggle" role="tablist" aria-label="Stats period">
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'season'}
            className={`dashboard__scope-btn${scope === 'season' ? ' dashboard__scope-btn--active' : ''}`}
            onClick={() => setScope('season')}
          >
            Season
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={scope === 'today'}
            className={`dashboard__scope-btn${scope === 'today' ? ' dashboard__scope-btn--active' : ''}`}
            onClick={() => setScope('today')}
          >
            Today
          </button>
        </div>
      </div>

      {loading || !stats ? (
        <div className="dashboard__loading">Loading stats…</div>
      ) : (
        <div className="dashboard__grid">
          <StatTile label="Total Points" value={formatCompactNumber(stats.totalPoints)} tone="accent" />
          <StatTile label="Avg Points" value={formatFullNumber(stats.avgPoints)} />
          <StatTile label="Race HS" value={formatFullNumber(stats.raceHs)} tone="race" />
          {/* Noah's ask: "lots of streamers don't do BRs but some do" — an
              always-visible "BR HS: 0" tile is dead weight for a streamer
              who never runs that mode. Defaults to shown (true) so nothing
              changes for anyone unless explicitly turned off in Settings ->
              Stats. */}
          {appSettings.showBrHs && <StatTile label="BR HS" value={formatFullNumber(stats.brHs)} tone="royale" />}
        </div>
      )}
    </div>
  )
}
