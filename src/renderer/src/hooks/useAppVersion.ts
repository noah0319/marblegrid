import { useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

/**
 * Fetched once on mount — the running version can't change mid-session (it's
 * baked into the build), so there's no need for live refresh the way most
 * other hooks in this app have. Null until the first fetch resolves, so the
 * sidebar just omits the tag rather than flashing a placeholder.
 */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const res = await fetch(`${BASE}/api/status`)
      if (!res.ok) return
      const data = (await res.json()) as { version?: string }
      setVersion(data.version ?? null)
    })()
  }, [])

  return version
}
