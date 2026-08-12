import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { getMapCommunityStats } from '../src/main/backend/db/queries/mapCommunity.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

// Unlike map-records.test.ts's syntheticRace, this one controls
// playerCount/eliminatedCount directly (independent of how many participant
// rows actually exist) — confirmed safe in race.ts: player_count/
// eliminated_count are stored straight from the summary CSV's own reported
// fields, never cross-checked against the participants file's row count.
// That's exactly what community stats read, so tests need to control it.
function syntheticRace(opts: {
  snapshotId: string
  mapName: string
  mapCreator?: string
  playerCount: number
  eliminatedCount: number
  finisherTime: number
  finisherName?: string
}): { summary: string; participants: string } {
  const finishedCount = opts.playerCount - opts.eliminatedCount
  const name = opts.finisherName ?? 'Winner'
  const summary =
    `SchemaVersion,SnapshotId,GeneratedAtUtc,Status,GameMode,SessionType,MapName,MapCreator,PlayerCount,FinishedCount,EliminatedCount,WinnerPlatform,WinnerUsername\n` +
    `4,${opts.snapshotId},2026-08-10T16:59:03.229Z,Final,Custom Map Race,Qualifying,${opts.mapName},${opts.mapCreator ?? 'zim2325'},${opts.playerCount},${finishedCount},${opts.eliminatedCount},Twitch,${name}\n`
  const participants =
    `SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\n` +
    `${opts.snapshotId},1,${name.toLowerCase()},${name},Twitch,FFFFFFFF,4000,4000,1,1,${opts.finisherTime.toFixed(6)},false\n`
  return { summary, participants }
}

test('the real fixture reports death rate from the games own counts (30 eliminated of 49 players)', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const stats = getMapCommunityStats().find((s) => s.mapName === 'feel the fire')
  assert.ok(stats)
  assert.equal(stats!.raceCount, 1)
  assert.ok(Math.abs(stats!.deathRatePercent - (30 / 49) * 100) < 0.0001)
  assert.ok((stats!.avgFinishSeconds ?? 0) > 100, 'should be in the same ballpark as the known ~133s winning time')
})

test("death rate is participant-weighted across a map's races, not a plain average of each race's own rate", () => {
  // Race A: 10 players, 5 eliminated -> 50%. Race B: 40 players, 4 eliminated
  // -> 10%. Weighted: (5+4)/(10+40) = 18%. A plain average would read 30% —
  // different, which is exactly what this test is checking for.
  const a = syntheticRace({
    snapshotId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    mapName: 'brutal map',
    playerCount: 10,
    eliminatedCount: 5,
    finisherTime: 60,
    finisherName: 'RacerA'
  })
  ingestRaceFromText(a.summary, a.participants)
  const b = syntheticRace({
    snapshotId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    mapName: 'brutal map',
    playerCount: 40,
    eliminatedCount: 4,
    finisherTime: 70,
    finisherName: 'RacerB'
  })
  ingestRaceFromText(b.summary, b.participants)

  const stats = getMapCommunityStats().find((s) => s.mapName === 'brutal map')
  assert.ok(stats)
  assert.equal(stats!.raceCount, 2)
  assert.ok(Math.abs(stats!.deathRatePercent - 18) < 0.0001)
})

test('avg finish time averages across every finisher captured on the map, not just the latest race', () => {
  const a = syntheticRace({
    snapshotId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    mapName: 'timed map',
    playerCount: 1,
    eliminatedCount: 0,
    finisherTime: 100,
    finisherName: 'RacerC'
  })
  ingestRaceFromText(a.summary, a.participants)
  const b = syntheticRace({
    snapshotId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    mapName: 'timed map',
    playerCount: 1,
    eliminatedCount: 0,
    finisherTime: 200,
    finisherName: 'RacerD'
  })
  ingestRaceFromText(b.summary, b.participants)

  const stats = getMapCommunityStats().find((s) => s.mapName === 'timed map')
  assert.equal(stats?.avgFinishSeconds, 150)
})

test('a map nobody has ever finished still appears, with avgFinishSeconds null rather than 0 or NaN', () => {
  // Every one of the 5 reported players is eliminated, and the one real
  // participant row is eliminated too — no finisher anywhere for this map.
  const summary =
    `SchemaVersion,SnapshotId,GeneratedAtUtc,Status,GameMode,SessionType,MapName,MapCreator,PlayerCount,FinishedCount,EliminatedCount,WinnerPlatform,WinnerUsername\n` +
    `4,eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee,2026-08-10T16:59:03.229Z,Final,Custom Map Race,Qualifying,nobody finishes,zim2325,5,0,5,Twitch,nobody\n`
  const participants =
    `SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\n` +
    `eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee,1,eliminatedracer,EliminatedRacer,Twitch,FFFFFFFF,0,0,0,1,15.000000,true\n`
  ingestRaceFromText(summary, participants)

  const stats = getMapCommunityStats().find((s) => s.mapName === 'nobody finishes')
  assert.ok(stats, "must still appear even though nobody's finished it — that's exactly what death rate is for")
  assert.equal(stats?.avgFinishSeconds, null)
  assert.equal(stats?.deathRatePercent, 100)
})
