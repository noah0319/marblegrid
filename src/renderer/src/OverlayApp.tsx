import { useStats } from './hooks/useStats'
import { useLatestEvent } from './hooks/useLatestEvent'
import RaceResultToast from './components/RaceResultToast'
import OverlayLeaderboard from './components/OverlayLeaderboard'

/**
 * The OBS Browser Source page — transparent background, no nav/chrome, just
 * the two pieces meant to be seen live on stream: a persistent leaderboard
 * corner ticker and a result toast that appears when a race/tilt/royale
 * finishes. Same design tokens and data feed as the desktop dashboard
 * (Phase 3), reused rather than rebuilt.
 */
export default function OverlayApp(): React.JSX.Element {
  const { leaderboard } = useStats()
  const latestEvent = useLatestEvent()

  return (
    <>
      <OverlayLeaderboard rows={leaderboard} />
      <RaceResultToast event={latestEvent} />
    </>
  )
}
