import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import { DEFAULT_DAY_BOUNDARY_HOUR } from '../../shared/constants.ts'

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
  /**
   * Hour of day (0-23, local time) "today" rolls over at — Noah's ask, was
   * the hardcoded DEFAULT_DAY_BOUNDARY_HOUR constant everywhere (getTodayStats,
   * !mystats, !top10today, the Dashboard's Today toggle). Lets a streamer
   * whose day runs late (e.g. 10am-8pm) set their own reset point (e.g. 9pm)
   * instead of the default 6am splitting a still-live stream in two.
   */
  dayBoundaryHour: number
  /**
   * Whether Battle Royale's high score shows anywhere (Dashboard, the Daily
   * Stats overlay) — Noah's ask: "lots of streamers don't do BRs but some
   * do," so a streamer who never runs that mode isn't stuck with an
   * always-visible "BR HS: 0" tile. Purely a display preference — the
   * backend still tracks/computes brHs regardless, this only controls
   * whether the UI renders it. Defaults true so nothing changes for anyone
   * (including Noah) unless they opt out.
   */
  showBrHs: boolean
}

const DEFAULTS: AppSettings = {
  toastDurationMs: 10_000,
  dayBoundaryHour: DEFAULT_DAY_BOUNDARY_HOUR,
  showBrHs: true
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
