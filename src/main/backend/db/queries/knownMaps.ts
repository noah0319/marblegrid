import { getDb } from '../db.ts'

export interface KnownMap {
  mapName: string
  mapCreator: string
}

/**
 * Every distinct map ever captured, regardless of whether anyone finished —
 * deliberately broader than getMapRecords() (which only lists maps with a
 * finisher or a manual override). Notes wants the full universe: Noah should
 * be able to leave a note on a map before anyone's beaten it, same as he can
 * override a record on one with zero captured plays.
 *
 * GROUP BY ... COLLATE NOCASE, not SELECT DISTINCT — a raw DISTINCT would
 * treat "feel the fire" and "Feel The Fire" as two different maps, the exact
 * same capitalization-inconsistency risk documented in getMapRecords.
 */
export function getKnownMaps(): KnownMap[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator
       FROM race_events
       WHERE map_name IS NOT NULL AND map_name != ''
       GROUP BY map_name COLLATE NOCASE, map_creator COLLATE NOCASE`
    )
    .all() as unknown as KnownMap[]
}
