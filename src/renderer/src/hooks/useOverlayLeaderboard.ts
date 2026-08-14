import { useCallback, useEffect, useRef, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { LeaderboardRow, LeaderboardLabel } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

export interface OverlayLeaderboardRow extends LeaderboardRow {
  /**
   * Positive = moved up (better) since the last refresh, negative = moved
   * down, 0 = same spot. Null on the very first fetch (nothing to compare
   * against yet) or if this racer wasn't in the visible top 5 last time
   * (jumped in from outside it — a real rank delta isn't knowable since
   * their prior position was never observed).
   */
  rankDelta: number | null
  /** Points gained since the last refresh. Null under the same conditions as rankDelta. */
  pointsDelta: number | null
}

export interface OverlayLeaderboardState {
  rows: OverlayLeaderboardRow[]
  /** Index-aligned with rows (labels[0] is 1st place's giveaway label, etc.) — always length 5, blank string where Noah hasn't set one. */
  labels: string[]
}

interface Snapshot {
  rank: number
  points: number
}

/**
 * Just the top 5, for the overlay's corner ticker — a lean dedicated fetch
 * (limit=5 server-side, not 20 sliced client-side) rather than reusing the
 * dashboard's useStats, which also pulls season/today stats this page has
 * no use for. Matters more here than on the desktop app: this page can run
 * for hours during a live stream.
 *
 * Also computes rank/points deltas between consecutive fetches (Noah's ask:
 * highlight movers, show a "+N" popup) by keeping the previous snapshot in a
 * ref — deliberately NOT in React state, since updating it must never itself
 * trigger a re-render. A fresh page load has nothing to compare against, so
 * the first fetch always reports null deltas (no highlight flash on initial
 * load, only on real subsequent changes).
 *
 * Also fetches the giveaway labels (Noah's ask) and refreshes them on the
 * leaderboard-labels-changed WS push — this page is a separate browser
 * context (an OBS Browser Source) that could be open for hours, so an edit
 * made from the desktop app needs to reach it live, not just on next reload.
 *
 * Both refresh on 'hello' too, which the server sends on EVERY new
 * connection, not just the first ever one. Real bug this fixes: the socket
 * itself reconnects fine after the backend restarts (useLiveSocket's own
 * retry timer), but reconnecting alone doesn't mean anything NEW happened —
 * without this, the overlay stays frozen on whatever it fetched before the
 * drop until a genuinely new race or label edit occurs, which on an
 * unattended OBS source could be a long wait. Confirmed live: Noah's real
 * overlay was showing stale points/standings from well before a restart
 * while the backend's own data was already correct.
 */
export function useOverlayLeaderboard(): OverlayLeaderboardState {
  const [rows, setRows] = useState<OverlayLeaderboardRow[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const previousRef = useRef<Map<string, Snapshot> | null>(null)

  const refreshRows = useCallback(async () => {
    const res = await fetch(`${BASE}/api/leaderboard?limit=5`)
    if (!res.ok) return
    const data = (await res.json()) as LeaderboardRow[]

    const previous = previousRef.current
    const withDeltas: OverlayLeaderboardRow[] = data.map((row, index) => {
      const prior = previous?.get(row.username)
      return {
        ...row,
        rankDelta: prior ? prior.rank - (index + 1) : null,
        pointsDelta: prior ? row.totalPoints - prior.points : null
      }
    })

    previousRef.current = new Map(data.map((row, index) => [row.username, { rank: index + 1, points: row.totalPoints }]))
    setRows(withDeltas)
  }, [])

  const refreshLabels = useCallback(async () => {
    const res = await fetch(`${BASE}/api/leaderboard-labels`)
    if (!res.ok) return
    const data = (await res.json()) as LeaderboardLabel[]
    setLabels([...data].sort((a, b) => a.rankPosition - b.rankPosition).map((l) => l.labelText))
  }, [])

  useEffect(() => {
    void refreshRows()
    void refreshLabels()
  }, [refreshRows, refreshLabels])

  useLiveSocket(
    useCallback(
      (msg) => {
        if (
          msg.type === 'race-event' ||
          msg.type === 'tilt-event' ||
          msg.type === 'royale-event' ||
          msg.type === 'hello'
        ) {
          void refreshRows()
        }
        if (msg.type === 'leaderboard-labels-changed' || msg.type === 'hello') {
          void refreshLabels()
        }
      },
      [refreshRows, refreshLabels]
    )
  )

  return { rows, labels }
}
