import { getDb } from '../db.ts'
import type { MapRecord } from '../../../../shared/types.ts'

/**
 * Best (lowest) finish time ever captured per map, all-time — not scoped to
 * a season, since a map record is about the map, not a season's standings.
 *
 * eliminated = 0 is not optional: a participant who got knocked out early
 * has a LOW time_in_race_seconds too (how long they survived, not how long
 * they took to finish), which would otherwise show up as a false "record".
 * Confirmed against the real fixture — eg. one real eliminated racer clocks
 * 29s despite finishing nowhere near first; the real fastest finisher on
 * that map took 133s. Position/points are consistent with time only among
 * actual finishers (also confirmed against the real sample), so this only
 * ever needs to compare within that group.
 */
export function getMapRecords(): MapRecord[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT
         re.map_name as mapName,
         r.display_name as racerName,
         rp.time_in_race_seconds as timeSeconds,
         re.captured_at_local as achievedAt
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE rp.eliminated = 0
         AND rp.time_in_race_seconds IS NOT NULL
         AND rp.time_in_race_seconds > 0
         AND rp.time_in_race_seconds = (
           SELECT MIN(rp2.time_in_race_seconds)
           FROM race_participants rp2
           JOIN race_events re2 ON re2.id = rp2.race_event_id
           WHERE re2.map_name = re.map_name AND rp2.eliminated = 0
         )
       GROUP BY re.map_name
       ORDER BY re.map_name COLLATE NOCASE`
    )
    .all() as unknown as MapRecord[]
}
