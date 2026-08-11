import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { ingestRoyaleFromText } from '../src/main/backend/watcher/parsers/royale.ts'
import { getSeasonStats, getTodayStats } from '../src/main/backend/db/queries/stats.ts'
import { getLeaderboard } from '../src/main/backend/db/queries/leaderboard.ts'
import { openSeasonFromFilename, getOpenSeasonId } from '../src/main/backend/db/queries/seasons.ts'
import { DEFAULT_DAY_BOUNDARY_HOUR } from '../src/shared/constants.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

test("season stats sum every participant's points across all races, not just the winner's", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const stats = getSeasonStats(null) // bootstrap case: no season detected yet
  // Sum of all 49 confirmed real participants' SeasonPointsEarned (only the
  // top 12 finishers earned nonzero points in this race; the rest are 0).
  assert.equal(stats.totalPoints, 32932)
  assert.equal(stats.totalCount, 1)
  assert.equal(stats.avgPoints, 32932)
  assert.equal(stats.raceHs, 4602) // matches MyStats' displayed "Race HS: 4,602"
})

test('season stats scope correctly to an actual open season, not just the bootstrap null case', () => {
  openSeasonFromFilename(72, 'season 72.sav')
  const seasonId = getOpenSeasonId()

  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const scoped = getSeasonStats(seasonId)
  assert.equal(scoped.totalPoints, 32932)

  const bootstrap = getSeasonStats(null)
  assert.equal(bootstrap.totalPoints, 0) // the race belongs to season 72, not the null bucket
})

test('BR HS reflects the highest single Royale points, independent of Race stats', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  ingestRoyaleFromText(read('royale-sample.csv'))

  const stats = getSeasonStats(null)
  assert.equal(stats.raceHs, 4602)
  assert.equal(stats.brHs, 400) // shaidarharan's win in the royale fixture
})

test('today stats include an event captured moments ago, at the default boundary hour', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const stats = getTodayStats(DEFAULT_DAY_BOUNDARY_HOUR)
  assert.equal(stats.totalCount, 1)
  assert.equal(stats.totalPoints, 32932)
})

test('leaderboard ranks racers by total points and tracks races played / wins', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const top5 = getLeaderboard(null, 5)
  assert.equal(top5.length, 5)
  assert.equal(top5[0].username, 'schoklad')
  assert.equal(top5[0].totalPoints, 4602)
  assert.equal(top5[0].racesPlayed, 1)
  assert.equal(top5[0].wins, 1)
  assert.equal(top5[1].username, 'rahherself')
  assert.equal(top5[1].totalPoints, 4234)

  const full = getLeaderboard(null, 100)
  assert.equal(full.length, 49) // every distinct racer in the fixture

  const noonspinsRow = full.find((r) => r.username === 'noonspins')
  assert.ok(noonspinsRow, 'noonspins should appear on the leaderboard even with 0 points')
  assert.equal(noonspinsRow?.totalPoints, 0)
  assert.equal(noonspinsRow?.wins, 0)
  assert.equal(noonspinsRow?.racesPlayed, 1)
})
