import { Fragment } from 'react'
import type { TodayStats } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './DailyStatsOverlay.css'

interface DailyStatsOverlayProps {
  stats: TodayStats | null
  /** Preview mode (Noah's ask: a way to see the overlay populated without waiting for real races) shows a badge so fake data is never mistaken for real. */
  preview?: boolean
  /** Noah's ask: "lots of streamers don't do BRs but some do" — Settings -> Stats toggle. Defaults true. */
  showBrHs?: boolean
}

interface StatDef {
  key: string
  label: string
  value: string
  holder?: string | null
  tone?: 'race' | 'royale'
}

/**
 * Noah's ask: "daily overall points, high score of the day, number of
 * races" at a glance on stream, plus (follow-up ask) who actually holds
 * today's Race HS / BR HS. Splits "high score" into Race HS / BR HS rather
 * than one combined figure — matches the Dashboard's existing precedent
 * (same two figures, same distinction) instead of inventing a new "best of
 * either" concept nothing else in the app uses. A dash shows while the
 * first fetch is still in flight rather than a misleading "0".
 *
 * Built from a list + Fragment map (rather than four hand-placed <Stat>s
 * with hardcoded dividers) so BR HS can drop out cleanly when toggled off
 * — the divider before it needs to disappear too, not just the stat itself,
 * or there'd be an orphaned trailing divider.
 */
export default function DailyStatsOverlay({ stats, preview = false, showBrHs = true }: DailyStatsOverlayProps): React.JSX.Element {
  const items: StatDef[] = [
    { key: 'points', label: 'Points', value: stats ? formatFullNumber(stats.totalPoints) : '—' },
    { key: 'races', label: 'Races', value: stats ? formatFullNumber(stats.totalCount) : '—' },
    { key: 'raceHs', label: 'Race HS', value: stats ? formatFullNumber(stats.raceHs) : '—', holder: stats?.raceHsHolder, tone: 'race' }
  ]
  if (showBrHs) {
    items.push({ key: 'brHs', label: 'BR HS', value: stats ? formatFullNumber(stats.brHs) : '—', holder: stats?.brHsHolder, tone: 'royale' })
  }

  return (
    <div className="daily-stats-overlay">
      <div className="daily-stats-overlay__header">
        <div className="daily-stats-overlay__title">Today</div>
        {preview && <div className="daily-stats-overlay__preview-badge">Preview</div>}
      </div>
      <div className="daily-stats-overlay__row">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            {index > 0 && <span className="daily-stats-overlay__divider" />}
            <Stat label={item.label} value={item.value} holder={item.holder} tone={item.tone} />
          </Fragment>
        ))}
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
