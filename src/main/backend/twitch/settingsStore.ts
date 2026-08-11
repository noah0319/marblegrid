import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { AccessToken } from '@twurple/auth'

/**
 * Hand-rolled JSON settings persistence instead of the `electron-store`
 * dependency the original plan called for — that package is pure ESM
 * (`"type": "module"`, no CJS export), and electron-vite's main-process
 * build is CJS (confirmed by `__dirname` working elsewhere in this
 * codebase). Same class of problem `better-sqlite3` hit in Phase 0. Our
 * actual needs here are three fields and a token blob — not enough to
 * justify the dependency or the ESM/CJS risk. Never in the vault or git;
 * lives in Electron's userData dir, same as the SQLite db.
 */
export interface TwitchSettings {
  clientId: string
  clientSecret: string
  autoPostEnabled: boolean
  token: AccessToken | null
  userId: string | null
  login: string | null
}

const DEFAULTS: TwitchSettings = {
  clientId: '',
  clientSecret: '',
  autoPostEnabled: false,
  token: null,
  userId: null,
  login: null
}

let settingsPath: string | null = null
let cache: TwitchSettings | null = null

export function initSettingsStore(path: string): void {
  settingsPath = path
  cache = load()
}

function load(): TwitchSettings {
  if (!settingsPath || !existsSync(settingsPath)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Partial<TwitchSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    // A corrupt settings file shouldn't crash the app — fall back to
    // defaults (Noah just has to reconnect Twitch, not reinstall).
    return { ...DEFAULTS }
  }
}

function persist(): void {
  if (!settingsPath || !cache) return
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(cache, null, 2), 'utf-8')
}

export function getSettings(): TwitchSettings {
  if (!cache) cache = load()
  return cache
}

export function updateSettings(patch: Partial<TwitchSettings>): TwitchSettings {
  cache = { ...getSettings(), ...patch }
  persist()
  return cache
}
