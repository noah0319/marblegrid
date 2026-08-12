import { getDb } from '../db.ts'
import { mapKey } from './mapKey.ts'
import type { MapCommunityStat } from '../../../../shared/types.ts'

interface RaceAggRow {
  mapName: string
  mapCreator: string
  totalPlayers: number
  totalEliminated: number
  raceCount: number
}

interface FinishAggRow {
  mapName: string
  mapCreator: string
  avgFinishSeconds: number
}

/**
 * Per-map engagement stats — Noah's ask: "death rate/avg finish, etc."
 * Scoped to Race mode only, same as Ghost Balls/getMapRecords — Tilt and
 * Royale don't have a "map" concept the same way.
 *
 * Death rate uses race_events' own eliminated_count/player_count (the game's
 * own reported totals per race), not a recount from race_participants —
 * cheaper, and it's the same source already trusted elsewhere in the app.
 * It's participant-weighted (SUM(eliminated)/SUM(players) across every race
 * on the map), not an average of each race's own rate — a map raced once
 * with 40 players counts for more than one raced once with 4.
 *
 * Avg finish time needs race_participants separately (eliminated = 0 only —
 * see getMapRecords for why: an eliminated racer's time_in_race_seconds is
 * how long they survived, not a finish time, so it must never factor into an
 * average finish time either). A map nobody has ever finished correctly
 * reports avgFinishSeconds: null — genuinely no data, not 0 or NaN.
 *
 * Includes every map that's ever been played, even ones nobody's finished —
 * unlike getMapRecords, which only lists maps with a finisher or an
 * override. A brutal map with a 100% elimination rate is exactly the kind of
 * thing "death rate" exists to surface, so it can't be gated on having a
 * finish time the way the record computation is.
 */
export function getMapCommunityStats(): MapCommunityStat[] {
  const db = getDb()

  const raceAgg = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator,
              SUM(player_count) as totalPlayers,
              SUM(eliminated_count) as totalEliminated,
              COUNT(*) as raceCount
       FROM race_events
       WHERE map_name IS NOT NULL AND map_name != ''
       GROUP BY map_name COLLATE NOCASE, map_creator COLLATE NOCASE`
    )
    .all() as unknown as RaceAggRow[]

  const finishAgg = db
    .prepare(
      `SELECT re.map_name as mapName, re.map_creator as mapCreator,
              AVG(rp.time_in_race_seconds) as avgFinishSeconds
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       WHERE rp.eliminated = 0
         AND rp.time_in_race_seconds IS NOT NULL
         AND rp.time_in_race_seconds > 0
         AND re.map_name IS NOT NULL AND re.map_name != ''
       GROUP BY re.map_name COLLATE NOCASE, re.map_creator COLLATE NOCASE`
    )
    .all() as unknown as FinishAggRow[]

  const finishByKey = new Map(finishAgg.map((f) => [mapKey(f.mapName, f.mapCreator), f.avgFinishSeconds]))

  return raceAgg
    .map((r) => ({
      mapName: r.mapName,
      mapCreator: r.mapCreator,
      raceCount: r.raceCount,
      deathRatePercent: r.totalPlayers > 0 ? (r.totalEliminated / r.totalPlayers) * 100 : 0,
      avgFinishSeconds: finishByKey.get(mapKey(r.mapName, r.mapCreator)) ?? null
    }))
    .sort((a, b) => a.mapName.localeCompare(b.mapName))
}
