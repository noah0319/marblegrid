import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { MapCommunityStat } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapCommunityState {
  stats: MapCommunityStat[]
  loading: boolean
}

/** Read-only — no override/edit action on this tab, so no `refresh` export needed (unlike useMapRecords/useMapNotes). */
export function useMapCommunity(): MapCommunityState {
  const [stats, setStats] = useState<MapCommunityStat[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/map-community`)
    setStats((await res.json()) as MapCommunityStat[])
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

  return { stats, loading }
}
