import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { initDb, closeDb, getDb } from '../src/main/backend/db/db.ts'
import { ingestCustomMapPlayedFromText } from '../src/main/backend/watcher/parsers/customMapPlayed.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

// Matches the real confirmed schema (2026-08-13):
// MapName,CreatorName,DateCreated,TotalRaces,ElimRate,AverageFinishTime,
// RecordTime,RecordHolderName,DateSet,StreamerRecordHolder
function customMapPlayedCsv(opts: {
  mapName: string
  mapCreator?: string
  recordTime: number
  recordHolderName: string
}): string {
  const header =
    'MapName,CreatorName,DateCreated,TotalRaces,ElimRate,AverageFinishTime,RecordTime,RecordHolderName,DateSet,StreamerRecordHolder'
  const row = `${opts.mapName},${opts.mapCreator ?? 'creator1'},2026-08-01T00:00:00.000Z,10,0.1,120.5,${opts.recordTime},${opts.recordHolderName},2026.08.08-23.24.48,somebody`
  return `${header}\n${row}\n`
}

// Minimal real-shaped race, for tests that need a matching race to
// cross-reference points from — same pattern as map-records.test.ts's
// syntheticRace.
function syntheticRace(opts: {
  snapshotId: string
  mapName: string
  mapCreator?: string
  winnerName: string
  winnerPoints: number
}): { summary: string; participants: string } {
  const summary =
    `SchemaVersion,SnapshotId,GeneratedAtUtc,Status,GameMode,SessionType,MapName,MapCreator,PlayerCount,FinishedCount,EliminatedCount,WinnerPlatform,WinnerUsername\n` +
    `4,${opts.snapshotId},2026-08-10T16:59:03.229Z,Final,Custom Map Race,Qualifying,${opts.mapName},${opts.mapCreator ?? 'creator1'},1,1,0,Twitch,${opts.winnerName}\n`
  const participants =
    `SnapshotId,Position,Username,DisplayName,Platform,NameColorHex,SeasonPointsEarned,SeasonPointsTotal,SeasonWinsTotal,SeasonMatchesPlayedTotal,TimeInRaceSeconds,Eliminated\n` +
    `${opts.snapshotId},1,${opts.winnerName.toLowerCase()},${opts.winnerName},Twitch,FFFFFFFF,${opts.winnerPoints},${opts.winnerPoints},1,1,90.000000,false\n`
  return { summary, participants }
}

test('the first time a map is ever seen, its record is stored as a baseline — no alert fires', () => {
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' })
  )
  assert.equal(result, null)

  const db = getDb()
  const row = db.prepare('SELECT * FROM custom_map_records').get() as Record<string, unknown>
  assert.equal(row.map_name, 'speedway')
  assert.equal(row.record_time_seconds, 100)
  assert.equal(row.record_holder_name, 'Alice')
})

test('the same map played again with the SAME time is not a new record — no alert, no change', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' })
  )
  assert.equal(result, null)
})

test('a SLOWER time reported for a known map is not a new record', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 150, recordHolderName: 'Someone' })
  )
  assert.equal(result, null)

  const db = getDb()
  const row = db.prepare('SELECT * FROM custom_map_records').get() as Record<string, unknown>
  assert.equal(row.record_time_seconds, 100, 'the real (faster) record must stay on file, not get overwritten by a slower run')
  assert.equal(row.record_holder_name, 'Alice')
})

test('a genuinely FASTER time is a real record break — fires an alert and updates the stored baseline', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 90, recordHolderName: 'Bob' })
  )

  assert.ok(result)
  assert.equal(result?.mapName, 'speedway')
  assert.equal(result?.recordHolderName, 'Bob')
  assert.equal(result?.recordTimeSeconds, 90)
  assert.equal(result?.previousRecordTimeSeconds, 100)
  assert.equal(result?.previousRecordHolderName, 'Alice')

  const db = getDb()
  const row = db.prepare('SELECT * FROM custom_map_records').get() as Record<string, unknown>
  assert.equal(row.record_time_seconds, 90, 'the new record must actually be saved, not just reported')
  assert.equal(row.record_holder_name, 'Bob')
})

test('a record break cross-references the matching real race for points earned', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))

  const race = syntheticRace({ snapshotId: 's1', mapName: 'speedway', winnerName: 'Bob', winnerPoints: 777 })
  ingestRaceFromText(race.summary, race.participants)

  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 90, recordHolderName: 'Bob' })
  )
  assert.equal(result?.pointsEarned, 777)
})

test('a record break with no matching race still fires — pointsEarned is null, not 0 or a crash', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', recordTime: 90, recordHolderName: 'NobodyMarbleGridHasSeen' })
  )
  assert.ok(result)
  assert.equal(result?.pointsEarned, null)
})

test('map identity is case-insensitive — the same map reported differently-cased is still one tracked record', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'SPEEDWAY', recordTime: 90, recordHolderName: 'Bob' })
  )
  assert.ok(result, 'a differently-cased replay of the same map must still be recognized as the same map')

  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as c FROM custom_map_records').get() as { c: number }
  assert.equal(count.c, 1)
})

test('two different maps are tracked completely independently', () => {
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'speedway', recordTime: 100, recordHolderName: 'Alice' }))
  ingestCustomMapPlayedFromText(customMapPlayedCsv({ mapName: 'skyline', recordTime: 200, recordHolderName: 'Carol' }))

  // A record break on "skyline" must not touch "speedway"'s stored record.
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'skyline', recordTime: 150, recordHolderName: 'Dave' })
  )
  assert.equal(result?.mapName, 'skyline')

  const db = getDb()
  const speedway = db.prepare(`SELECT * FROM custom_map_records WHERE map_name = 'speedway'`).get() as Record<
    string,
    unknown
  >
  assert.equal(speedway.record_time_seconds, 100, 'untouched by the unrelated map’s record break')
})

test('the same map name from a different creator is tracked as a separate record, same rule as Ghost Balls', () => {
  ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', mapCreator: 'creator1', recordTime: 100, recordHolderName: 'Alice' })
  )
  const result = ingestCustomMapPlayedFromText(
    customMapPlayedCsv({ mapName: 'speedway', mapCreator: 'someone-else', recordTime: 50, recordHolderName: 'Eve' })
  )
  // A much faster time, but a DIFFERENT creator's "speedway" — must be its
  // own first-sighting baseline, not a record break against creator1's map.
  assert.equal(result, null)

  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as c FROM custom_map_records').get() as { c: number }
  assert.equal(count.c, 2)
})
