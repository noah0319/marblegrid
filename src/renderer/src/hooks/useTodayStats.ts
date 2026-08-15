import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { TodayStats } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/**
 * Powers the "Daily Stats" overlay (Noah's ask: overall points, high score,
 * and race count for today, at a glance on stream) — a lean dedicated fetch
 * of the same /api/stats/today the Dashboard's Today toggle already uses.
 *
 * Refreshes on every race/tilt/royale event (today's totals can change) and
 * on 'hello', the same reconnect-refresh fix already applied to the other
 * overlay hooks: the WS socket reconnects fine on its own after a backend
 * restart, but reconnecting alone isn't a reason to assume fresh data — only
 * treating the server's 'hello' (sent on every new connection) as a refresh
 * trigger keeps this from sitting frozen on stale numbers on an OBS source
 * left open for hours.
 */
export function useTodayStats(): TodayStats | null {
  const [stats, setStats] = useState<TodayStats | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/stats/today`)
    if (!res.ok) return
    setStats((await res.json()) as TodayStats)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useLiveSocket(
    useCallback(
      (msg) => {
        if (msg.type === 'race-event' || msg.type === 'tilt-event' || msg.type === 'royale-event' || msg.type === 'hello') {
          void refresh()
        }
      },
      [refresh]
    )
  )

  return stats
}
