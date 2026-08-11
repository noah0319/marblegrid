import { useEffect, useRef } from 'react'
import { SERVER_PORT } from '@shared/constants'
import type { WsMessage } from '@shared/types'

/**
 * Subscribes to the backend's push channel for the lifetime of the
 * component. Reconnects automatically if the connection drops (the backend
 * process outliving window show/hide is exactly why this needs to be
 * resilient, not a one-shot connection).
 */
export function useLiveSocket(onMessage: (msg: WsMessage) => void): void {
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  useEffect(() => {
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false

    function connect(): void {
      socket = new WebSocket(`ws://127.0.0.1:${SERVER_PORT}`)

      socket.onmessage = (event: MessageEvent<string>) => {
        try {
          const msg = JSON.parse(event.data) as WsMessage
          handlerRef.current(msg)
        } catch {
          // Malformed frame — ignore rather than crash the UI over it.
        }
      }

      socket.onclose = () => {
        if (!cancelled) {
          retryTimer = setTimeout(connect, 2000)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      socket?.close()
    }
  }, [])
}
