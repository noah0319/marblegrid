// One-shot visual verification tool — launches the BUILT app (run `npm run
// build` first), screenshots each page, closes it. Not part of the shipped
// app; a dev-time tool for confirming UI changes actually render correctly
// instead of just "didn't crash." Kept around since Phase 4 (OBS overlay)
// will want the same kind of check.
//
// Usage: node tools/screenshot.mjs [outDir]
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = process.argv[2] || path.join(APP_DIR, 'tools', 'shots')
fs.mkdirSync(OUT_DIR, { recursive: true })

const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron')

// A previous run of this exact script left zombie electron.exe processes
// behind (a launch that errors/times out doesn't always get cleaned up by
// Playwright), which then squatted on port 43117 and made the NEXT launch
// fail too, silently (see the Phase 4 iteration log). Best-effort cleanup
// before every run so that failure mode can't compound across runs.
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
    // Best-effort — a failed cleanup attempt shouldn't block the actual run.
  }
}

async function main() {
  killStaleInstances()
  await new Promise((r) => setTimeout(r, 1000))
  console.log('Launching', electronBin, 'against', APP_DIR)
  const app = await electron.launch({
    executablePath: electronBin,
    args: [APP_DIR],
    timeout: 30_000
  })

  try {
    await takeShots(app)
  } finally {
    // Always close, even on failure mid-script — an uncaught exception
    // between launch and here is exactly how last time's zombies happened.
    await app.close().catch(() => {})
  }
  console.log('done')
}

