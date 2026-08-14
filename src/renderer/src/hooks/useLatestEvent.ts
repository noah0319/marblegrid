import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { LatestEventSummary } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/**
 * Fetches the most recent Race/Tilt/Royale event, refreshed on any live WS
 * push — including 'hello', which the server sends on EVERY new connection,
 * not just the first ever one. That matters: useLiveSocket's reconnect
 * timer means the socket itself recovers fine after the backend restarts,
 * but reconnecting alone doesn't imply anything NEW happened — without
 * treating 'hello' as a refresh trigger too, this stays frozen on
 * whatever it last fetched before the drop until a genuinely new event
 * occurs, which could be a long wait on an OBS source sitting unattended
 * for hours. Safe to do: RaceResultToast dedupes by occurredAt, so
 * re-fetching the same still-latest event on reconnect never re-triggers
 * the pop-in animation.
 */
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
        if (
          msg.type === 'race-event' ||
          msg.type === 'tilt-event' ||
          msg.type === 'royale-event' ||
          msg.type === 'hello'
        ) {
          void refresh()
        }
      },
      [refresh]
    )
  )

  return event
}
