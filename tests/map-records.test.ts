import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { getMapRecords, setMapRecordOverride, clearMapRecordOverride } from '../src/main/backend/db/queries/mapRecords.ts'

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
  assert.equal(records[0]?.timesPlayed, 1)
  assert.equal(records[0]?.isManualOverride, false)
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

// A synthetic race where the sole participant is ELIMINATED — nobody
// finishes. Used to prove timesPlayed is a genuine play count, not derived
// from the same finisher-only logic that decides the record itself.
function syntheticUnfinishedRace(opts: {
  snapshotId: string
  mapName: string
  mapCreator?: string
}): { summary: string; participants: string } {
  const summary =
    `SchemaVersion,SnapshotId,GeneratedAtUtc,Status,GameMode,SessionType,MapName,MapCreator,PlayerCount,FinishedCount,EliminatedCount,WinnerPlatform,WinnerUsername\n` +
    `4,${opts.snapshotId},2026-08-10T16:59:03.229Z,Final,Custom Map Race,Qualifying,${opts.mapName},${opts.mapCreator ?? 'zim2325'},1,0,1,Twitch,nobody\n`
  const participants =
    `SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\n` +
    `${opts.snapshotId},1,eliminatedracer,EliminatedRacer,Twitch,FFFFFFFF,0,0,0,1,15.000000,true\n`
  return { summary, participants }
}

test('timesPlayed counts every race on the map, not just the one that set the record', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // "feel the fire", play #1

  const slower = syntheticRace({
    snapshotId: '66666666-6666-6666-6666-666666666666',
    mapName: 'feel the fire',
    winnerTime: 999, // slower — does not become the record, but is still a real play
    winnerName: 'SlowRacer'
  })
  ingestRaceFromText(slower.summary, slower.participants) // play #2

  const records = getMapRecords()
  assert.equal(records.length, 1)
  assert.equal(records[0]?.racerName, 'schoklad') // record unchanged
  assert.equal(records[0]?.timesPlayed, 2) // but both plays counted
})

test('a race nobody finishes still counts as a play, even though it has no record to show on its own', () => {
  const unfinished = syntheticUnfinishedRace({
    snapshotId: '77777777-7777-7777-7777-777777777777',
    mapName: 'nobody finishes this one'
  })
  ingestRaceFromText(unfinished.summary, unfinished.participants)

  // No finisher anywhere yet on this map — nothing to show as a "record",
  // so it correctly doesn't appear in the list at all.
  assert.equal(getMapRecords().find((r) => r.mapName === 'nobody finishes this one'), undefined)

  // A later race that DOES have a finisher makes the map appear — and
  // timesPlayed must include the earlier no-finish attempt too, not just
  // count from whenever the first real finish happened.
  const finished = syntheticRace({
    snapshotId: '88888888-8888-8888-8888-888888888888',
    mapName: 'nobody finishes this one',
    winnerTime: 60,
    winnerName: 'FirstFinisher'
  })
  ingestRaceFromText(finished.summary, finished.participants)

  const record = getMapRecords().find((r) => r.mapName === 'nobody finishes this one')
  assert.equal(record?.racerName, 'FirstFinisher')
  assert.equal(record?.timesPlayed, 2, 'the earlier all-eliminated attempt must still count as a play')
})

test('a manual override replaces the computed record and is flagged as such', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s

  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'NoahSays', timeSeconds: 42 })

  const record = getMapRecords().find((r) => r.mapName === 'feel the fire')
  assert.equal(record?.racerName, 'NoahSays')
  assert.equal(record?.timeSeconds, 42)
  assert.equal(record?.isManualOverride, true)
  assert.equal(record?.timesPlayed, 1, 'timesPlayed reflects real captured plays regardless of the override')
})

test('a manual override can seed a record for a map with zero captured plays', () => {
  setMapRecordOverride({ mapName: 'never actually played', mapCreator: 'SomeCreator', racerName: 'NoahSays', timeSeconds: 99 })

  const record = getMapRecords().find((r) => r.mapName === 'never actually played')
  assert.equal(record?.racerName, 'NoahSays')
  assert.equal(record?.isManualOverride, true)
  assert.equal(record?.timesPlayed, 0)
})

test('a manual override is NOT beaten by a subsequent faster real race — it stays locked until explicitly cleared', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s
  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'NoahSays', timeSeconds: 42 })

  const evenFaster = syntheticRace({
    snapshotId: '99999999-9999-9999-9999-999999999999',
    mapName: 'feel the fire',
    winnerTime: 10, // genuinely faster than the override's 42s
    winnerName: 'GenuinelyFaster'
  })
  ingestRaceFromText(evenFaster.summary, evenFaster.participants)

  const record = getMapRecords().find((r) => r.mapName === 'feel the fire')
  assert.equal(record?.racerName, 'NoahSays', 'an override is a deliberate lock, not just a seed value a real time can beat')
  assert.equal(record?.timeSeconds, 42)
  assert.equal(record?.isManualOverride, true)
})

test('clearing an override reverts the map back to its automatically-computed record', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad, 133.391144s
  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'NoahSays', timeSeconds: 42 })

  clearMapRecordOverride('feel the fire', 'zim2325')

  const record = getMapRecords().find((r) => r.mapName === 'feel the fire')
  assert.equal(record?.racerName, 'schoklad')
  assert.equal(record?.timeSeconds, 133.391144)
  assert.equal(record?.isManualOverride, false)
})

test('clearing an override that was never set is a safe no-op', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  clearMapRecordOverride('feel the fire', 'zim2325') // never overridden

  const record = getMapRecords().find((r) => r.mapName === 'feel the fire')
  assert.equal(record?.racerName, 'schoklad') // untouched
})

test('setting a second override for the same map REPLACES the first rather than stacking', () => {
  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'FirstGuess', timeSeconds: 50 })
  setMapRecordOverride({ mapName: 'feel the fire', mapCreator: 'zim2325', racerName: 'CorrectedGuess', timeSeconds: 45 })

  const records = getMapRecords().filter((r) => r.mapName === 'feel the fire')
  assert.equal(records.length, 1)
  assert.equal(records[0]?.racerName, 'CorrectedGuess')
  assert.equal(records[0]?.timeSeconds, 45)
})
