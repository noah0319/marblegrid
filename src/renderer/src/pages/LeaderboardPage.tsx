import Leaderboard from '../components/Leaderboard'
import LeaderboardLabels from '../components/LeaderboardLabels'
import { useStats } from '../hooks/useStats'
import { useLeaderboardLabels } from '../hooks/useLeaderboardLabels'

export default function LeaderboardPage(): React.JSX.Element {
  const { leaderboard, loading } = useStats()
  const { labels, loading: labelsLoading, refresh: refreshLabels } = useLeaderboardLabels()

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 28 }}>Leaderboard</h1>
      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <Leaderboard rows={leaderboard} />
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, margin: '28px 0 14px' }}>Overlay giveaway labels</h2>
      {labelsLoading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <LeaderboardLabels labels={labels} onChanged={refreshLabels} />
      )}
    </div>
  )
}
