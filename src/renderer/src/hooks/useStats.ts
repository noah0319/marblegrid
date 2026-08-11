import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { RaceStats, LeaderboardRow } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface StatsState {
  season: RaceStats | null
  today: RaceStats | null
  leaderboard: LeaderboardRow[]
  loading: boolean
}

/**
 * Fetches season/today stats + the leaderboard once on mount, then
 * re-fetches automatically whenever the backend pushes a race/tilt/royale
 * event over the WebSocket — this is what makes the dashboard feel "live"
 * during a stream instead of needing a manual refresh.
 */
export function useStats(): StatsState {
  const [season, setSeason] = useState<RaceStats | null>(null)
  const [today, setToday] = useState<RaceStats | null>(null)
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [seasonRes, todayRes, leaderboardRes] = await Promise.all([
      fetch(`${BASE}/api/stats/season`).then((r) => r.json() as Promise<RaceStats>),
      fetch(`${BASE}/api/stats/today`).then((r) => r.json() as Promise<RaceStats>),
      fetch(`${BASE}/api/leaderboard?limit=20`).then((r) => r.json() as Promise<LeaderboardRow[]>)
    ])
    setSeason(seasonRes)
    setToday(todayRes)
    setLeaderboard(leaderboardRes)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useLiveSocket(
    useCallback(
      (msg) => {
        if (msg.type === 'race-event' || msg.type === 'tilt-event' || msg.type === 'royale-event') {
          void refresh()
        }
      },
      [refresh]
    )
  )

  return { season, today, leaderboard, loading }
}
