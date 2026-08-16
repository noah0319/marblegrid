import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'
import { useLiveSocket } from './useLiveSocket'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/**
 * Surfaces "a new version finished downloading and will install next time
 * you fully quit" in the desktop window — Noah's ask, after learning the
 * updater itself (updater.ts) only ever logged this to a console nobody
 * would see. Two sources, same reasoning as useLatestEvent's initial-GET +
 * live-WS-push split: the GET on mount covers reopening the window after a
 * download finished while it was closed (tray-resident app, closed for long
 * stretches is normal), the WS push covers the window being open at the
 * exact moment it lands.
 */
export function useUpdateReady(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${BASE}/api/status`)
      if (!res.ok) return
      const data = (await res.json()) as { updateReadyVersion?: string | null }
      if (data.updateReadyVersion) setVersion(data.updateReadyVersion)
    })()
  }, [])

  useLiveSocket(
    useCallback((msg) => {
      if (msg.type === 'update-ready') setVersion(msg.version)
    }, [])
  )

  return version
}
