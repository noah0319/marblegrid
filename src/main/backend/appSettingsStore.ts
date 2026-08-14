import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'

/**
 * General app/display preferences — deliberately separate from
 * twitch/settingsStore.ts (which is specifically Twitch credentials/tokens,
 * not a general settings bucket). Same hand-rolled JSON pattern for the same
 * reason documented there (electron-store is pure ESM, this main process
 * build is CJS). Lives in its own file in Electron's userData dir.
 */
export interface AppSettings {
  /** How long the OBS result toast stays on screen before hiding — Noah's ask, was a hardcoded 10s constant. */
  toastDurationMs: number
}

const DEFAULTS: AppSettings = {
  toastDurationMs: 10_000
}

let settingsPath: string | null = null
let cache: AppSettings | null = null

export function initAppSettingsStore(path: string): void {
  settingsPath = path
  cache = load()
}

function load(): AppSettings {
  if (!settingsPath || !existsSync(settingsPath)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Partial<AppSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

function persist(): void {
  if (!settingsPath || !cache) return
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(cache, null, 2), 'utf-8')
}

export function getAppSettings(): AppSettings {
  if (!cache) cache = load()
  return cache
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  cache = { ...getAppSettings(), ...patch }
  persist()
  return cache
}
