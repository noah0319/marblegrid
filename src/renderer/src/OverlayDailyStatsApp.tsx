import { useTodayStats } from './hooks/useTodayStats'
import DailyStatsOverlay from './components/DailyStatsOverlay'

/**
 * Dedicated Browser Source for today's headline numbers (Noah's ask: overall
 * points, high score, and race count at a glance) — third independent
 * overlay piece alongside the result toast and the season leaderboard, same
 * split-source rationale as those two (positionable separately in OBS).
 */
export default function OverlayDailyStatsApp(): React.JSX.Element {
  const stats = useTodayStats()
  return <DailyStatsOverlay stats={stats} />
}
