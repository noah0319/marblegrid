import type { TodayStats } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './DailyStatsOverlay.css'

interface DailyStatsOverlayProps {
  stats: TodayStats | null
  /** Preview mode (Noah's ask: a way to see the overlay populated without waiting for real races) shows a badge so fake data is never mistaken for real. */
  preview?: boolean
}

/**
 * Noah's ask: "daily overall points, high score of the day, number of
 * races" at a glance on stream, plus (follow-up ask) who actually holds
 * today's Race HS / BR HS. Splits "high score" into Race HS / BR HS rather
 * than one combined figure — matches the Dashboard's existing precedent
 * (same two figures, same distinction) instead of inventing a new "best of
 * either" concept nothing else in the app uses. A dash shows while the
 * first fetch is still in flight rather than a misleading "0".
 */
export default function DailyStatsOverlay({ stats, preview = false }: DailyStatsOverlayProps): React.JSX.Element {
  return (
    <div className="daily-stats-overlay">
      <div className="daily-stats-overlay__header">
        <div className="daily-stats-overlay__title">Today</div>
        {preview && <div className="daily-stats-overlay__preview-badge">Preview</div>}
      </div>
      <div className="daily-stats-overlay__row">
        <Stat label="Points" value={stats ? formatFullNumber(stats.totalPoints) : '—'} />
        <span className="daily-stats-overlay__divider" />
        <Stat label="Races" value={stats ? formatFullNumber(stats.totalCount) : '—'} />
        <span className="daily-stats-overlay__divider" />
        <Stat label="Race HS" value={stats ? formatFullNumber(stats.raceHs) : '—'} holder={stats?.raceHsHolder} tone="race" />
        <span className="daily-stats-overlay__divider" />
        <Stat label="BR HS" value={stats ? formatFullNumber(stats.brHs) : '—'} holder={stats?.brHsHolder} tone="royale" />
      </div>
    </div>
  )
}

interface StatProps {
  label: string
  value: string
  holder?: string | null
  tone?: 'race' | 'royale'
}

function Stat({ label, value, holder, tone }: StatProps): React.JSX.Element {
  return (
    <div className="daily-stats-overlay__stat">
      <span className="daily-stats-overlay__stat-label">{label}</span>
      <span className={`daily-stats-overlay__stat-value${tone ? ` daily-stats-overlay__stat-value--${tone}` : ''}`}>
        {value}
      </span>
      {holder && <span className="daily-stats-overlay__stat-holder">{holder}</span>}
    </div>
  )
}
