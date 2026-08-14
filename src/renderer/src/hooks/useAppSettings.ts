import { useCallback, useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

export interface AppSettings {
  toastDurationMs: number
}

const DEFAULTS: AppSettings = { toastDurationMs: 10_000 }

interface AppSettingsState {
  settings: AppSettings
  loading: boolean
  refresh: () => Promise<void>
}

/** General display preferences (currently just toastDurationMs) — separate from Twitch connection settings. */
export function useAppSettings(): AppSettingsState {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/app-settings`)
    if (!res.ok) return
    setSettings((await res.json()) as AppSettings)
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { settings, loading, refresh }
}
