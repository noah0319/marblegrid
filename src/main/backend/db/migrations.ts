export interface Migration {
  id: string
  sql: string
}

// SQLite has no real BOOLEAN type (node:sqlite will throw if you try to bind
// a JS boolean directly) — eliminated/level_passed/live_stream_active are all
// stored as INTEGER 0/1, converted explicitly at the parser layer.
export const MIGRATIONS: Migration[] = [
  {
    id: '001_init',
    sql: `
CREATE TABLE IF NOT EXISTS racers (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  platform TEXT,
  name_color_hex TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY,
  season_number INTEGER,
  source TEXT NOT NULL CHECK(source IN ('sav_filename','manual_override')),
  sav_filename TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS raw_snapshots (
  id INTEGER PRIMARY KEY,
  source_file TEXT NOT NULL,
  captured_at_local TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_csv_text TEXT NOT NULL,
  UNIQUE(source_file, content_hash)
);

CREATE TABLE IF NOT EXISTS race_events (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT UNIQUE NOT NULL,
  schema_version INTEGER,
  generated_at_utc TEXT,
  captured_at_local TEXT NOT NULL,
  status TEXT,
  game_mode TEXT,
  session_type TEXT,
  map_name TEXT,
  map_creator TEXT,
  player_count INTEGER,
  finished_count INTEGER,
  eliminated_count INTEGER,
  winner_platform TEXT,
  winner_username TEXT,
  season_id INTEGER REFERENCES seasons(id),
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS race_participants (
  id INTEGER PRIMARY KEY,
  race_event_id INTEGER NOT NULL REFERENCES race_events(id),
  racer_id INTEGER NOT NULL REFERENCES racers(id),
  position INTEGER,
  season_points_earned INTEGER,
  season_points_total INTEGER,
  season_wins_total INTEGER,
  season_matches_played_total INTEGER,
  time_in_race_seconds REAL,
  eliminated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(race_event_id, racer_id)
);

CREATE TABLE IF NOT EXISTS tilt_events (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT UNIQUE NOT NULL,
  schema_version INTEGER,
  generated_at_utc TEXT,
  captured_at_local TEXT NOT NULL,
  status TEXT,
  game_mode TEXT,
  session_type TEXT,
  level INTEGER,
  difficulty INTEGER,
  level_duration_seconds REAL,
  level_passed INTEGER NOT NULL DEFAULT 0,
  player_count INTEGER,
  finished_count INTEGER,
  eliminated_count INTEGER,
  top_tiltee_platform TEXT,
  top_tiltee_username TEXT,
  standard_points_per_finisher INTEGER,
  expertise_earned INTEGER,
  total_expertise INTEGER,
  live_stream_active INTEGER NOT NULL DEFAULT 0,
  season_id INTEGER REFERENCES seasons(id),
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tilt_participants (
  id INTEGER PRIMARY KEY,
  tilt_event_id INTEGER NOT NULL REFERENCES tilt_events(id),
  racer_id INTEGER NOT NULL REFERENCES racers(id),
  position INTEGER,
  time_on_board_seconds REAL,
  level_points_earned INTEGER,
  eliminated INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tilt_event_id, racer_id)
);

CREATE TABLE IF NOT EXISTS royale_events (
  id INTEGER PRIMARY KEY,
  content_hash TEXT UNIQUE NOT NULL,
  captured_at_local TEXT NOT NULL,
  player_count INTEGER,
  season_id INTEGER REFERENCES seasons(id),
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS royale_participants (
  id INTEGER PRIMARY KEY,
  royale_event_id INTEGER NOT NULL REFERENCES royale_events(id),
  racer_id INTEGER NOT NULL REFERENCES racers(id),
  position INTEGER,
  points_earned INTEGER,
  eliminated INTEGER NOT NULL DEFAULT 0,
  eliminations INTEGER,
  damage_dealt INTEGER,
  UNIQUE(royale_event_id, racer_id)
);

CREATE TABLE IF NOT EXISTS chat_post_log (
  id INTEGER PRIMARY KEY,
  race_event_id INTEGER,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_race_events_captured_at ON race_events(captured_at_local);
CREATE INDEX IF NOT EXISTS idx_tilt_events_captured_at ON tilt_events(captured_at_local);
CREATE INDEX IF NOT EXISTS idx_royale_events_captured_at ON royale_events(captured_at_local);
CREATE INDEX IF NOT EXISTS idx_race_participants_racer ON race_participants(racer_id);
CREATE INDEX IF NOT EXISTS idx_tilt_participants_racer ON tilt_participants(racer_id);
CREATE INDEX IF NOT EXISTS idx_royale_participants_racer ON royale_participants(racer_id);
`
  },
  {
    // 001's chat_post_log only keyed on race_event_id, but Phase 5 posts for
    // Race/Tilt/Royale alike. Never had real rows written (Phase 5 didn't
    // exist yet), so a clean drop-and-recreate is safe — no data migration
    // needed. Keyed on (event_kind, event_occurred_at) to match
    // getLatestEvent()'s existing normalized shape rather than inventing a
    // second identity scheme.
    id: '002_chat_post_log_rework',
    sql: `
DROP TABLE IF EXISTS chat_post_log;

CREATE TABLE chat_post_log (
  id INTEGER PRIMARY KEY,
  event_kind TEXT NOT NULL,
  event_occurred_at TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL,
  message TEXT,
  error TEXT,
  UNIQUE(event_kind, event_occurred_at)
);
`
  },
  {
    // Lets Noah manually set (or correct) a map's Ghost Balls record instead
    // of only ever accepting whatever the automatic best-time computation
    // finds — see getMapRecords(). One row per (map_name, map_creator),
    // same identity scheme as the computed records; setting a new override
    // for a map that already has one replaces it (UPSERT), it doesn't stack.
    //
    // map_name/map_creator are COLLATE NOCASE at the COLUMN level (unlike
    // the older race_events, where this is applied per-query instead) — a
    // brand new table has no retrofit cost, and defining it here makes the
    // UNIQUE constraint itself case-insensitive automatically, rather than
    // relying on every query against this table to remember COLLATE NOCASE.
    id: '003_map_record_overrides',
    sql: `
CREATE TABLE IF NOT EXISTS map_record_overrides (
  id INTEGER PRIMARY KEY,
  map_name TEXT NOT NULL COLLATE NOCASE,
  map_creator TEXT NOT NULL COLLATE NOCASE,
  racer_name TEXT NOT NULL,
  time_seconds REAL NOT NULL,
  set_at TEXT NOT NULL,
  UNIQUE(map_name, map_creator)
);
`
  },
  {
    // "Maps" restructure — Noah's ask for a per-map "coverall" free-text note
    // (his word), e.g. "shortcut near the start" or "chat loves this one".
    // Saving blank text deletes the row instead of storing an empty note (see
    // setMapNote) — no note and an empty note are the same thing here, so
    // there's no reason to keep a row around for it.
    id: '004_map_notes',
    sql: `
CREATE TABLE IF NOT EXISTS map_notes (
  id INTEGER PRIMARY KEY,
  map_name TEXT NOT NULL COLLATE NOCASE,
  map_creator TEXT NOT NULL COLLATE NOCASE,
  note_text TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(map_name, map_creator)
);
`
  },
  {
    // Marbles on Stream updated Battle Royale's data format (confirmed via a
    // real race captured 2026-08-12) to match Race/Tilt: a real summary file
    // now exists (LastSeasonRoyaleSummary.csv, didn't before), participants
    // have a SnapshotId and season point tracking, and there's a real map
    // name. royale_events/royale_participants had ZERO real rows at the time
    // of this migration (confirmed live) — the old content-hash-only schema
    // never successfully recorded anything after the game update shipped, so
    // a clean drop-and-recreate is safe, no data migration needed. Shape now
    // mirrors race_events/race_participants exactly instead of being a
    // one-off special case.
    id: '005_royale_schema_update',
    sql: `
DROP TABLE IF EXISTS royale_participants;
DROP TABLE IF EXISTS royale_events;

CREATE TABLE royale_events (
  id INTEGER PRIMARY KEY,
  snapshot_id TEXT UNIQUE NOT NULL,
  schema_version INTEGER,
  generated_at_utc TEXT,
  captured_at_local TEXT NOT NULL,
  status TEXT,
  game_mode TEXT,
  session_type TEXT,
  map_name TEXT,
  map_creator TEXT,
  player_count INTEGER,
  finished_count INTEGER,
  eliminated_count INTEGER,
  winner_platform TEXT,
  winner_username TEXT,
  season_id INTEGER REFERENCES seasons(id),
  raw_json TEXT NOT NULL
);

CREATE TABLE royale_participants (
  id INTEGER PRIMARY KEY,
  royale_event_id INTEGER NOT NULL REFERENCES royale_events(id),
  racer_id INTEGER NOT NULL REFERENCES racers(id),
  position INTEGER,
  survival_time_seconds REAL,
  eliminated INTEGER NOT NULL DEFAULT 0,
  match_kills INTEGER,
  match_damage_dealt INTEGER,
  season_points_earned INTEGER,
  season_points_total INTEGER,
  season_wins_total INTEGER,
  season_matches_played_total INTEGER,
  UNIQUE(royale_event_id, racer_id)
);

CREATE INDEX IF NOT EXISTS idx_royale_events_captured_at ON royale_events(captured_at_local);
CREATE INDEX IF NOT EXISTS idx_royale_participants_racer ON royale_participants(racer_id);
`
  },
  {
    // Noah's ask: a blank spot on the OBS leaderboard overlay next to
    // whoever's in a given position, that he can type into for giveaways
    // (eg. "iPad" next to 1st place). Keyed by RANK POSITION (1-5), not by
    // racer — a giveaway prize belongs to "whoever's in 1st", and should
    // follow the position as standings shift, not stick to whichever
    // specific person happened to be in 1st when Noah typed it. Saving blank
    // text deletes the row, same "no label and an empty label are the same
    // thing" reasoning as map_notes.
    id: '006_leaderboard_labels',
    sql: `
CREATE TABLE IF NOT EXISTS leaderboard_labels (
  rank_position INTEGER PRIMARY KEY,
  label_text TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`
  },
  {
    // Noah's ask: detect when a world record is broken on a custom map and
    // post an exciting chat message. Source is LastCustomRaceMapPlayed.csv —
    // a single overwritten snapshot (not a log) reflecting whichever custom
    // map was most recently played. This table stores the last-known record
    // MarbleGrid has observed per map, so a new snapshot can be DIFFED
    // against it: genuinely faster than what's stored = a real record just
    // broken. The first time any given map is ever seen there's nothing to
    // diff against, so no alert fires — just the baseline gets stored (see
    // customMapPlayed.ts) — same "don't alert on first sight" caution as the
    // stale-catchup fix. Deliberately NOT season-scoped: a world record is a
    // cross-season, cross-streamer concept, not tied to Noah's own season
    // tracking the way Race HS is.
    id: '007_custom_map_records',
    sql: `
CREATE TABLE IF NOT EXISTS custom_map_records (
  id INTEGER PRIMARY KEY,
  map_name TEXT NOT NULL COLLATE NOCASE,
  map_creator TEXT NOT NULL COLLATE NOCASE,
  record_time_seconds REAL NOT NULL,
  record_holder_name TEXT NOT NULL,
  date_set_raw TEXT,
  first_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(map_name, map_creator)
);
`
  }
]