async function takeShots(app) {
  // Electron has no clean "ready" signal from the outside — wait for the
  // first real (non-devtools) window, then a beat for React to paint.
  let page = await app.firstWindow()
  await page.waitForTimeout(1500)
  const windows = app.windows()
  console.log(
    'windows:',
    windows.map((w) => w.url())
  )
  page = windows.find((w) => !w.url().startsWith('devtools://')) ?? page

  await page.waitForSelector('text=MARBLEGRID', { timeout: 15_000 }).catch(() => {
    console.log('WARNING: brand mark not found within 15s — screenshotting whatever is there anyway')
  })

  const dashboardShot = path.join(OUT_DIR, '01-dashboard.png')
  await page.screenshot({ path: dashboardShot })
  console.log('screenshot:', dashboardShot)

  // Click into Leaderboard via DOM click (matches the run skill's guidance —
  // robust regardless of window layering) and screenshot that too.
  const clicked = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const btn = buttons.find((b) => b.textContent?.trim() === 'Leaderboard')
    if (!btn) return false
    btn.click()
    return true
  })
  if (clicked) {
    await page.waitForTimeout(800)
    const leaderboardShot = path.join(OUT_DIR, '02-leaderboard.png')
    await page.screenshot({ path: leaderboardShot })
    console.log('screenshot:', leaderboardShot)

    // Full-page too: the real leaderboard now has 100+ rows, so the
    // giveaway-labels card (Noah's ask) added below the table sits well
    // below the fold in a normal viewport screenshot.
    const leaderboardFullShot = path.join(OUT_DIR, '02-leaderboard-full.png')
    await page.screenshot({ path: leaderboardFullShot, fullPage: true })
    console.log('screenshot:', leaderboardFullShot)
  } else {
    console.log('WARNING: could not find Leaderboard nav button to click')
  }

  // Maps (renamed from the old flat "Ghost Balls" page, now tabbed: Ghost
  // Ball / History / Notes / Community). Click into the nav item, then click
  // through each tab and screenshot every one — the whole point of this
  // restructure was the extra tabs, so each needs its own real render check,
  // not just "the page opened."
  const clickedMaps = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const btn = buttons.find((b) => b.textContent?.trim() === 'Maps')
    if (!btn) return false
    btn.click()
    return true
  })
  if (clickedMaps) {
    await page.waitForTimeout(800)
    await page.screenshot({ path: path.join(OUT_DIR, '02c-maps-ghostball.png') })
    console.log('screenshot:', path.join(OUT_DIR, '02c-maps-ghostball.png'))

    async function clickTabAndShoot(label, outName) {
      const clickedTab = await page.evaluate((l) => {
        const buttons = [...document.querySelectorAll('button')]
        const btn = buttons.find((b) => b.textContent?.trim() === l)
        if (!btn) return false
        btn.click()
        return true
      }, label)
      if (!clickedTab) {
        console.log(`WARNING: could not find "${label}" tab button to click`)
        return
      }
      await page.waitForTimeout(800)
      const shot = path.join(OUT_DIR, outName)
      await page.screenshot({ path: shot })
      console.log('screenshot:', shot)
    }

    await clickTabAndShoot('History', '02d-maps-history.png')
    await clickTabAndShoot('Notes', '02e-maps-notes.png')
    await clickTabAndShoot('Community', '02f-maps-community.png')
  } else {
    console.log('WARNING: could not find Maps nav button to click')
  }

  // Phase 5: Settings now has real Twitch-connect controls. Confirm the
  // status API returns sane defaults (nothing connected, auto-post off)
  // before screenshotting so a rendering bug and a bad default can't be
  // confused for each other.
  const twitchStatus = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:43117/api/twitch/status')
    return { ok: res.ok, body: await res.json() }
  })
  console.log('twitch status:', JSON.stringify(twitchStatus))

  const clickedSettings = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')]
    const btn = buttons.find((b) => b.textContent?.trim() === 'Settings')
    if (!btn) return false
    btn.click()
    return true
  })
  if (clickedSettings) {
    await page.waitForTimeout(800)
    const settingsShot = path.join(OUT_DIR, '02b-settings.png')
    await page.screenshot({ path: settingsShot })
    console.log('screenshot:', settingsShot)

    // Settings keeps growing (Twitch connection, chat posting, chat
    // commands, stats) — full-page screenshot so new cards at the bottom
    // (like the chat commands list) actually get looked at, not just
    // whatever fits above the fold.
    const settingsFullShot = path.join(OUT_DIR, '02b-settings-full.png')
    await page.screenshot({ path: settingsFullShot, fullPage: true })
    console.log('screenshot:', settingsFullShot)
  } else {
    console.log('WARNING: could not find Settings nav button to click')
  }

  // Phase 4: the overlay is a plain HTTP page now (that's the whole point —
  // OBS needs a URL), so navigate the same window to it directly rather than
  // needing a second Electron window. Two separate pages now (split into
  // independent Browser Sources per Noah's request), each screenshotted on
  // its own — that's the actual thing to verify, that each renders
  // correctly in isolation, not just combined. Inject a fake "gameplay"
  // backdrop first so transparency/legibility can actually be judged — a
  // raw transparent PNG is hard to eyeball meaningfully on its own.
  async function shootOverlay(url, outName) {
    await page.goto(url)
    await page.waitForTimeout(1500)
    await page.evaluate(() => {
      const backdrop = document.createElement('div')
      backdrop.style.position = 'fixed'
      backdrop.style.inset = '0'
      backdrop.style.zIndex = '-1'
      backdrop.style.background = 'linear-gradient(135deg, #2b5876, #4e4376 40%, #1f4037 70%, #99f2c8)'
      document.body.prepend(backdrop)
    })
    const shot = path.join(OUT_DIR, outName)
    await page.screenshot({ path: shot })
    console.log('screenshot:', shot)
  }

  await shootOverlay('http://127.0.0.1:43117/overlay-toast', '03a-overlay-toast-simulated.png')
  await shootOverlay('http://127.0.0.1:43117/overlay-daily-stats', '03c-overlay-daily-stats-simulated.png')

  // Giveaway labels (Noah's ask): set a real one via the API, confirm it
  // actually shows up on the live overlay, then put back whatever was
  // REALLY there before — never assume it was blank. A real incident:
  // Noah had a genuine "NFT" label on rank 1 for an actual giveaway, and an
  // earlier version of this script blindly cleared rank 1 to blank
  // afterward instead of restoring it, wiping his real data. Read-then-
  // restore, not set-then-blank.
  const existingLabels = await page.evaluate(async () => {
    const res = await fetch('http://127.0.0.1:43117/api/leaderboard-labels')
    return res.json()
  })
  const originalRank1 = existingLabels.find((l) => l.rankPosition === 1)?.labelText ?? ''

  await page.evaluate(async () => {
    await fetch('http://127.0.0.1:43117/api/leaderboard-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rankPosition: 1, labelText: 'iPad (test)' })
    })
  })
  await shootOverlay('http://127.0.0.1:43117/overlay-leaderboard', '03b-overlay-leaderboard-simulated.png')
  await page.evaluate(async (restoreText) => {
    await fetch('http://127.0.0.1:43117/api/leaderboard-labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rankPosition: 1, labelText: restoreText })
    })
  }, originalRank1)
  console.log(`restored rank 1 label to: "${originalRank1}"`)
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
