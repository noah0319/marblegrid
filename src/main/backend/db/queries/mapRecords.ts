import { getDb } from '../db.ts'
import { mapKey } from './mapKey.ts'
import { getMapCommunityStats } from './mapCommunity.ts'
import type { MapRecord, MapCommunityStat } from '../../../../shared/types.ts'

interface ComputedRow {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
}

interface PlayCountRow {
  mapName: string
  mapCreator: string
  timesPlayed: number
}

interface OverrideRow {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
}

/**
 * Best (lowest) finish time ever captured per map, all-time — not scoped to
 * a season, since a map record is about the map, not a season's standings.
 * Playing the same map again never adds a second row: it either beats the
 * existing record (replaces it) or doesn't (existing record stands) — never
 * both showing at once. Verified both directions in map-records.test.ts.
 *
 * eliminated = 0 is not optional: a participant who got knocked out early
 * has a LOW time_in_race_seconds too (how long they survived, not how long
 * they took to finish), which would otherwise show up as a false "record".
 * Confirmed against the real fixture — eg. one real eliminated racer clocks
 * 29s despite finishing nowhere near first; the real fastest finisher on
 * that map took 133s. Position/points are consistent with time only among
 * actual finishers (also confirmed against the real sample), so this only
 * ever needs to compare within that group.
 *
 * Map-name comparisons are COLLATE NOCASE throughout: this game has a
 * confirmed real pattern of inconsistent capitalization elsewhere (season
 * .sav filenames — "season 55.sav" vs "Season 63.sav"), so if the same map
 * ever gets reported with different casing across two plays, it must still
 * be treated as one map, not silently split into two records.
 *
 * Identity is (map_name, map_creator) together, NOT map_name alone — per
 * Noah directly: different creators can and do reuse the same map name
 * (he confirmed a real one: "feel the fire" is by zim2325, implying he's
 * aware of/expects a same-named map from someone else). Grouping by name
 * only would have silently merged two unrelated maps' times into one
 * record the instant that happened.
 *
 * Three sources merged in JS rather than one giant query:
 * 1. Computed best times (as above).
 * 2. Play counts — a SEPARATE, always-accurate tally of every race_event
 *    per map, independent of whether anyone finished. Doing this apart from
 *    (1) matters: a map attempted several times but never once finished
 *    would otherwise be undercounted (or missing) if play count were
 *    derived from the same finisher-only query as the best time.
 * 3. Manual overrides (Noah's ask) — always win when present, for a map
 *    with or without any real captured plays. timesPlayed still reflects
 *    reality even when overridden; only the racer/time can be overridden,
 *    not how many times it's actually been raced.
 */
export function getMapRecords(): MapRecord[] {
  const db = getDb()

  const computed = db
    .prepare(
      `SELECT
         re.map_name as mapName,
         re.map_creator as mapCreator,
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
           WHERE re2.map_name = re.map_name COLLATE NOCASE
             AND re2.map_creator = re.map_creator COLLATE NOCASE
             AND rp2.eliminated = 0
         )
       GROUP BY re.map_name COLLATE NOCASE, re.map_creator COLLATE NOCASE`
    )
    .all() as unknown as ComputedRow[]

  const playCounts = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator, COUNT(DISTINCT id) as timesPlayed
       FROM race_events
       GROUP BY map_name COLLATE NOCASE, map_creator COLLATE NOCASE`
    )
    .all() as unknown as PlayCountRow[]

  const overrides = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator, racer_name as racerName,
              time_seconds as timeSeconds, set_at as achievedAt
       FROM map_record_overrides`
    )
    .all() as unknown as OverrideRow[]

  const playCountByKey = new Map(playCounts.map((p) => [mapKey(p.mapName, p.mapCreator), p.timesPlayed]))

  const byKey = new Map<string, MapRecord>()
  for (const row of computed) {
    const key = mapKey(row.mapName, row.mapCreator)
    byKey.set(key, { ...row, timesPlayed: playCountByKey.get(key) ?? 0, isManualOverride: false })
  }
  for (const override of overrides) {
    const key = mapKey(override.mapName, override.mapCreator)
    byKey.set(key, { ...override, timesPlayed: playCountByKey.get(key) ?? 0, isManualOverride: true })
  }

  return [...byKey.values()].sort((a, b) => a.mapName.localeCompare(b.mapName))
}

/** Sets (or replaces) a manual override for a map — always wins over the computed record until cleared. */
export function setMapRecordOverride(opts: {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
}): void {
  const db = getDb()
  db.prepare(
    `INSERT INTO map_record_overrides (map_name, map_creator, racer_name, time_seconds, set_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(map_name, map_creator) DO UPDATE SET
       racer_name = excluded.racer_name, time_seconds = excluded.time_seconds, set_at = excluded.set_at`
  ).run(opts.mapName, opts.mapCreator, opts.racerName, opts.timeSeconds, new Date().toISOString())
}

/** Reverts a map back to its automatically-computed record (a no-op if it was never overridden). */
export function clearMapRecordOverride(mapName: string, mapCreator: string): void {
  const db = getDb()
  db.prepare(`DELETE FROM map_record_overrides WHERE map_name = ? AND map_creator = ?`).run(mapName, mapCreator)
}

export interface SeasonRecordBroken {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  /** Null when this is the map's first-ever race THIS season — still a real season record, just nothing to compare against. */
  previousTimeSeconds: number | null
  previousRacerName: string | null
}

