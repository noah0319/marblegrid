import { getDb } from '../db.ts'
import type { LatestEventSummary } from '../../../../shared/types.ts'

interface Candidate {
  kind: LatestEventSummary['kind']
  at: string
  id: number
}

/**
 * The single most recent Race/Tilt/Royale event, whichever happened last —
 * queried as three small per-table lookups rather than one UNION, since the
 * three tables don't share a column shape. Powers the overlay's result toast
 * (Phase 4): re-fetched by the renderer whenever the WebSocket pushes a new
 * event, so "most recent" always means genuinely most recent, not whichever
 * mode's table happens to sort first.
 */
export function getLatestEvent(): LatestEventSummary | null {
  const db = getDb()

  const race = db
    .prepare(
      `SELECT id, captured_at_local, map_name, winner_username
       FROM race_events ORDER BY captured_at_local DESC LIMIT 1`
    )
    .get() as
    | { id: number; captured_at_local: string; map_name: string; winner_username: string }
    | undefined

  const tilt = db
    .prepare(
      `SELECT id, captured_at_local, level, top_tiltee_username
       FROM tilt_events ORDER BY captured_at_local DESC LIMIT 1`
    )
    .get() as { id: number; captured_at_local: string; level: number; top_tiltee_username: string } | undefined

  const royale = db
    .prepare(`SELECT id, captured_at_local FROM royale_events ORDER BY captured_at_local DESC LIMIT 1`)
    .get() as { id: number; captured_at_local: string } | undefined

  const candidates: Candidate[] = []
  if (race) candidates.push({ kind: 'race', at: race.captured_at_local, id: race.id })
  if (tilt) candidates.push({ kind: 'tilt', at: tilt.captured_at_local, id: tilt.id })
  if (royale) candidates.push({ kind: 'royale', at: royale.captured_at_local, id: royale.id })
  if (candidates.length === 0) return null

  candidates.sort((a, b) => (a.at < b.at ? 1 : -1))
  const winner = candidates[0]

  if (winner.kind === 'race' && race) {
    const topFinishers = db
      .prepare(
        `SELECT r.display_name as name, rp.season_points_earned as points
         FROM race_participants rp JOIN racers r ON r.id = rp.racer_id
         WHERE rp.race_event_id = ? ORDER BY rp.season_points_earned DESC LIMIT 3`
      )
      .all(race.id) as unknown as { name: string; points: number }[]

    const allScorers = db
      .prepare(
        `SELECT r.display_name as name, rp.season_points_earned as points
         FROM race_participants rp JOIN racers r ON r.id = rp.racer_id
         WHERE rp.race_event_id = ? AND rp.season_points_earned > 0
         ORDER BY rp.season_points_earned DESC`
      )
      .all(race.id) as unknown as { name: string; points: number }[]

    return {
      kind: 'race',
      occurredAt: race.captured_at_local,
      label: race.map_name,
      winnerName: topFinishers[0]?.name ?? race.winner_username,
      winnerPoints: topFinishers[0]?.points ?? 0,
      topFinishers,
      allScorers
    }
  }

  if (winner.kind === 'tilt' && tilt) {
    const topFinishers = db
      .prepare(
        `SELECT r.display_name as name, tp.level_points_earned as points
         FROM tilt_participants tp JOIN racers r ON r.id = tp.racer_id
         WHERE tp.tilt_event_id = ? ORDER BY tp.level_points_earned DESC LIMIT 3`
      )
      .all(tilt.id) as unknown as { name: string; points: number }[]

    // Direct lookup, not "whichever row a tie-break happened to sort first":
    // on a level nobody finishes, every participant's points are 0 (confirmed
    // in the real sample this was built from), so ORDER BY points DESC alone
    // can't reliably identify the winner. The game's own top_tiltee_username
    // is authoritative — it may reflect distance/time-survived, not points.
    const topTiltee = db
      .prepare(
        `SELECT r.display_name as name, tp.level_points_earned as points
         FROM tilt_participants tp JOIN racers r ON r.id = tp.racer_id
         WHERE tp.tilt_event_id = ? AND r.username = ?`
      )
      .get(tilt.id, tilt.top_tiltee_username.toLowerCase()) as
      | { name: string; points: number }
      | undefined

    const allScorers = db
      .prepare(
        `SELECT r.display_name as name, tp.level_points_earned as points
         FROM tilt_participants tp JOIN racers r ON r.id = tp.racer_id
         WHERE tp.tilt_event_id = ? AND tp.level_points_earned > 0
         ORDER BY tp.level_points_earned DESC`
      )
      .all(tilt.id) as unknown as { name: string; points: number }[]

    return {
      kind: 'tilt',
      occurredAt: tilt.captured_at_local,
      // Just "Level N" — the overlay's own mode badge already says "TILTED"
      // right above this, and the chat message header does too, so a
      // "Tilted — " prefix here was pure redundancy in both places.
      label: `Level ${tilt.level}`,
      winnerName: topTiltee?.name ?? tilt.top_tiltee_username,
      winnerPoints: topTiltee?.points ?? topFinishers[0]?.points ?? 0,
      topFinishers,
      allScorers
    }
  }

  const topFinishers = db
    .prepare(
      `SELECT r.display_name as name, rp.points_earned as points
       FROM royale_participants rp JOIN racers r ON r.id = rp.racer_id
       WHERE rp.royale_event_id = ? ORDER BY rp.points_earned DESC LIMIT 3`
    )
    .all(winner.id) as unknown as { name: string; points: number }[]

  const allScorers = db
    .prepare(
      `SELECT r.display_name as name, rp.points_earned as points
       FROM royale_participants rp JOIN racers r ON r.id = rp.racer_id
       WHERE rp.royale_event_id = ? AND rp.points_earned > 0
       ORDER BY rp.points_earned DESC`
    )
    .all(winner.id) as unknown as { name: string; points: number }[]

  return {
    kind: 'royale',
    occurredAt: royale!.captured_at_local,
    label: 'Battle Royale',
    allScorers,
    winnerName: topFinishers[0]?.name ?? '',
    winnerPoints: topFinishers[0]?.points ?? 0,
    topFinishers
  }
}
