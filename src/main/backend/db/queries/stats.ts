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
      `SELECT COALESCE(MAX(rp.season_points_earned), 0) as br_hs
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
      `SELECT COALESCE(MAX(rp.season_points_earned), 0) as br_hs
       FROM royale_events re
       JOIN royale_participants rp ON rp.royale_event_id = re.id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?`
    )
    .get(startUtc, endUtc) as unknown as RoyaleAggregateRow

  return toRaceStats(raceRow, royaleRow)
}

export interface SeasonRaceHighScore {
  points: number
  racerName: string
  mapName: string
}

/**
 * Who holds the season's Race HS, and which map it was scored on — powers
 * !racehs (Noah's ask: the bare number alone wasn't enough context). Same
 * season-scoping convention as getSeasonStats. Null if no race has been
 * captured yet this season, rather than a fake zero-holder result.
 */
export function getSeasonRaceHighScore(seasonId: number | null): SeasonRaceHighScore | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT r.display_name as racerName, rp.season_points_earned as points, re.map_name as mapName
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.season_id IS ?
       ORDER BY rp.season_points_earned DESC
       LIMIT 1`
    )
    .get(seasonId) as unknown as SeasonRaceHighScore | undefined
  return row ?? null
}

export interface DailyHighScore {
  points: number
  racerName: string
}

/**
 * Who holds TODAY's Race HS / BR HS — Noah's ask, powers the Daily Stats
 * overlay so a bare number isn't the only thing shown. Same
 * getTodayBoundaryRangeUtc scoping as getTodayStats, and the same
 * "racer_id -> racers.display_name" join pattern getSeasonRaceHighScore
 * already uses for !racehs. Null if nothing's been captured yet today,
 * rather than a fake zero-holder result.
 */
export function getTodayRaceHighScore(dayBoundaryHour: number, now: Date = new Date()): DailyHighScore | null {
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(dayBoundaryHour, now)
  const db = getDb()
  const row = db
    .prepare(
      `SELECT r.display_name as racerName, rp.season_points_earned as points
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?
       ORDER BY rp.season_points_earned DESC
       LIMIT 1`
    )
    .get(startUtc, endUtc) as unknown as DailyHighScore | undefined
  return row ?? null
}

export function getTodayBrHighScore(dayBoundaryHour: number, now: Date = new Date()): DailyHighScore | null {
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(dayBoundaryHour, now)
  const db = getDb()
  const row = db
    .prepare(
      `SELECT r.display_name as racerName, rp.season_points_earned as points
       FROM royale_participants rp
       JOIN royale_events re ON re.id = rp.royale_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?
       ORDER BY rp.season_points_earned DESC
       LIMIT 1`
    )
    .get(startUtc, endUtc) as unknown as DailyHighScore | undefined
  return row ?? null
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
