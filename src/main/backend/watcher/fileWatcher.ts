import { watch, type FSWatcher } from 'chokidar'
import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { captureRawSnapshot } from './rawCapture.ts'
import { ingestRaceFiles } from './parsers/race.ts'
import { ingestTiltFiles } from './parsers/tilt.ts'
import { ingestRoyaleFile } from './parsers/royale.ts'
import { handleSessionsFileAdded } from './seasonDetector.ts'
import { MARBLES_SAVE_DIR, SESSIONS_DIR } from './paths.ts'

const TYPED_FILES: Record<string, 'race' | 'tilt' | 'royale'> = {
  'LastSeasonRaceSummary.csv': 'race',
  'LastSeasonRace.csv': 'race',
  'LastTiltLevel.csv': 'tilt',
  'LastTiltLevelPlayers.csv': 'tilt',
  'LastSeasonRoyale.csv': 'royale'
}

// Captured to the raw-snapshot safety net only — no typed table yet (see
// 01 Architecture & Design). LastRaceNumbersHit.csv has never been observed
// with real data; LastCustomRaceMapPlayed.csv and LastWatchedMarble.csv are
// explicitly out of v1 scope.
const RAW_ONLY_FILES = ['LastRaceNumbersHit.csv', 'LastCustomRaceMapPlayed.csv', 'LastWatchedMarble.csv']

const ALL_WATCHED_FILENAMES = [...Object.keys(TYPED_FILES), ...RAW_ONLY_FILES]

let watcher: FSWatcher | null = null

export function startWatcher(): void {
  if (!existsSync(MARBLES_SAVE_DIR)) {
    // eslint-disable-next-line no-console
    console.warn(
      `MarbleGrid: game save folder not found at ${MARBLES_SAVE_DIR} — is Marbles on Stream installed and has it been run at least once?`
    )
  }

  const watchTargets = [...ALL_WATCHED_FILENAMES.map((f) => `${MARBLES_SAVE_DIR}\\${f}`), SESSIONS_DIR]

  // ignoreInitial: false is deliberate — it's what gives us "catch-up on
  // whatever happened while MarbleGrid was closed" for free. Combined with
  // captureRawSnapshot's hash-based dedupe, a file whose content hasn't
  // actually changed since we last saw it is a no-op; a file that's genuinely
  // different (or new) gets processed exactly like a live event would be.
  watcher = watch(watchTargets, {
    ignoreInitial: false,
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 }
  })

  watcher.on('add', (filePath) => void handleFsEvent(filePath))
  watcher.on('change', (filePath) => void handleFsEvent(filePath))
  watcher.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('MarbleGrid watcher error:', err)
  })
}

export function stopWatcher(): void {
  watcher?.close()
  watcher = null
}

// A watched file whose mtime is older than this, the first time MarbleGrid
// ever observes its content (no prior raw_snapshot to dedupe against), is
// treated as pre-existing leftover data rather than a live event — a real
// bug, not a hypothetical: confirmed via Noah's actual LastSeasonRoyale.csv,
// last written 49 DAYS before MarbleGrid's first-ever startup catch-up scan
// saw it. `ignoreInitial: false` (deliberately, so a race that finished
// while the app was closed still gets caught up on reopen) fired an `add`
// event for it exactly like a live change, and with no earlier hash stored
// yet to dedupe against, it was ingested as if it had JUST happened —
// stamped with today's date and wrongly crediting season 72's BR HS with
// 400 phantom points from a race that hadn't been played since June.
//
// 72 hours is deliberately generous — it needs to comfortably cover "closed
// the app after one stream, reopened a few days later for the next one"
// (still a legitimate catch-up), while confidently excluding data that's
// been sitting stale for weeks. The actual bad file was 49 DAYS old, so
// there's a wide margin between a realistic gap-between-streams and what
// this is actually guarding against. Only applies to the FIRST time a file's
// content is ever seen (isNew from captureRawSnapshot) — a live `change`
// event during normal operation is never affected, since the game only ever
// writes a file's mtime as "just now".
const STALE_CATCHUP_THRESHOLD_MS = 72 * 60 * 60 * 1000

/** Pure so this is directly unit-testable without touching the filesystem — see fileWatcher.test.ts. */
export function isTooStaleForCatchup(mtimeMs: number, nowMs: number): boolean {
  return nowMs - mtimeMs > STALE_CATCHUP_THRESHOLD_MS
}

async function handleFsEvent(filePath: string): Promise<void> {
  const fileName = filePath.split(/[/\\]/).pop() ?? ''

  if (filePath.startsWith(SESSIONS_DIR)) {
    handleSessionsFileAdded(fileName)
    return
  }

  if (!ALL_WATCHED_FILENAMES.includes(fileName)) return

  try {
    const [text, stats] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])
    const isNew = captureRawSnapshot(fileName, text)
    if (!isNew) return

    if (isTooStaleForCatchup(stats.mtime.getTime(), Date.now())) {
      const ageHours = Math.round((Date.now() - stats.mtime.getTime()) / 3_600_000)
      // eslint-disable-next-line no-console
      console.warn(
        `MarbleGrid: ${fileName} is ~${ageHours}h old — captured to raw_snapshots but skipped as a live event (too stale to be "what happened while closed").`
      )
      return
    }

    const kind = TYPED_FILES[fileName]
    if (kind === 'race') await ingestRaceFiles()
    else if (kind === 'tilt') await ingestTiltFiles()
    else if (kind === 'royale') await ingestRoyaleFile()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`MarbleGrid: failed to process ${fileName}:`, err)
  }
}
