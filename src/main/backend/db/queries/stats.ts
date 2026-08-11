import { getDb } from '../db.ts'
import { getTodayBoundaryRangeUtc } from '../../../../shared/dayBoundary.ts'
import type { RaceStats } from '../../../../shared/types.ts'

interface RaceAggregateRow {
  total_count: number
  total_points: number
  race_hs: number
}

interface RoyaleAggregateRow {
  br_hs: number
}

// "Total Points/Count/Avg" = sum/count of every participant's points across
// every RACE event in scope (not just the streamer's own marble) — confirmed
// this session by reproducing MyStats' exact displayed numbers from raw game
// data: 193,133 / 104 = 1,857.05, and a single race's top scorer (4,602)
// matched "Race HS" exactly. "Race HS"/"BR HS" = highest points any one
// participant earned in a single Race/Royale event in scope. See
// 00 Game & Data Reference for the full validation.

/** Season-wide stats. `seasonId: null` covers the bootstrap case (no season detected yet) via SQL `IS`. */
export function getSeasonStats(seasonId: number | null): RaceStats {
  const db = getDb()

  const raceRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT re.id) as total_count,
         COALESCE(SUM(rp.season_points_earned), 0) as total_points,
         COALESCE(MAX(rp.season_points_earned), 0) as race_hs
       FROM race_events re
       JOIN race_participants rp ON rp.race_event_id = re.id
       WHERE re.season_id IS ?`
    )
    .get(seasonId) as unknown as RaceAggregateRow

  const royaleRow = db
    .prepare(
      `SELECT COALESCE(MAX(rp.points_earned), 0) as br_hs
       FROM royale_events re
       JOIN royale_participants rp ON rp.royale_event_id = re.id
       WHERE re.season_id IS ?`
    )
    .get(seasonId) as unknown as RoyaleAggregateRow

  return toRaceStats(raceRow, royaleRow)
}

/** Same shape, scoped to "today" per the configurable day-boundary hour instead of a season. */
export function getTodayStats(dayBoundaryHour: number, now: Date = new Date()): RaceStats {
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(dayBoundaryHour, now)
  const db = getDb()

  const raceRow = db
    .prepare(
      `SELECT
         COUNT(DISTINCT re.id) as total_count,
         COALESCE(SUM(rp.season_points_earned), 0) as total_points,
         COALESCE(MAX(rp.season_points_earned), 0) as race_hs
       FROM race_events re
       JOIN race_participants rp ON rp.race_event_id = re.id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?`
    )
    .get(startUtc, endUtc) as unknown as RaceAggregateRow

  const royaleRow = db
    .prepare(
      `SELECT COALESCE(MAX(rp.points_earned), 0) as br_hs
       FROM royale_events re
       JOIN royale_participants rp ON rp.royale_event_id = re.id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?`
    )
    .get(startUtc, endUtc) as unknown as RoyaleAggregateRow

  return toRaceStats(raceRow, royaleRow)
}

function toRaceStats(raceRow: RaceAggregateRow, royaleRow: RoyaleAggregateRow): RaceStats {
  return {
    totalPoints: raceRow.total_points,
    totalCount: raceRow.total_count,
    avgPoints: raceRow.total_count > 0 ? raceRow.total_points / raceRow.total_count : 0,
    raceHs: raceRow.race_hs,
    brHs: royaleRow.br_hs
  }
}
