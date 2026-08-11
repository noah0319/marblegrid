import Leaderboard from '../components/Leaderboard'
import { useStats } from '../hooks/useStats'

export default function LeaderboardPage(): React.JSX.Element {
  const { leaderboard, loading } = useStats()

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 28 }}>Leaderboard</h1>
      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <Leaderboard rows={leaderboard} />
      )}
    </div>
  )
}
