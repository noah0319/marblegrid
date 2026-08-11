import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { LeaderboardRow } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/**
 * Just the top 5, for the overlay's corner ticker — a lean dedicated fetch
 * (limit=5 server-side, not 20 sliced client-side) rather than reusing the
 * dashboard's useStats, which also pulls season/today stats this page has
 * no use for. Matters more here than on the desktop app: this page can run
 * for hours during a live stream.
 */
export function useOverlayLeaderboard(): LeaderboardRow[] {
  const [rows, setRows] = useState<LeaderboardRow[]>([])

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/leaderboard?limit=5`)
    if (!res.ok) return
    setRows((await res.json()) as LeaderboardRow[])
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

  return rows
}