/**
 * Noah's ask, from a real investigation into why "world record" alerts
 * (customMapPlayed.ts, gated on the game's own — often laggy — record
 * file) sometimes miss or lag: other community tools appear to announce a
 * SEASON-scoped local best instead of the game's true global record. Noah
 * confirmed this directly — a run slower than his own all-time Ghost Ball
 * still got called a record elsewhere, because the faster time was from a
 * DIFFERENT season. This is that same concept for MarbleGrid: purely local
 * data (race_participants/race_events, exactly what getMapRecordHistory
 * already uses for the all-time version), zero dependency on the game's
 * file or its lag, fires the instant a race commits.
 *
 * Deliberately labeled "season record" everywhere (never "world record")
 * so it's never confused with — or treated as a replacement for — the
 * actual game-verified feature this sits alongside. Also deliberately DOES
 * fire on a map's first-ever race this season (previousTimeSeconds null),
 * unlike the world-record feature's first-sighting rule — Noah confirmed
 * the apps he's comparing against do this too, and unlike the world-record
 * case there's no risk of misattributing a stranger's run here: every row
 * this reads is already a real local race on THIS channel.
 *
 * Scoped to ONE map (whichever was just raced) relative to ONE specific
 * race event, not a full chronological walk — getMapRecordHistory already
 * covers "show me everything," this covers "did THIS race that just
 * happened change anything," which is a cheaper, more targeted question to
 * answer live after every single race.
 */
export function findSeasonRecordBreak(
  raceEventId: number,
  mapName: string,
  mapCreator: string,
  seasonId: number | null
): SeasonRecordBroken | null {
  const db = getDb()

  const thisRaceBest = db
    .prepare(
      `SELECT rp.time_in_race_seconds as timeSeconds, COALESCE(NULLIF(r.display_name, ''), r.username) as racerName
       FROM race_participants rp
       JOIN racers r ON r.id = rp.racer_id
       WHERE rp.race_event_id = ? AND rp.eliminated = 0
         AND rp.time_in_race_seconds IS NOT NULL AND rp.time_in_race_seconds > 0
       ORDER BY rp.time_in_race_seconds ASC LIMIT 1`
    )
    .get(raceEventId) as { timeSeconds: number; racerName: string } | undefined
  if (!thisRaceBest) return null

  const priorBest = db
    .prepare(
      `SELECT MIN(rp.time_in_race_seconds) as timeSeconds
       FROM race_participants rp
       JOIN race_events re ON re.id = rp.race_event_id
       WHERE re.map_name = ? COLLATE NOCASE AND re.map_creator = ? COLLATE NOCASE
         AND re.season_id IS ? AND re.id != ?
         AND rp.eliminated = 0 AND rp.time_in_race_seconds IS NOT NULL AND rp.time_in_race_seconds > 0`
    )
    .get(mapName, mapCreator, seasonId, raceEventId) as { timeSeconds: number | null } | undefined

  const priorTime = priorBest?.timeSeconds ?? null
  if (priorTime !== null && thisRaceBest.timeSeconds >= priorTime) return null

  let previousRacerName: string | null = null
  if (priorTime !== null) {
    const holder = db
      .prepare(
        `SELECT COALESCE(NULLIF(r.display_name, ''), r.username) as racerName
         FROM race_participants rp
         JOIN race_events re ON re.id = rp.race_event_id
         JOIN racers r ON r.id = rp.racer_id
         WHERE re.map_name = ? COLLATE NOCASE AND re.map_creator = ? COLLATE NOCASE
           AND re.season_id IS ? AND re.id != ?
           AND rp.eliminated = 0 AND rp.time_in_race_seconds = ?
         LIMIT 1`
      )
      .get(mapName, mapCreator, seasonId, raceEventId, priorTime) as { racerName: string } | undefined
    previousRacerName = holder?.racerName ?? null
  }

  return {
    mapName,
    mapCreator,
    racerName: thisRaceBest.racerName,
    timeSeconds: thisRaceBest.timeSeconds,
    previousTimeSeconds: priorTime,
    previousRacerName
  }
}

export interface LastPlayedMap {
  mapName: string
  mapCreator: string
}

/** The most recent Race-mode map played, if any — powers !lastmap. Race mode only, same scope as everything else in this file (Tilt/Royale don't have a "map" the same way). */
export function getLastPlayedMap(): LastPlayedMap | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator
       FROM race_events
       WHERE map_name IS NOT NULL AND map_name != ''
       ORDER BY captured_at_local DESC
       LIMIT 1`
    )
    .get() as LastPlayedMap | undefined
  return row ?? null
}

export interface LastMapSummary {
  mapName: string
  mapCreator: string
  community: MapCommunityStat | undefined
  record: MapRecord | undefined
}

/**
 * Everything !lastmap (the chat command) and the auto-post-after-each-race
 * toggle both need — kept as ONE shared function so the two features can
 * never drift into showing different numbers for "the last map." Formatting
 * lives separately in messageTemplates.ts's buildLastMapMessage, which both
 * call sites also share.
 */
export function getLastMapSummary(): LastMapSummary | null {
  const last = getLastPlayedMap()
  if (!last) return null
  const key = mapKey(last.mapName, last.mapCreator)
  return {
    mapName: last.mapName,
    mapCreator: last.mapCreator,
    community: getMapCommunityStats().find((m) => mapKey(m.mapName, m.mapCreator) === key),
    record: getMapRecords().find((m) => mapKey(m.mapName, m.mapCreator) === key)
  }
}
