import { readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'csv-parse/sync'
import { getDb } from '../../db/db.ts'
import { upsertRacer } from '../../db/queries/racers.ts'
import { getOpenSeasonId } from '../../db/queries/seasons.ts'
import { RaceSummarySchema, RaceParticipantSchema } from '../../../../shared/types.ts'
import { MARBLES_SAVE_DIR } from '../paths.ts'
import { broadcast } from '../../ws.ts'
import { getLatestEvent } from '../../db/queries/latestEvent.ts'
import { maybePostEventToChat, maybePostLastMapToChat } from '../../twitch/chatPoster.ts'

export async function ingestRaceFiles(dir: string = MARBLES_SAVE_DIR): Promise<number | null> {
  const [summaryText, participantsText] = await Promise.all([
    readFile(join(dir, 'LastSeasonRaceSummary.csv'), 'utf-8'),
    readFile(join(dir, 'LastSeasonRace.csv'), 'utf-8')
  ])
  return ingestRaceFromText(summaryText, participantsText)
}

/**
 * Pure text-in version, used directly by tests and by the file-reading
 * wrapper above. Re-reads (parses) BOTH the summary and participants text
 * every time regardless of which file actually changed on disk — this makes
 * ingestion idempotent and order-independent instead of timing-dependent,
 * since there's no guarantee which of the two files' chokidar events fires
 * first.
 */
export function ingestRaceFromText(summaryText: string, participantsText: string): number | null {
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
  const summary = RaceSummarySchema.parse(summaryRows[0])

  // Confirmed live on 2026-08-11: the game can write Status "Error" (at
  // least) alongside completely blank participant point fields (not "0" —
  // empty string). zod's coerce.number() turns '' into 0 without throwing,
  // so an unfiltered ingest would silently record a broken race as a real
  // one with everyone scoring 0 — exactly the kind of bad data a Phase 5
  // chat post must never announce. Only "Final" is a genuinely completed
  // race; anything else is still captured in raw_snapshots (the safety net
  // in fileWatcher.ts runs before this function either way) but never
  // becomes a typed event.
  if (summary.Status !== 'Final') return null

  const participants = participantRows
    .filter((r) => r.SnapshotId === summary.SnapshotId)
    .map((r) => RaceParticipantSchema.parse(r))

  // The two files haven't both caught up to the same SnapshotId yet (one's
  // write finished before the other's) — safe to skip. The other file's own
  // change event will re-trigger this and catch it once both agree.
  if (participants.length === 0) return null

  const db = getDb()
  const already = db.prepare('SELECT id FROM race_events WHERE snapshot_id = ?').get(summary.SnapshotId) as
    | { id: number }
    | undefined
  if (already) return already.id

  const seasonId = getOpenSeasonId()
  let raceEventId: number

  db.exec('BEGIN')
  try {
    const insertResult = db
      .prepare(
        `INSERT INTO race_events (
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

    raceEventId = insertResult.lastInsertRowid as number

    for (const p of participants) {
      const racerId = upsertRacer(db, {
        username: p.Username,
        displayName: p.DisplayName,
        platform: p.Platform,
        nameColorHex: p.NameColorHex
      })

      db.prepare(
        `INSERT INTO race_participants (
          race_event_id, racer_id, position, season_points_earned, season_points_total,
          season_wins_total, season_matches_played_total, time_in_race_seconds, eliminated
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        raceEventId,
        racerId,
        p.Position,
        p.SeasonPointsEarned,
        p.SeasonPointsTotal,
        p.SeasonWinsTotal,
        p.SeasonMatchesPlayedTotal,
        p.TimeInRaceSeconds,
        p.Eliminated ? 1 : 0
      )
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  broadcast({ type: 'race-event', snapshotId: summary.SnapshotId })

  // Fire-and-forget: chatPoster does nothing unless auto-post is explicitly
  // enabled (off by default), and any failure is caught + logged inside it —
  // a slow/failed chat post must never block the file watcher from
  // processing the next event.
  const latest = getLatestEvent()
  if (latest) void maybePostEventToChat(latest)
  // Noah's ask: a separate toggle to post !lastmap's info automatically
  // after every race. Race-mode only (matches !lastmap's own scope) — hooked
  // in here specifically, not tilt.ts/royale.ts, which don't have a "map"
  // the same way. Gated on latest.kind === 'race' defensively (should always
  // be true right here, but explicit beats assumed).
  if (latest && latest.kind === 'race') void maybePostLastMapToChat(latest.occurredAt)

  return raceEventId
}
