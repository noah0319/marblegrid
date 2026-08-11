import type { LeaderboardRow } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './OverlayLeaderboard.css'

interface OverlayLeaderboardProps {
  rows: LeaderboardRow[]
}

/** Always-visible compact corner ticker — the thing to look at between race-result pop-ins. */
export default function OverlayLeaderboard({ rows }: OverlayLeaderboardProps): React.JSX.Element {
  const top = rows.slice(0, 5)

  return (
    <div className="overlay-leaderboard">
      <div className="overlay-leaderboard__title">Season Leaderboard</div>
      {top.map((row, index) => (
        <div className="overlay-leaderboard__row" key={row.username}>
          <span className="overlay-leaderboard__rank">{index + 1}</span>
          <span className="overlay-leaderboard__name">{row.displayName || row.username}</span>
          <span className="overlay-leaderboard__points">{formatFullNumber(row.totalPoints)}</span>
        </div>
      ))}
      {top.length === 0 && <div className="overlay-leaderboard__empty">No races yet</div>}
    </div>
  )
}
