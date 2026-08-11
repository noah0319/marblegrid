import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { LatestEventSummary } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/** Fetches the most recent Race/Tilt/Royale event, refreshed on any live WS push. */
export function useLatestEvent(): LatestEventSummary | null {
  const [event, setEvent] = useState<LatestEventSummary | null>(null)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/latest-event`)
    if (!res.ok) return
    const data = (await res.json()) as LatestEventSummary | null
    setEvent(data)
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

  return event
}
