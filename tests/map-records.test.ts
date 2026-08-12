import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { getMapRecords } from '../src/main/backend/db/queries/mapRecords.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

test("the real fastest FINISHER wins the record, not an eliminated racer's short survival time", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const records = getMapRecords()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.mapName, 'feel the fire')
  assert.equal(records[0]?.mapCreator, 'zim2325')
  assert.equal(records[0]?.racerName, 'schoklad')
  assert.equal(records[0]?.timeSeconds, 133.391144)
  // The real fixture has several ELIMINATED racers with much shorter raw
  // TimeInRaceSeconds (eg. 29s, 69s) — that's how long they survived before
  // getting knocked out, not a finish time, and must never win a "record".
  assert.ok(records[0]!.timeSeconds > 100, "must not pick up an eliminated racer's short survival time")
})

// Minimal synthetic race matching the real confirmed schema exactly (see
// race-summary-sample.csv / race-participants-sample.csv), each test
// self-contained and explicit — used only for cross-race comparison
// scenarios the single real fixture can't exercise on its own (it's only
// ever one race).
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

test('a later, faster race on the same map becomes the new record — the slower original no longer wins', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s

  const faster = syntheticRace({
    snapshotId: '11111111-1111-1111-1111-111111111111',
    mapName: 'feel the fire',
    winnerTime: 120,
    winnerName: 'FastRacer'
  })
  ingestRaceFromText(faster.summary, faster.participants)

  const records = getMapRecords()
  assert.equal(records.length, 1) // still one map, just a new best
  assert.equal(records[0]?.mapName, 'feel the fire')
  assert.equal(records[0]?.racerName, 'FastRacer')
  assert.equal(records[0]?.timeSeconds, 120)
})

test('a slower second race on the same map does NOT overwrite the existing faster record', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s

  const slower = syntheticRace({
    snapshotId: '22222222-2222-2222-2222-222222222222',
    mapName: 'feel the fire',
    winnerTime: 200,
    winnerName: 'SlowRacer'
  })
  ingestRaceFromText(slower.summary, slower.participants)

  const records = getMapRecords()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.racerName, 'schoklad') // the original 133.39s finisher, still the record
  assert.equal(records[0]?.timeSeconds, 133.391144)
})

test("records are tracked per map — a race on a different map does not affect another map's record", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire", 133.391144s

  const otherMap = syntheticRace({
    snapshotId: '33333333-3333-3333-3333-333333333333',
    mapName: 'a different map',
    winnerTime: 45,
    winnerName: 'OtherMapRacer'
  })
  ingestRaceFromText(otherMap.summary, otherMap.participants)

  const records = getMapRecords()
  assert.equal(records.length, 2)
  const feelTheFire = records.find((r) => r.mapName === 'feel the fire')
  const different = records.find((r) => r.mapName === 'a different map')
  assert.equal(feelTheFire?.racerName, 'schoklad')
  assert.equal(feelTheFire?.timeSeconds, 133.391144)
  assert.equal(different?.racerName, 'OtherMapRacer')
  assert.equal(different?.timeSeconds, 45)
})

test('the same map reported with different capitalization across two plays is still ONE record, not two', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire", 133.391144s

  // This game has a confirmed real pattern of inconsistent capitalization
  // elsewhere (season .sav filenames) — simulating the same risk here.
  const recapped = syntheticRace({
    snapshotId: '44444444-4444-4444-4444-444444444444',
    mapName: 'Feel The Fire',
    winnerTime: 100,
    winnerName: 'FasterRacer'
  })
  ingestRaceFromText(recapped.summary, recapped.participants)

  const records = getMapRecords()
  assert.equal(records.length, 1, 'a differently-capitalized replay of the same map must not create a second row')
  assert.equal(records[0]?.racerName, 'FasterRacer') // 100s genuinely beats 133.39s
  assert.equal(records[0]?.timeSeconds, 100)
})

test('the same map NAME from a different CREATOR is a separate record, not merged — per Noah directly', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire" by zim2325, 133.391144s

  // A real, confirmed risk (not hypothetical): different creators can and
  // do reuse the same map name. A same-named map by someone ELSE must be
  // tracked as its own record, even if its time would otherwise "beat" the
  // other creator's map — they're not the same map just because the name
  // matches.
  const impostor = syntheticRace({
    snapshotId: '55555555-5555-5555-5555-555555555555',
    mapName: 'feel the fire',
    mapCreator: 'SomeoneElse',
    winnerTime: 50, // deliberately much faster — must NOT overwrite zim2325's record
    winnerName: 'ImpostorRacer'
  })
  ingestRaceFromText(impostor.summary, impostor.participants)

  const records = getMapRecords()
  assert.equal(records.length, 2, 'same map name, different creator, must be two records, not one merged/overwritten record')

  const zims = records.find((r) => r.mapCreator === 'zim2325')
  const someoneElses = records.find((r) => r.mapCreator === 'SomeoneElse')
  assert.equal(zims?.mapName, 'feel the fire')
  assert.equal(zims?.racerName, 'schoklad')
  assert.equal(zims?.timeSeconds, 133.391144, "zim2325's original record must be untouched by the other creator's faster time")
  assert.equal(someoneElses?.mapName, 'feel the fire')
  assert.equal(someoneElses?.racerName, 'ImpostorRacer')
  assert.equal(someoneElses?.timeSeconds, 50)
})
