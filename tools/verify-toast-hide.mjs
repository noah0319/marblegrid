// Regression check for a real bug (2026-08-14): RaceResultToast's hide-timer
// effect used to depend on the whole `event` object, and useLatestEvent
// hands back a brand-new object on every WS 'hello' (every reconnect) even
// when the data hasn't changed. A reconnect mid-display cancelled the live
// hide-timer without rescheduling it, leaving the toast stuck on screen —
// confirmed live on Noah's own OBS, not just in theory. Fixed by depending
// on event?.occurredAt (a primitive) instead. Kept as a standing check
// (run via `npm run verify-toast-hide`) since this exact class of bug
// (object-identity churn silently breaking a cleanup-based timer) could
// recur if this file or useLatestEvent changes again without this history
// in mind — screenshot.mjs can't catch it since it's timing/reconnect-
// dependent, not a static render.
//
// Sequence: load the toast overlay (real historical data means a toast
// shows immediately on load), force a real WebSocket disconnect/reconnect
// partway through its visible window (simulating what happens on stream
// after any real network blip or backend hiccup), then check whether the
// toast is STILL visible well past when it should have hidden itself.
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron')

function killStaleInstances() {
  if (process.platform !== 'win32') return
  try {
    execSync(
      'powershell -NoProfile -Command "Get-Process node,electron -ErrorAction SilentlyContinue | ' +
        "Where-Object { $_.Path -like '*MarbleGrid*04 System*' } | " +
        'Stop-Process -Force -ErrorAction SilentlyContinue"',
      { stdio: 'ignore' }
    )
  } catch {
    // best-effort
  }
}

async function main() {
  killStaleInstances()
  await new Promise((r) => setTimeout(r, 1000))
  const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR], timeout: 30_000 })

  try {
    let page = await app.firstWindow()
    await page.waitForTimeout(1500)
    const windows = app.windows()
    page = windows.find((w) => !w.url().startsWith('devtools://')) ?? page

    // Confirm current real toast duration setting so the timing math below is accurate.
    const settings = await page.evaluate(async () => {
      const res = await fetch('http://127.0.0.1:43117/api/app-settings')
      return res.json()
    })
    const visibleMs = settings.toastDurationMs
    console.log('toastDurationMs:', visibleMs)

    await page.goto('http://127.0.0.1:43117/overlay-toast')
    const startedAt = Date.now()

    const isVisible = async () => page.evaluate(() => !!document.querySelector('.race-toast'))

    await page.waitForTimeout(1000)
    const shownInitially = await isVisible()
    console.log('toast visible right after load:', shownInitially)
    if (!shownInitially) {
      console.log('No historical event to show a toast for — nothing to test. Exiting.')
      return
    }

    // Force a real WS disconnect/reconnect partway through the visible
    // window — this is the exact real-world trigger (useLiveSocket's onclose
    // -> 2s retry -> reconnect -> server sends 'hello' -> useLatestEvent
    // refetches). setOffline(true) at the CDP level kills the live socket
    // (not just blocks new fetches), same as a real network blip would.
    const context = page.context()
    await context.setOffline(true)
    console.log('forced offline at', Date.now() - startedAt, 'ms')
    await page.waitForTimeout(500)
    await context.setOffline(false)
    console.log('back online at', Date.now() - startedAt, 'ms')

    // Give the 2s retry timer + reconnect + 'hello' + refetch cycle time to
    // fully complete, then wait until comfortably PAST the original
    // visibleMs deadline before checking.
    const remaining = visibleMs - (Date.now() - startedAt) + 4000
    if (remaining > 0) await page.waitForTimeout(remaining)

    const stillVisible = await isVisible()
    const elapsed = Date.now() - startedAt
    console.log(`toast visible at ${elapsed}ms (visibleMs was ${visibleMs}ms):`, stillVisible)
    console.log(stillVisible ? 'BUG REPRODUCED — toast is stuck visible' : 'FIX CONFIRMED — toast hid itself correctly despite the mid-display reconnect')
  } finally {
    await app.close().catch(() => {})
    // Real incident (2026-08-14): app.close() resolving does NOT guarantee
    // the underlying electron.exe process tree actually terminated — this
    // exact script once left a zombie behind (worse than usual here, likely
    // because the context.setOffline() cycle above put the app in a less
    // graceful state to quit from), which kept running against Noah's real
    // userData/port and left his OBS stuck showing /overlay-toast as a
    // black page long after this script had "finished." Unconditional
    // force-kill sweep after close(), not just a hope, so a hung close()
    // can never strand a live process pointed at Noah's real app again.
    killStaleInstances()
  }
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
