import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { LeaderboardLabel } from '@shared/types'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface LeaderboardLabelsState {
  labels: LeaderboardLabel[]
  loading: boolean
  refresh: () => Promise<void>
}

/**
 * Desktop-editing side — Noah edits these here, so no WS live-refresh is
 * needed on this side (a save already updates local state via `refresh`
 * immediately after). The OVERLAY side (useOverlayLeaderboard) is the one
 * that needs to learn about edits made here, since it's a separate browser
 * context that could be open for hours during a stream.
 */
export function useLeaderboardLabels(): LeaderboardLabelsState {
  const [labels, setLabels] = useState<LeaderboardLabel[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/leaderboard-labels`)
    setLabels((await res.json()) as LeaderboardLabel[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { labels, loading, refresh }
}
