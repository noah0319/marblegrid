import { getDb } from '../db.ts'
import { mapKey } from './mapKey.ts'
import type { MapHistoryEntry } from '../../../../shared/types.ts'

interface RaceBestRow {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
}

interface OverrideRow {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
}

/**
 * Every time a map's record actually changed hands — Noah's ask: "a history
 * of when it was beaten and by who." Derived entirely from existing race
 * data at query time, no new storage: walks every race chronologically per
 * map, keeping a running best, and emits an entry only when a race's fastest
 * finisher beats the running best. Returned newest-first.
 *
 * One row per RACE (its own fastest eliminated=0 finisher), not one row per
 * participant — a race's slower finishers can never set a new best if its
 * own fastest finisher didn't beat the record, so per-race is equivalent to
 * per-participant here and cheaper. Same eliminated=0 filter and correlated
 * MIN-per-race subquery reasoning as getMapRecords.
 *
 * A manual override always appears as its map's current/most-recent entry
 * (matches getMapRecords' "overrides always win" rule) with previousTime/
 * RacerName pulled from wherever the real computed progression had reached —
 * not necessarily the immediately-prior real race chronologically, since an
 * override is a deliberate pin, not itself a race result.
 */
export function getMapRecordHistory(): MapHistoryEntry[] {
  const db = getDb()

  const raceBests = db
    .prepare(
      `SELECT
         re.map_name as mapName,
         re.map_creator as mapCreator,
         re.captured_at_local as achievedAt,
         rp.time_in_race_seconds as timeSeconds,
         COALESCE(NULLIF(r.display_name, ''), r.username) as racerName
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       JOIN racers r ON r.id = rp.racer_id
       WHERE rp.eliminated = 0
         AND rp.time_in_race_seconds IS NOT NULL
         AND rp.time_in_race_seconds > 0
         AND re.map_name IS NOT NULL AND re.map_name != ''
         AND rp.time_in_race_seconds = (
           SELECT MIN(rp2.time_in_race_seconds)
           FROM race_participants rp2
           WHERE rp2.race_event_id = re.id AND rp2.eliminated = 0 AND rp2.time_in_race_seconds IS NOT NULL
         )
       ORDER BY re.captured_at_local ASC`
    )
    .all() as unknown as RaceBestRow[]

  const running = new Map<string, { timeSeconds: number; racerName: string }>()
  const history: MapHistoryEntry[] = []

  for (const row of raceBests) {
    const key = mapKey(row.mapName, row.mapCreator)
    const prev = running.get(key)
    if (!prev || row.timeSeconds < prev.timeSeconds) {
      history.push({
        mapName: row.mapName,
        mapCreator: row.mapCreator,
        racerName: row.racerName,
        timeSeconds: row.timeSeconds,
        achievedAt: row.achievedAt,
        previousTimeSeconds: prev ? prev.timeSeconds : null,
        previousRacerName: prev ? prev.racerName : null,
        isManualOverride: false
      })
      running.set(key, { timeSeconds: row.timeSeconds, racerName: row.racerName })
    }
  }

  const overrides = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator, racer_name as racerName,
              time_seconds as timeSeconds, set_at as achievedAt
       FROM map_record_overrides`
    )
    .all() as unknown as OverrideRow[]

  for (const o of overrides) {
    const prev = running.get(mapKey(o.mapName, o.mapCreator))
    history.push({
      mapName: o.mapName,
      mapCreator: o.mapCreator,
      racerName: o.racerName,
      timeSeconds: o.timeSeconds,
      achievedAt: o.achievedAt,
      previousTimeSeconds: prev ? prev.timeSeconds : null,
      previousRacerName: prev ? prev.racerName : null,
      isManualOverride: true
    })
    // Deliberately not updating `running` here — this loop only ever reads
    // it, never writes back into it after this point.
  }

  return history.sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1))
}
