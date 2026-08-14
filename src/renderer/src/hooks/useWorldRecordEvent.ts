import { useCallback, useState } from 'react'
import type { WorldRecordPayload } from '@shared/types'
import { useLiveSocket } from './useLiveSocket'

export interface WorldRecordEvent extends WorldRecordPayload {
  /** Client-side receive stamp — lets the toast dedupe "the same event delivered twice" the same way RaceResultToast dedupes on occurredAt, since this payload has no server-assigned id/timestamp of its own. */
  receivedAt: number
}

/**
 * Purely a live WS push (see WorldRecordPayload) — no REST fetch, no
 * catch-up on mount. A world record is a "just happened" broadcast moment,
 * not state to restore on page load; missing it because the overlay wasn't
 * open is the same limitation any live broadcast graphic has, and the chat
 * post (customMapPlayed.ts) still announces it either way.
 */
export function useWorldRecordEvent(): WorldRecordEvent | null {
  const [event, setEvent] = useState<WorldRecordEvent | null>(null)

  useLiveSocket(
    useCallback((msg) => {
      if (msg.type === 'world-record-event') {
        const { type: _type, ...payload } = msg
        setEvent({ ...payload, receivedAt: Date.now() })
      }
    }, [])
  )

  return event
}
