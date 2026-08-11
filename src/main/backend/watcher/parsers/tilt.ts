import { readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'csv-parse/sync'
import { getDb } from '../../db/db.ts'
import { upsertRacer } from '../../db/queries/racers.ts'
import { getOpenSeasonId } from '../../db/queries/seasons.ts'
import { TiltLevelSchema, TiltParticipantSchema } from '../../../../shared/types.ts'
import { MARBLES_SAVE_DIR } from '../paths.ts'
import { broadcast } from '../../ws.ts'

export async function ingestTiltFiles(dir: string = MARBLES_SAVE_DIR): Promise<number | null> {
  const [levelText, playersText] = await Promise.all([
    readFile(join(dir, 'LastTiltLevel.csv'), 'utf-8'),
    readFile(join(dir, 'LastTiltLevelPlayers.csv'), 'utf-8')
  ])
  return ingestTiltFromText(levelText, playersText)
}

export function ingestTiltFromText(levelText: string, playersText: string): number | null {
  const levelRows = parse(levelText, {
    columns: true,
    trim: true,
    skip_empty_lines: true
  }) as Record<string, string>[]
  const playerRows = parse(playersText, {
    columns: true,
    trim: true,
    skip_empty_lines: true
  }) as Record<string, string>[]

  if (levelRows.length === 0) return null
  const level = TiltLevelSchema.parse(levelRows[0])

  // Same guard as race.ts's Status check — see that file's comment for the
  // real "Buckshot" Status: Error case this was built against.
  if (level.Status !== 'Final') return null

  const players = playerRows
    .filter((r) => r.SnapshotId === level.SnapshotId)
    .map((r) => TiltParticipantSchema.parse(r))

  if (players.length === 0) return null

  const db = getDb()
  const already = db.prepare('SELECT id FROM tilt_events WHERE snapshot_id = ?').get(level.SnapshotId) as
    | { id: number }
    | undefined
  if (already) return already.id

  const seasonId = getOpenSeasonId()
  let tiltEventId: number

  db.exec('BEGIN')
  try {
    const insertResult = db
      .prepare(
        `INSERT INTO tilt_events (
          snapshot_id, schema_version, generated_at_utc, captured_at_local,
          status, game_mode, session_type, level, difficulty, level_duration_seconds, level_passed,
          player_count, finished_count, eliminated_count, top_tiltee_platform, top_tiltee_username,
          standard_points_per_finisher, expertise_earned, total_expertise, live_stream_active,
          season_id, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        level.SnapshotId,
        level.SchemaVersion,
        level.GeneratedAtUtc,
        new Date().toISOString(),
        level.Status,
        level.GameMode,
        level.SessionType,
        level.Level,
        level.Difficulty,
        level.LevelDurationSeconds,
        level.LevelPassed ? 1 : 0,
        level.PlayerCount,
        level.FinishedCount,
        level.EliminatedCount,
        level.TopTilteePlatform,
        level.TopTilteeUsername,
        level.StandardPointsPerFinisher,
        level.ExpertiseEarned,
        level.TotalExpertise,
        level.LiveStreamActive ? 1 : 0,
        seasonId,
        JSON.stringify({ level, players })
      )

    tiltEventId = insertResult.lastInsertRowid as number

    for (const p of players) {
      const racerId = upsertRacer(db, {
        username: p.Username,
        displayName: p.DisplayName,
        platform: p.Platform,
        nameColorHex: p.NameColorHex
      })

      db.prepare(
        `INSERT INTO tilt_participants (
          tilt_event_id, racer_id, position, time_on_board_seconds, level_points_earned, eliminated
        ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(tiltEventId, racerId, p.Position, p.TimeOnBoardSeconds, p.LevelPointsEarned, p.Eliminated ? 1 : 0)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  broadcast({ type: 'tilt-event', snapshotId: level.SnapshotId })
  return tiltEventId
}
