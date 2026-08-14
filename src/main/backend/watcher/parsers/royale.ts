import { readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'csv-parse/sync'
import { getDb } from '../../db/db.ts'
import { upsertRacer } from '../../db/queries/racers.ts'
import { getOpenSeasonId } from '../../db/queries/seasons.ts'
import { RoyaleSummarySchema, RoyaleParticipantSchema } from '../../../../shared/types.ts'
import { MARBLES_SAVE_DIR } from '../paths.ts'
import { broadcast } from '../../ws.ts'
import { getLatestEvent } from '../../db/queries/latestEvent.ts'
import { maybePostEventToChat } from '../../twitch/chatPoster.ts'

export async function ingestRoyaleFiles(dir: string = MARBLES_SAVE_DIR): Promise<number | null> {
  const [summaryText, participantsText] = await Promise.all([
    readFile(join(dir, 'LastSeasonRoyaleSummary.csv'), 'utf-8'),
    readFile(join(dir, 'LastSeasonRoyale.csv'), 'utf-8')
  ])
  return ingestRoyaleFromText(summaryText, participantsText)
}

/**
 * Pure text-in version — mirrors race.ts's ingestRaceFromText exactly, now
 * that a game update (confirmed 2026-08-12) brought Royale's schema in line
 * with Race/Tilt: a real summary file, SnapshotId, season point tracking,
 * a real map name. The old content-hash-only approach (no SnapshotId
 * existed) is retired along with the old schema — see the migration this
 * shipped alongside (005_royale_schema_update) and the iteration log.
 */
export function ingestRoyaleFromText(summaryText: string, participantsText: string): number | null {
  const summaryRows = parse(summaryText, {
    columns: true,
    trim: true,
    skip_empty_lines: true
  }) as Record<string, string>[]
  const participantRows = parse(participantsText, {
    columns: true,
    trim: true,
    skip_empty_lines: true
  }) as Record<string, string>[]

  if (summaryRows.length === 0) return null
  const summary = RoyaleSummarySchema.parse(summaryRows[0])

  // Same guard as Race/Tilt — see race.ts for the real confirmed "Status:
  // Error, blank point fields" case this protects against.
  if (summary.Status !== 'Final') return null

  const participants = participantRows
    .filter((r) => r.SnapshotId === summary.SnapshotId)
    .map((r) => RoyaleParticipantSchema.parse(r))

  // The two files haven't both caught up to the same SnapshotId yet — safe
  // to skip, the other file's own change event will re-trigger this.
  if (participants.length === 0) return null

  const db = getDb()
  const already = db.prepare('SELECT id FROM royale_events WHERE snapshot_id = ?').get(summary.SnapshotId) as
    | { id: number }
    | undefined
  if (already) return already.id

  const seasonId = getOpenSeasonId()
  let royaleEventId: number

  db.exec('BEGIN')
  try {
    const insertResult = db
      .prepare(
        `INSERT INTO royale_events (
          snapshot_id, schema_version, generated_at_utc, captured_at_local,
          status, game_mode, session_type, map_name, map_creator,
          player_count, finished_count, eliminated_count,
          winner_platform, winner_username, season_id, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        summary.SnapshotId,
        summary.SchemaVersion,
        summary.GeneratedAtUtc,
        new Date().toISOString(),
        summary.Status,
        summary.GameMode,
        summary.SessionType,
        summary.MapName,
        summary.MapCreator,
        summary.PlayerCount,
        summary.FinishedCount,
        summary.EliminatedCount,
        summary.WinnerPlatform,
        summary.WinnerUsername,
        seasonId,
        JSON.stringify({ summary, participants })
      )

    royaleEventId = insertResult.lastInsertRowid as number

    for (const p of participants) {
      const racerId = upsertRacer(db, {
        username: p.Username,
        displayName: p.DisplayName,
        platform: p.Platform,
        nameColorHex: p.NameColorHex
      })

      db.prepare(
        `INSERT INTO royale_participants (
          royale_event_id, racer_id, position, survival_time_seconds, eliminated,
          match_kills, match_damage_dealt, season_points_earned, season_points_total,
          season_wins_total, season_matches_played_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        royaleEventId,
        racerId,
        p.Position,
        p.SurvivalTimeSeconds,
        p.Eliminated ? 1 : 0,
        p.MatchKills,
        p.MatchDamageDealt,
        p.SeasonPointsEarned,
        p.SeasonPointsTotal,
        p.SeasonWinsTotal,
        p.SeasonMatchesPlayedTotal
      )
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  broadcast({ type: 'royale-event', snapshotId: summary.SnapshotId })

  const latest = getLatestEvent()
  if (latest) void maybePostEventToChat(latest)

  return royaleEventId
}
