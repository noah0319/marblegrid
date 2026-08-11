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
import { fileURLToPath } from 'node:url'

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = process.argv[2] || path.join(APP_DIR, 'tools', 'shots')
fs.mkdirSync(OUT_DIR, { recursive: true })

const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(APP_DIR, 'node_modules', 'electron', 'dist', 'electron')

async function main() {
  console.log('Launching', electronBin, 'against', APP_DIR)
  const app = await electron.launch({
    executablePath: electronBin,
    args: [APP_DIR],
    timeout: 30_000
  })

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
  } else {
    console.log('WARNING: could not find Leaderboard nav button to click')
  }

  await app.close()
  console.log('done')
}

main().catch((err) => {
  console.error('FAILED:', err)
  process.exit(1)
})
