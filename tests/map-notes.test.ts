import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { getMapNotes, setMapNote } from '../src/main/backend/db/queries/mapNotes.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

// Same minimal synthetic-race shape as map-records.test.ts — kept local
// rather than shared, matching this test suite's existing convention.
function syntheticRace(opts: {
  snapshotId: string
  mapName: string
  mapCreator?: string
  winnerTime: number
  winnerName: string
}): { summary: string; participants: string } {
  const summary =
    `SchemaVersion,SnapshotId,GeneratedAtUtc,Status,GameMode,SessionType,MapName,MapCreator,PlayerCount,FinishedCount,EliminatedCount,WinnerPlatform,WinnerUsername\n` +
    `4,${opts.snapshotId},2026-08-10T16:59:03.229Z,Final,Custom Map Race,Qualifying,${opts.mapName},${opts.mapCreator ?? 'zim2325'},1,1,0,Twitch,${opts.winnerName}\n`
  const participants =
    `SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\n` +
    `${opts.snapshotId},1,${opts.winnerName.toLowerCase()},${opts.winnerName},Twitch,FFFFFFFF,4000,4000,1,1,${opts.winnerTime.toFixed(6)},false\n`
  return { summary, participants }
}

test('a played map with no note shows up blank rather than missing entirely', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire"

  const notes = getMapNotes()
  assert.equal(notes.length, 1)
  assert.equal(notes[0]?.mapName, 'feel the fire')
  assert.equal(notes[0]?.noteText, '')
  assert.equal(notes[0]?.updatedAt, null)
})

test('a map that has never been played does not appear — notes are for known maps only', () => {
  assert.equal(getMapNotes().length, 0)
})

test('setting a note attaches it to the right map with a real updated timestamp', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  setMapNote({
    mapName: 'feel the fire',
    mapCreator: 'zim2325',
    noteText: 'Shortcut near the start — cut left at the second gate.'
  })

  const note = getMapNotes().find((n) => n.mapName === 'feel the fire')
  assert.equal(note?.noteText, 'Shortcut near the start — cut left at the second gate.')
  assert.ok(note?.updatedAt)
})

test('saving blank text clears an existing note rather than storing an empty one', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  setMapNote({ mapName: 'feel the fire', mapCreator: 'zim2325', noteText: 'temporary note' })

  setMapNote({ mapName: 'feel the fire', mapCreator: 'zim2325', noteText: '   ' }) // whitespace-only

  const note = getMapNotes().find((n) => n.mapName === 'feel the fire')
  assert.equal(note?.noteText, '')
  assert.equal(note?.updatedAt, null, 'clearing a note should also clear its updated date, not leave a stale one behind')
})

test('setting a note twice replaces it rather than stacking two rows', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  setMapNote({ mapName: 'feel the fire', mapCreator: 'zim2325', noteText: 'first draft' })
  setMapNote({ mapName: 'feel the fire', mapCreator: 'zim2325', noteText: 'corrected note' })

  const matches = getMapNotes().filter((n) => n.mapName === 'feel the fire')
  assert.equal(matches.length, 1)
  assert.equal(matches[0]?.noteText, 'corrected note')
})

test('a note saved under different capitalization still attaches to the same known map, not a phantom second entry', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire" / zim2325

  // Same capitalization-inconsistency risk documented in getMapRecords.
  setMapNote({ mapName: 'Feel The Fire', mapCreator: 'ZIM2325', noteText: 'chat loves this one' })

  const notes = getMapNotes()
  assert.equal(notes.length, 1, 'must merge into the one known map, not create a second row')
  assert.equal(notes[0]?.noteText, 'chat loves this one')
})

test('a map played twice under different capitalization still gets exactly one note row', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire"
  const recapped = syntheticRace({
    snapshotId: '11111111-1111-1111-1111-111111111111',
    mapName: 'Feel The Fire',
    winnerTime: 100,
    winnerName: 'FasterRacer'
  })
  ingestRaceFromText(recapped.summary, recapped.participants)

  assert.equal(getMapNotes().length, 1)
})

test('notes are tracked per map — a note on one map does not appear on another', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire"
  const otherMap = syntheticRace({
    snapshotId: '22222222-2222-2222-2222-222222222222',
    mapName: 'a different map',
    winnerTime: 45,
    winnerName: 'OtherMapRacer'
  })
  ingestRaceFromText(otherMap.summary, otherMap.participants)

  setMapNote({ mapName: 'feel the fire', mapCreator: 'zim2325', noteText: 'note for feel the fire only' })

  const different = getMapNotes().find((n) => n.mapName === 'a different map')
  assert.equal(different?.noteText, '')
})
