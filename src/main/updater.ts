import { autoUpdater } from 'electron-updater'
import { broadcast } from './backend/ws.ts'
import { markQuitting } from './appLifecycle.ts'

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
 * Real report (2026-08-16): someone force-closed MarbleGrid via Task
 * Manager after a download finished, reopened it, and was still on the old
 * version. Root cause — autoInstallOnAppQuit only fires on a REAL app.quit()
 * sequence; Task Manager's "End Task" on a tray-backgrounded app (no
 * visible top-level window left once it's hidden, not closed — see
 * index.ts) skips straight to killing the process, no graceful quit at
 * all. Right-click-tray "Quit" would have worked, but that's not something
 * a non-technical user reliably finds. This gives them a direct button
 * instead (wired to the update-ready banner) that deterministically
 * installs, rather than hoping they discover the tray menu.
 *
 * markQuitting() first is required, not optional: electron-updater's own
 * docs say quitAndInstall() closes windows BEFORE emitting 'before-quit'
 * (opposite order from a normal app.quit()) — index.ts's window still
 * needs to see isQuitting() as true when ITS close handler runs, or it'll
 * just hide again instead of actually letting the quit proceed.
 *
 * isSilent=true, isForceRunAfter=true: no installer UI flash (matches
 * "click one button, it just works" — this app doesn't otherwise show
 * NSIS UI), and relaunch automatically once done rather than leaving Noah
 * or a viewer staring at a closed app wondering if it worked.
 */
export function installUpdateNow(): void {
  markQuitting()
  autoUpdater.quitAndInstall(true, true)
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
 * version in the background without any visible interruption, and by
 * default the actual swap only happens on a normal quit — never a forced
 * mid-session restart that would drop the file watcher or the Twitch
 * connection while Noah might be live. Noah (or a recipient) decides when
 * to restart, whether that's naturally via the tray's Quit item, an
 * explicit "Restart & Update Now" click on the banner (installUpdateNow,
 * below), or Windows' own reboot schedule; MarbleGrid never decides that
 * for them.
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
