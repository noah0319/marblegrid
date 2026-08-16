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

  // Baseline always updates to the game's real current record, regardless of
  // who/where it happened — !ghostballs and everything else that reads this
  // table needs it accurate either way.
  db.prepare(
    `UPDATE custom_map_records SET record_time_seconds = ?, record_holder_name = ?, date_set_raw = ?, updated_at = ?
     WHERE map_name = ? COLLATE NOCASE AND map_creator = ? COLLATE NOCASE`
  ).run(row.RecordTime, row.RecordHolderName, row.DateSet, now, row.MapName, row.CreatorName)

  // Noah's ask, from a real false-positive he caught: "I only want the world
  // record to populate a message if the streamer using the app beats a
  // map." LastCustomRaceMapPlayed.csv is the GAME's own global snapshot —
  // it reflects whichever custom map was most recently played by ANYONE,
  // not scoped to this channel. Without this gate, a genuinely faster time
  // set on a completely different stream shows up here the next time this
  // streamer merely PLAYS the same map (which is what re-triggers the file
  // to update on their own PC), and gets misreported as if it just happened
  // on their own channel. Fix: only announce if THIS channel's own captured
  // races actually contain a matching finish (same map, holder name, AND
  // time) — that's the only way to know the record-breaking run really
  // happened here, not just that the file's cached view of it changed.
  const localMatch = findLocalRecordBreak(row.MapName, row.CreatorName, row.RecordHolderName, row.RecordTime)
  if (!localMatch) {
    return null
  }

  const broken: WorldRecordBroken = {
    mapName: row.MapName,
    mapCreator: row.CreatorName,
    recordHolderName: row.RecordHolderName,
    recordTimeSeconds: row.RecordTime,
    previousRecordTimeSeconds: existing.recordTimeSeconds,
    previousRecordHolderName: existing.recordHolderName,
    pointsEarned: localMatch.points
  }

  void maybePostWorldRecordToChat(broken)
  // Noah's ask: a celebration on the OBS overlay too, not just chat. Purely
  // a live push (see WorldRecordPayload's doc comment) — the overlay hook
  // has no GET/catch-up counterpart the way race results do.
  broadcast({ type: 'world-record-event', ...broken })
  return broken
}

/**
 * The gate for whether a reported record break actually happened on THIS
 * channel: searches this channel's own recent races on the exact map for a
 * finisher whose display name AND time both match what the file just
 * reported. Only a match on BOTH is trusted — name alone could coincidentally
 * match an unrelated earlier run at a different (slower) time; time alone
 * says nothing about who. Checks the last few races on the map, not just the
 * single most recent one, so this isn't fragile to exact event ordering.
 *
 * Time is compared with a small tolerance (0.05s) rather than exact equality
 * — the same underlying finish gets written to two different game-generated
 * files (LastSeasonRace.csv's TimeInRaceSeconds vs. this file's RecordTime),
 * and floating-point/formatting drift between them is plausible even though
 * they describe the same run.
 *
 * Matches on the racer's DISPLAY name, not username — RecordHolderName is
 * reported in display-name form (eg. "QueenRainbowCow"), not the lowercase
 * form racers.username is normalized to.
 */
function findLocalRecordBreak(
  mapName: string,
  mapCreator: string,
  racerDisplayName: string,
  recordTimeSeconds: number
): { points: number } | null {
  const db = getDb()
  const candidates = db
    .prepare(
      `SELECT rp.season_points_earned as points, rp.time_in_race_seconds as timeInRaceSeconds
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE re.map_name = ? COLLATE NOCASE AND re.map_creator = ? COLLATE NOCASE
         AND r.display_name = ? COLLATE NOCASE
       ORDER BY re.captured_at_local DESC
       LIMIT 5`
    )
    .all(mapName, mapCreator, racerDisplayName) as { points: number; timeInRaceSeconds: number }[]

  const match = candidates.find((c) => Math.abs(c.timeInRaceSeconds - recordTimeSeconds) < 0.05)
  return match ? { points: match.points } : null
}
