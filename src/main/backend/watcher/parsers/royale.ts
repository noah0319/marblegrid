import { readFile } from 'fs/promises'
import { join } from 'path'
import { createHash } from 'crypto'
import { parse } from 'csv-parse/sync'
import { getDb } from '../../db/db.ts'
import { upsertRacer } from '../../db/queries/racers.ts'
import { getOpenSeasonId } from '../../db/queries/seasons.ts'
import { RoyaleParticipantSchema } from '../../../../shared/types.ts'
import { MARBLES_SAVE_DIR } from '../paths.ts'
import { broadcast } from '../../ws.ts'

export async function ingestRoyaleFile(dir: string = MARBLES_SAVE_DIR): Promise<number | null> {
  const text = await readFile(join(dir, 'LastSeasonRoyale.csv'), 'utf-8')
  return ingestRoyaleFromText(text)
}

// No SnapshotId and no timestamp field in this file (confirmed — see
// 00 Game & Data Reference), unlike Race/Tilt — so the whole file's content
// hash is the dedupe key, and "now" is the best available event-time proxy.
// No Platform column either; every confirmed sample across every file this
// session was Platform=Twitch, so that's assumed here rather than guessed
// per-row — revisit if a non-Twitch platform ever shows up.
export function ingestRoyaleFromText(text: string): number | null {
  const rows = parse(text, { columns: true, trim: true, skip_empty_lines: true }) as Record<string, string>[]
  if (rows.length === 0) return null

  const contentHash = createHash('sha256').update(text.trim()).digest('hex')

  const db = getDb()
  const already = db.prepare('SELECT id FROM royale_events WHERE content_hash = ?').get(contentHash) as
    | { id: number }
    | undefined
  if (already) return already.id

  const participants = rows.map((r) => RoyaleParticipantSchema.parse(r))
  const seasonId = getOpenSeasonId()
  let royaleEventId: number

  db.exec('BEGIN')
  try {
    const insertResult = db
      .prepare(
        `INSERT INTO royale_events (content_hash, captured_at_local, player_count, season_id, raw_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(contentHash, new Date().toISOString(), participants.length, seasonId, JSON.stringify(participants))

    royaleEventId = insertResult.lastInsertRowid as number

    for (const p of participants) {
      const racerId = upsertRacer(db, {
        username: p.Username,
        displayName: p.Displayname,
        platform: 'Twitch',
        nameColorHex: p.NameColor
      })

      db.prepare(
        `INSERT INTO royale_participants (
          royale_event_id, racer_id, position, points_earned, eliminated, eliminations, damage_dealt
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(royaleEventId, racerId, p.Position, p.PointsEarned, p.Eliminated ? 1 : 0, p.Eliminations, p.DamageDealt)
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }

  broadcast({ type: 'royale-event', contentHash })
  return royaleEventId
}
