import { getDb } from '../db.ts'
import { getTodayBoundaryRangeUtc } from '../../../../shared/dayBoundary.ts'

export interface RacerTodayStats {
  racesPlayed: number
  totalPoints: number
}

/**
 * Powers `!mystats`/`!mymarble`. Scoped to Race mode only, same as the
 * Dashboard's "Today" tile (getTodayStats) — deliberately NOT broadened to
 * include Tilt/Royale, since a chat command showing a different number than
 * what the Dashboard itself displays for "today" would just look like a bug.
 * Username match is COLLATE NOCASE — Twitch logins are canonically
 * lowercase and that's how the CSV's Username column already comes in, but
 * matching defensively costs nothing.
 */
export function getRacerTodayStats(username: string, dayBoundaryHour: number, now: Date = new Date()): RacerTodayStats {
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(dayBoundaryHour, now)
  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         COUNT(DISTINCT re.id) as racesPlayed,
         COALESCE(SUM(rp.season_points_earned), 0) as totalPoints
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE r.username = ? COLLATE NOCASE
         AND re.captured_at_local >= ? AND re.captured_at_local < ?`
    )
    .get(username, startUtc, endUtc) as unknown as RacerTodayStats
  return row
}

export interface RacerSeasonStats {
  racesPlayed: number
  totalPoints: number
}

/**
 * Season totals for one racer — points earned and races played, scoped the
 * same way as the Leaderboard/getRacerSeasonWins (re.season_id IS ?, so a
 * null seasonId correctly covers the bootstrap case too). Powers !mystats'
 * season line and points-per-race; deliberately a SEPARATE query from
 * getRacerTodayStats rather than reusing its window, since "today" and
 * "season" are genuinely independent scopes — today's boundary can roll
 * over mid-season, and a racer's season total must not silently reset with
 * it.
 */
export function getRacerSeasonStats(username: string, seasonId: number | null): RacerSeasonStats {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT
         COUNT(DISTINCT re.id) as racesPlayed,
         COALESCE(SUM(rp.season_points_earned), 0) as totalPoints
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE r.username = ? COLLATE NOCASE AND re.season_id IS ?`
    )
    .get(username, seasonId) as unknown as RacerSeasonStats
  return row
}

/**
 * The stored in-game display name for a username, or null if it's never
 * been seen. Used when looking up someone ELSE's stats via !mystats
 * @username — unlike the caller's own stats (where ctx.chatterDisplayName
 * comes straight from their live Twitch identity), a looked-up target's only
 * available display form is whatever the game itself last reported for
 * them.
 */
export function getRacerDisplayName(username: string): string | null {
  const db = getDb()
  const row = db.prepare(`SELECT display_name as displayName FROM racers WHERE username = ? COLLATE NOCASE`).get(username) as
    | { displayName: string }
    | undefined
  return row?.displayName ?? null
}

/** Wins (position 1) for one racer, scoped to a season the same way the Leaderboard is — null seasonId covers the bootstrap case. */
export function getRacerSeasonWins(username: string, seasonId: number | null): number {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) as wins
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE r.username = ? COLLATE NOCASE AND re.season_id IS ? AND rp.position = 1`
    )
    .get(username, seasonId) as unknown as { wins: number }
  return row.wins
}

/** Whether this username has ever appeared in a captured race at all — distinguishes "never raced" from "raced, just not today/hasn't won". */
export function racerHasEverRaced(username: string): boolean {
  const db = getDb()
  const row = db.prepare(`SELECT 1 FROM racers WHERE username = ? COLLATE NOCASE LIMIT 1`).get(username)
  return row !== undefined
}
