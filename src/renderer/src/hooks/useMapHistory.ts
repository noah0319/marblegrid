import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { MapHistoryEntry } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapHistoryState {
  entries: MapHistoryEntry[]
  loading: boolean
}

/** Read-only — history is a derived report, nothing to edit here directly (overrides are edited from the Ghost Ball tab). */
export function useMapHistory(): MapHistoryState {
  const [entries, setEntries] = useState<MapHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/map-history`)
    setEntries((await res.json()) as MapHistoryEntry[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useLiveSocket(
    useCallback(
      (msg) => {
        if (msg.type === 'race-event') void refresh()
      },
      [refresh]
    )
  )

  return { entries, loading }
}
