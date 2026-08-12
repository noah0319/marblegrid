import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { MapNote } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapNotesState {
  notes: MapNote[]
  loading: boolean
  /** Manual re-fetch — needed after saving a note, which isn't a race-event the WebSocket would otherwise push. */
  refresh: () => Promise<void>
}

/** Same fetch-on-mount + refresh-on-race-event pattern as useMapRecords — a brand new map only shows up here after a race-event refresh. */
export function useMapNotes(): MapNotesState {
  const [notes, setNotes] = useState<MapNote[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/map-notes`)
    setNotes((await res.json()) as MapNote[])
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

  return { notes, loading, refresh }
}
