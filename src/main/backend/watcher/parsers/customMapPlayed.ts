import { readFile } from 'fs/promises'
import { join } from 'path'
import { parse } from 'csv-parse/sync'
import { z } from 'zod'
import { getDb } from '../../db/db.ts'
import { MARBLES_SAVE_DIR } from '../paths.ts'
import { maybePostWorldRecordToChat } from '../../twitch/chatPoster.ts'
import { broadcast } from '../../ws.ts'

const csvNumber = z.coerce.number()

// LastCustomRaceMapPlayed.csv — flagged out-of-scope in the original plan
// pending schema verification. Confirmed real, 2026-08-13:
// MapName,CreatorName,DateCreated,TotalRaces,ElimRate,AverageFinishTime,
// RecordTime,RecordHolderName,DateSet,StreamerRecordHolder. DateSet uses a
// non-ISO format ("2026.08.08-23.24.48") with an unconfirmed timezone —
// deliberately never parsed into an absolute time anywhere in this module,
// see ingestCustomMapPlayedFromText's doc comment for why. StreamerRecordHolder's
// exact meaning is still unconfirmed (a username, not a boolean) and unused here.
const CustomMapPlayedSchema = z.object({
  MapName: z.string().min(1),
  CreatorName: z.string(),
  DateCreated: z.string(),
  TotalRaces: csvNumber,
  ElimRate: csvNumber,
  AverageFinishTime: csvNumber,
  RecordTime: csvNumber,
  RecordHolderName: z.string(),
  DateSet: z.string(),
  StreamerRecordHolder: z.string()
})

export interface WorldRecordBroken {
  mapName: string
  mapCreator: string
  recordHolderName: string
  recordTimeSeconds: number
  previousRecordTimeSeconds: number
  previousRecordHolderName: string
  /** Null if no matching race could be cross-referenced — the alert still fires without points rather than being blocked on this. */
  pointsEarned: number | null
}

export async function ingestCustomMapPlayedFile(dir: string = MARBLES_SAVE_DIR): Promise<WorldRecordBroken | null> {
  const text = await readFile(join(dir, 'LastCustomRaceMapPlayed.csv'), 'utf-8')
  return ingestCustomMapPlayedFromText(text)
}

/**
 * A single overwritten snapshot reflecting whichever custom map was most
 * recently played (not a log — see 00 Game & Data Reference). Detects a
 * world record being broken by DIFFING the reported RecordTime against the
 * last-known record MarbleGrid has stored for this exact map, rather than
 * by parsing DateSet's absolute value — DateSet uses a non-ISO format with
 * an unconfirmed timezone, so comparing it against "now" isn't reliable.
 * Diffing sidesteps that entirely: genuinely faster than what was already on
 * file is genuinely faster, full stop, no timezone math needed.
 *
 * The FIRST time a given map is ever seen, there's nothing to diff against
 * — silently stores the baseline rather than firing an alert, same caution
 * as fileWatcher.ts's stale-catchup fix: a map's pre-existing record must
 * never be reported as "just broken" the first time MarbleGrid happens to
 * observe it.
 */
export function ingestCustomMapPlayedFromText(text: string): WorldRecordBroken | null {
  const rows = parse(text, { columns: true, trim: true, skip_empty_lines: true }) as Record<string, string>[]
  if (rows.length === 0) return null
  const row = CustomMapPlayedSchema.parse(rows[0])

  const db = getDb()
  const existing = db
    .prepare(
      `SELECT record_time_seconds as recordTimeSeconds, record_holder_name as recordHolderName
       FROM custom_map_records WHERE map_name = ? COLLATE NOCASE AND map_creator = ? COLLATE NOCASE`
    )
    .get(row.MapName, row.CreatorName) as { recordTimeSeconds: number; recordHolderName: string } | undefined

  const now = new Date().toISOString()

  if (!existing) {
    db.prepare(
      `INSERT INTO custom_map_records (map_name, map_creator, record_time_seconds, record_holder_name, date_set_raw, first_seen_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(row.MapName, row.CreatorName, row.RecordTime, row.RecordHolderName, row.DateSet, now, now)
    return null
  }

  if (row.RecordTime >= existing.recordTimeSeconds) {
    // Same map played again, existing record not beaten — nothing to update, nothing to announce.
    return null
  }

  db.prepare(
    `UPDATE custom_map_records SET record_time_seconds = ?, record_holder_name = ?, date_set_raw = ?, updated_at = ?
     WHERE map_name = ? COLLATE NOCASE AND map_creator = ? COLLATE NOCASE`
  ).run(row.RecordTime, row.RecordHolderName, row.DateSet, now, row.MapName, row.CreatorName)

  const broken: WorldRecordBroken = {
    mapName: row.MapName,
    mapCreator: row.CreatorName,
    recordHolderName: row.RecordHolderName,
    recordTimeSeconds: row.RecordTime,
    previousRecordTimeSeconds: existing.recordTimeSeconds,
    previousRecordHolderName: existing.recordHolderName,
    pointsEarned: lookUpPointsForRecord(row.MapName, row.CreatorName, row.RecordHolderName)
  }

  void maybePostWorldRecordToChat(broken)
  // Noah's ask: a celebration on the OBS overlay too, not just chat. Purely
  // a live push (see WorldRecordPayload's doc comment) — the overlay hook
  // has no GET/catch-up counterpart the way race results do.
  broadcast({ type: 'world-record-event', ...broken })
  return broken
}

/**
 * Best-effort cross-reference to the matching real race for points — the
 * custom-map file itself has no points field. Looks at the MOST RECENT race
 * on this exact map, on the assumption the record-breaking run and that race
 * are the same underlying event (both files get written by the same race
 * completing). Matches on the racer's DISPLAY name, not username —
 * RecordHolderName is reported in display-name form (eg. "QueenRainbowCow"),
 * not the lowercase form racers.username is normalized to.
 */
function lookUpPointsForRecord(mapName: string, mapCreator: string, racerDisplayName: string): number | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT rp.season_points_earned as points
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.map_name = ? COLLATE NOCASE AND re.map_creator = ? COLLATE NOCASE
         AND r.display_name = ? COLLATE NOCASE
       ORDER BY re.captured_at_local DESC
       LIMIT 1`
    )
    .get(mapName, mapCreator, racerDisplayName) as { points: number } | undefined
  return row?.points ?? null
}
