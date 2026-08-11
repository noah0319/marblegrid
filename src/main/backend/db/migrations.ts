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
  }
]
