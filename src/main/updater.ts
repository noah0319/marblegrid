import { autoUpdater } from 'electron-updater'
import { broadcast } from './backend/ws.ts'

/**
 * Set once a download finishes, read by GET /api/status so the desktop
 * window can show the banner even if it was closed (tray-resident app) when
 * the download actually completed — the live WS push alone only reaches a
 * window that happens to be open at that exact moment.
 */
let updateReadyVersion: string | null = null

export function getUpdateReadyVersion(): string | null {
  return updateReadyVersion
}

/**
 * Noah's ask: push updates without everyone having to redownload and
 * reinstall a new .exe by hand. Publishes to GitHub Releases (see
 * package.json's build.publish config); electron-updater checks that feed,
 * downloads silently in the background, and installs automatically —
 * but only ever on the NEXT time Noah quits the app himself.
 *
 * Deliberately conservative here, same "never risk the live stream"
 * discipline as everything else in this app: autoDownload fetches the new
 * version in the background without any visible interruption, but
 * autoInstallOnAppQuit means the actual swap only happens on a normal quit
 * — never a forced mid-session restart that would drop the file watcher or
 * the Twitch connection while Noah might be live. Noah decides when to
 * restart (or Windows does, on its own reboot schedule); MarbleGrid never
 * decides that for him.
 *
 * Only called from index.ts when app.isPackaged is true — checking for
 * updates in dev mode has no real feed to check against and electron-updater
 * isn't meant to run there (see forceDevUpdateConfig in its own docs).
 */
export function initAutoUpdater(): void {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  // Everything below is still logged to console for debugging, but
  // 'update-downloaded' now also surfaces a real, visible banner in the
  // desktop window (Layout.tsx via useUpdateReady) — Noah's ask, after
  // finding out the console-only version gave him nothing to actually watch
  // happen. Deliberately only THIS event gets a banner, not
  // 'update-available' or the check itself — "ready to install" is the one
  // moment that's actually actionable; anything earlier is just noise on a
  // background process nobody needs to babysit.
  autoUpdater.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.log('[auto-update] error:', err.message)
  })
  autoUpdater.on('update-available', (info) => {
    // eslint-disable-next-line no-console
    console.log('[auto-update] update available:', info.version)
  })
  autoUpdater.on('update-not-available', () => {
    // eslint-disable-next-line no-console
    console.log('[auto-update] already on the latest version')
  })
  autoUpdater.on('update-downloaded', (info) => {
    // eslint-disable-next-line no-console
    console.log('[auto-update] downloaded, will install next time the app quits:', info.version)
    updateReadyVersion = info.version
    broadcast({ type: 'update-ready', version: info.version })
  })

  // Fire-and-forget: a failed update check must never block or crash
  // startup — core race-tracking can't depend on GitHub being reachable.
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.log('[auto-update] check failed:', err instanceof Error ? err.message : String(err))
  })
}
