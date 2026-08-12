import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { getMapRecordHistory } from '../src/main/backend/db/queries/mapHistory.ts'
import { setMapRecordOverride } from '../src/main/backend/db/queries/mapRecords.ts'

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

test("the real fixture's first-ever finish on a map is one history entry with nothing before it", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'feel the fire')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.racerName, 'schoklad')
  assert.equal(entries[0]?.timeSeconds, 133.391144)
  assert.equal(entries[0]?.previousTimeSeconds, null)
  assert.equal(entries[0]?.previousRacerName, null)
  assert.equal(entries[0]?.isManualOverride, false)
})

test('a later faster race adds a new history entry crediting what it beat', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s

  const faster = syntheticRace({
    snapshotId: '11111111-1111-1111-1111-111111111111',
    mapName: 'feel the fire',
    winnerTime: 120,
    winnerName: 'FastRacer'
  })
  ingestRaceFromText(faster.summary, faster.participants)

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'feel the fire')
  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.racerName, 'FastRacer', 'newest-first ordering')
  assert.equal(entries[0]?.timeSeconds, 120)
  assert.equal(entries[0]?.previousTimeSeconds, 133.391144)
  assert.equal(entries[0]?.previousRacerName, 'schoklad')
  assert.equal(entries[1]?.racerName, 'schoklad')
})

test('a later slower race does NOT add a history entry — the record was never actually beaten', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s

  const slower = syntheticRace({
    snapshotId: '22222222-2222-2222-2222-222222222222',
    mapName: 'feel the fire',
    winnerTime: 200,
    winnerName: 'SlowRacer'
  })
  ingestRaceFromText(slower.summary, slower.participants)

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'feel the fire')
  assert.equal(entries.length, 1, 'a slower race is a real play but never a record-breaking event')
  assert.equal(entries[0]?.racerName, 'schoklad')
})

test('several beats in a row are each their own entry, correctly crediting the immediately-prior holder, newest first', () => {
  const first = syntheticRace({ snapshotId: '1', mapName: 'progression map', winnerTime: 100, winnerName: 'First' })
  ingestRaceFromText(first.summary, first.participants)
  const second = syntheticRace({ snapshotId: '2', mapName: 'progression map', winnerTime: 80, winnerName: 'Second' })
  ingestRaceFromText(second.summary, second.participants)
  const third = syntheticRace({ snapshotId: '3', mapName: 'progression map', winnerTime: 60, winnerName: 'Third' })
  ingestRaceFromText(third.summary, third.participants)

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'progression map')
  assert.equal(entries.length, 3)
  assert.equal(entries[0]?.racerName, 'Third')
  assert.equal(entries[0]?.previousRacerName, 'Second')
  assert.equal(entries[0]?.previousTimeSeconds, 80)
  assert.equal(entries[1]?.racerName, 'Second')
  assert.equal(entries[1]?.previousRacerName, 'First')
  assert.equal(entries[2]?.racerName, 'First')
  assert.equal(entries[2]?.previousTimeSeconds, null)
})

test('a manual override appears as a history entry crediting the real record it replaced', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s
  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'NoahSays', timeSeconds: 42 })

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'feel the fire')
  assert.equal(entries.length, 2)
  assert.equal(entries[0]?.racerName, 'NoahSays')
  assert.equal(entries[0]?.timeSeconds, 42)
  assert.equal(entries[0]?.isManualOverride, true)
  assert.equal(entries[0]?.previousRacerName, 'schoklad')
  assert.equal(entries[0]?.previousTimeSeconds, 133.391144)
})

test('a manual override on a map with zero real plays seeds history with nothing before it', () => {
  setMapRecordOverride({ mapName: 'never actually played', mapCreator: 'SomeCreator', racerName: 'NoahSays', timeSeconds: 99 })

  const entries = getMapRecordHistory().filter((e) => e.mapName === 'never actually played')
  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.isManualOverride, true)
  assert.equal(entries[0]?.previousTimeSeconds, null)
})

test("history is scoped per map — a race on a different map leaves an unrelated map's history alone", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire"
  const otherMap = syntheticRace({
    snapshotId: '33333333-3333-3333-3333-333333333333',
    mapName: 'a different map',
    winnerTime: 45,
    winnerName: 'OtherMapRacer'
  })
  ingestRaceFromText(otherMap.summary, otherMap.participants)

  const feelTheFireEntries = getMapRecordHistory().filter((e) => e.mapName === 'feel the fire')
  assert.equal(feelTheFireEntries.length, 1)
  assert.equal(feelTheFireEntries[0]?.racerName, 'schoklad')
})
