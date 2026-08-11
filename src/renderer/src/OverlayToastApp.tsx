import { useLatestEvent } from './hooks/useLatestEvent'
import RaceResultToast from './components/RaceResultToast'

/**
 * Dedicated Browser Source for just the result pop-in — split from the
 * leaderboard ticker (was one combined /overlay page) so Noah can size and
 * position each independently in OBS instead of them being stuck together
 * at fixed relative positions on one shared canvas.
 */
export default function OverlayToastApp(): React.JSX.Element {
  const latestEvent = useLatestEvent()
  return <RaceResultToast event={latestEvent} />
}
