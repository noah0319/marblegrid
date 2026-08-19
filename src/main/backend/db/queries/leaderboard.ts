import { getDb } from '../db.ts'
import { getTodayBoundaryRangeUtc } from '../../../../shared/dayBoundary.ts'
import type { LeaderboardRow } from '../../../../shared/types.ts'

/**
 * "Regulars" leaderboard for the streamer's own channel — races played, wins,
 * and total points earned per racer, scoped to a season (or null for
 * all-time/bootstrap). This is a MarbleGrid-specific feature, not something
 * MyStats shows — see 01 Architecture & Design decision #5.
 */
export function getLeaderboard(seasonId: number | null, limit = 20): LeaderboardRow[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT
         r.username as username,
         r.display_name as displayName,
         COUNT(rp.id) as racesPlayed,
         SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) as wins,
         COALESCE(SUM(rp.season_points_earned), 0) as totalPoints
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.season_id IS ?
       GROUP BY r.id
       ORDER BY totalPoints DESC, wins DESC
       LIMIT ?`
    )
    .all(seasonId, limit) as unknown as LeaderboardRow[]
}

export interface LeaderboardPosition {
  username: string
  displayName: string
  rank: number
  totalRacers: number
  racesPlayed: number
  wins: number
  totalPoints: number
}

/**
 * Noah's ask: `!leaderboard` should show a racer's own rank, not just the
 * top 10 — this is that lookup. Same ordering as getLeaderboard
 * (totalPoints DESC, wins DESC), just computed as a rank via a window
 * function instead of truncated to a fixed limit. RANK() (not DENSE_RANK
 * or ROW_NUMBER) deliberately — two racers exactly tied on both points and
 * wins should show the SAME rank number and skip the next one, matching
 * how leaderboard ranks conventionally read (sports standings, not just a
 * row index). Null if this racer has no participation in this specific
 * season — a real, distinct case from "never raced at all" (racers.username
 * existing all-time doesn't imply a row in the CURRENT season), left for
 * the caller to tell apart from racerHasEverRaced.
 */
export function getRacerLeaderboardPosition(username: string, seasonId: number | null): LeaderboardPosition | null {
  const db = getDb()
  const row = db
    .prepare(
      `WITH ranked AS (
         SELECT
           r.username as username,
           r.display_name as displayName,
           COUNT(rp.id) as racesPlayed,
           SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) as wins,
           COALESCE(SUM(rp.season_points_earned), 0) as totalPoints,
           RANK() OVER (
             ORDER BY COALESCE(SUM(rp.season_points_earned), 0) DESC, SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) DESC
           ) as rank,
           COUNT(*) OVER () as totalRacers
         FROM race_participants rp
         JOIN race_events re ON re.id = rp.race_event_id
         JOIN racers r ON r.id = rp.racer_id
         WHERE re.season_id IS ?
         GROUP BY r.id
       )
       SELECT * FROM ranked WHERE username = ? COLLATE NOCASE`
    )
    .get(seasonId, username) as unknown as LeaderboardPosition | undefined
  return row ?? null
}

/** Same shape as getLeaderboard, scoped to "today" (per the day-boundary hour) instead of a season — powers `!top10today`. */
export function getTodayLeaderboard(dayBoundaryHour: number, limit = 10, now: Date = new Date()): LeaderboardRow[] {
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(dayBoundaryHour, now)
  const db = getDb()
  return db
    .prepare(
      `SELECT
         r.username as username,
         r.display_name as displayName,
         COUNT(rp.id) as racesPlayed,
         SUM(CASE WHEN rp.position = 1 THEN 1 ELSE 0 END) as wins,
         COALESCE(SUM(rp.season_points_earned), 0) as totalPoints
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.captured_at_local >= ? AND re.captured_at_local < ?
       GROUP BY r.id
       ORDER BY totalPoints DESC, wins DESC
       LIMIT ?`
    )
    .all(startUtc, endUtc, limit) as unknown as LeaderboardRow[]
}
