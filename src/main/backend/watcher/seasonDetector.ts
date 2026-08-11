import { existsSync, readdirSync } from 'fs'
import { openSeasonFromFilename, getOpenSeasonNumber } from '../db/queries/seasons.ts'
import { SESSIONS_DIR } from './paths.ts'

// Matches "season 72.sav", "Season 63.sav", etc. Confirmed real-world evidence
// this needs to be case-insensitive (mixed casing seen in the wild) and
// anchored (the same folder also holds unrelated files like "giveaways.sav"
// and "MarbleFest64.sav" that must never match).
const SEASON_FILE_PATTERN = /^season\s+(\d+)\.sav$/i

export function parseSeasonFilename(fileName: string): number | null {
  const match = SEASON_FILE_PATTERN.exec(fileName)
  return match ? Number(match[1]) : null
}

/**
 * Called whenever chokidar sees a file appear in Sessions\ — both for a
 * genuinely new file during a live stream, and for every pre-existing file
 * during chokidar's startup catch-up burst (emission order not guaranteed).
 * Only ever moves the season number forward, never backward, so catching up
 * on old files in the wrong order can't regress an already-detected season —
 * confirmed real season files have gaps (56-62, 66-68, 71 missing) and
 * inconsistent capitalization, so this can't just trust "the last one seen."
 */
export function handleSessionsFileAdded(fileName: string): void {
  const seasonNumber = parseSeasonFilename(fileName)
  if (seasonNumber === null) return

  const current = getOpenSeasonNumber()
  if (current !== null && seasonNumber <= current) return

  openSeasonFromFilename(seasonNumber, fileName)
}

/**
 * Run once at startup, before the watcher's own catch-up burst arrives: a
 * season rollover could have happened while MarbleGrid wasn't running at all
 * (e.g. a multi-day gap between streams), and only "the highest number
 * present right now" is a trustworthy signal — not "every number ever seen,"
 * since old season files are confirmed to get removed at some point.
 */
export function reconcileSeasonsAtStartup(): void {
  if (!existsSync(SESSIONS_DIR)) return

  let highest: { number: number; fileName: string } | null = null
  for (const fileName of readdirSync(SESSIONS_DIR)) {
    const seasonNumber = parseSeasonFilename(fileName)
    if (seasonNumber === null) continue
    if (!highest || seasonNumber > highest.number) {
      highest = { number: seasonNumber, fileName }
    }
  }

  if (!highest) return
  const current = getOpenSeasonNumber()
  if (current !== null && highest.number <= current) return

  openSeasonFromFilename(highest.number, highest.fileName)
}
