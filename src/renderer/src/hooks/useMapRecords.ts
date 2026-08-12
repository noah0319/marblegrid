import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { MapRecord } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapRecordsState {
  records: MapRecord[]
  loading: boolean
  /** Manual re-fetch — needed after setting/clearing an override, which isn't a race-event the WebSocket would otherwise push. */
  refresh: () => Promise<void>
}

/**
 * Fetches map records once on mount, then re-fetches whenever the backend
 * pushes a new race — matches useStats' pattern. Tilt/Royale events don't
 * affect map records (no "map"/finish-time concept in those modes), so only
 * race-event triggers a refresh here.
 */
export function useMapRecords(): MapRecordsState {
  const [records, setRecords] = useState<MapRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/map-records`)
    setRecords((await res.json()) as MapRecord[])
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

  return { records, loading, refresh }
}
