import { getDb } from '../db.ts'

export interface LeaderboardRow {
  username: string
  displayName: string
  racesPlayed: number
  wins: number
  totalPoints: number
}

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
