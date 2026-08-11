import { watch, type FSWatcher } from 'chokidar'
import { readFile } from 'fs/promises'
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

async function handleFsEvent(filePath: string): Promise<void> {
  const fileName = filePath.split(/[/\\]/).pop() ?? ''

  if (filePath.startsWith(SESSIONS_DIR)) {
    handleSessionsFileAdded(fileName)
    return
  }

  if (!ALL_WATCHED_FILENAMES.includes(fileName)) return

  try {
    const text = await readFile(filePath, 'utf-8')
    const isNew = captureRawSnapshot(fileName, text)
    if (!isNew) return

    const kind = TYPED_FILES[fileName]
    if (kind === 'race') await ingestRaceFiles()
    else if (kind === 'tilt') await ingestTiltFiles()
    else if (kind === 'royale') await ingestRoyaleFile()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`MarbleGrid: failed to process ${fileName}:`, err)
  }
}
