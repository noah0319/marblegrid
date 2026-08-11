import { useOverlayLeaderboard } from './hooks/useOverlayLeaderboard'
import OverlayLeaderboard from './components/OverlayLeaderboard'

/**
 * Dedicated Browser Source for just the leaderboard ticker — see
 * OverlayToastApp for why this was split out of the old combined /overlay
 * page.
 */
export default function OverlayLeaderboardApp(): React.JSX.Element {
  const rows = useOverlayLeaderboard()
  return <OverlayLeaderboard rows={rows} />
}
