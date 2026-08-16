import { z } from 'zod'

// Booleans in these CSVs are literally the strings "true"/"false". zod's
// z.coerce.boolean() would treat ANY non-empty string (including "false") as
// true, so a custom preprocessor is required — this is a real, easy-to-miss
// gotcha and exactly the kind of thing that should fail loudly if it's ever
// hit by something unexpected rather than silently miscounting eliminations.
const csvBoolean = z.preprocess((val) => {
  if (typeof val === 'string') return val.trim().toLowerCase() === 'true'
  return val
}, z.boolean())

const csvNumber = z.coerce.number()

// --- Race mode: LastSeasonRaceSummary.csv + LastSeasonRace.csv ---
// Confirmed schemas — see 00 Game & Data Reference/(C) csv-schemas-and-data-source.md

export const RaceSummarySchema = z.object({
  SchemaVersion: csvNumber,
  SnapshotId: z.string().min(1),
  GeneratedAtUtc: z.string(),
  Status: z.string(),
  GameMode: z.string(),
  SessionType: z.string(),
  MapName: z.string(),
  MapCreator: z.string(),
  PlayerCount: csvNumber,
  FinishedCount: csvNumber,
  EliminatedCount: csvNumber,
  WinnerPlatform: z.string(),
  WinnerUsername: z.string()
})
export type RaceSummary = z.infer<typeof RaceSummarySchema>

export const RaceParticipantSchema = z.object({
  SnapshotId: z.string().min(1),
  Position: csvNumber,
  Username: z.string().min(1),
  DisplayName: z.string(),
  Platform: z.string(),
  NameColorHex: z.string(),
  SeasonPointsEarned: csvNumber,
  SeasonPointsTotal: csvNumber,
  SeasonWinsTotal: csvNumber,
  SeasonMatchesPlayedTotal: csvNumber,
  TimeInRaceSeconds: csvNumber,
  Eliminated: csvBoolean
})
export type RaceParticipant = z.infer<typeof RaceParticipantSchema>

// --- Tilted mode: LastTiltLevel.csv + LastTiltLevelPlayers.csv ---

export const TiltLevelSchema = z.object({
  SchemaVersion: csvNumber,
  SnapshotId: z.string().min(1),
  GeneratedAtUtc: z.string(),
  Status: z.string(),
  GameMode: z.string(),
  SessionType: z.string(),
  Level: csvNumber,
  Difficulty: csvNumber,
  LevelDurationSeconds: csvNumber,
  LevelPassed: csvBoolean,
  PlayerCount: csvNumber,
  FinishedCount: csvNumber,
  EliminatedCount: csvNumber,
  TopTilteePlatform: z.string(),
  TopTilteeUsername: z.string(),
  StandardPointsPerFinisher: csvNumber,
  ExpertiseEarned: csvNumber,
  TotalExpertise: csvNumber,
  LiveStreamActive: csvBoolean
})
export type TiltLevel = z.infer<typeof TiltLevelSchema>

export const TiltParticipantSchema = z.object({
  SnapshotId: z.string().min(1),
  Username: z.string().min(1),
  DisplayName: z.string(),
  Platform: z.string(),
  NameColorHex: z.string(),
  Position: csvNumber,
  TimeOnBoardSeconds: csvNumber,
  LevelPointsEarned: csvNumber,
  Eliminated: csvBoolean
})
export type TiltParticipant = z.infer<typeof TiltParticipantSchema>

// --- Battle Royale: LastSeasonRoyaleSummary.csv + LastSeasonRoyale.csv ---
// Schema confirmed CHANGED by a Marbles on Stream game update sometime
// between the original June sample and 2026-08-12 (a real race captured
// live on Noah's PC that day). The old shape (no SnapshotId, no summary
// file, bare PointsEarned/Eliminations/DamageDealt, lowercase-d
// "Displayname") is gone. Royale now matches Race/Tilt's shape exactly: a
// real summary file (didn't exist before), SnapshotId, season point
// tracking, and a real map name (Royale never had a "map" concept before).
// See 07 Iteration Logs/(C) 2026-08-13 Royale schema update.md.

export const RoyaleSummarySchema = z.object({
  SchemaVersion: csvNumber,
  SnapshotId: z.string().min(1),
  GeneratedAtUtc: z.string(),
  Status: z.string(),
  GameMode: z.string(),
  SessionType: z.string(),
  MapName: z.string(),
  MapCreator: z.string(),
  PlayerCount: csvNumber,
  FinishedCount: csvNumber,
  EliminatedCount: csvNumber,
  WinnerPlatform: z.string(),
  WinnerUsername: z.string()
})
export type RoyaleSummary = z.infer<typeof RoyaleSummarySchema>

export const RoyaleParticipantSchema = z.object({
  SnapshotId: z.string().min(1),
  Position: csvNumber,
  Username: z.string().min(1),
  DisplayName: z.string(),
  Platform: z.string(),
  NameColorHex: z.string(),
  SurvivalTimeSeconds: csvNumber,
  Eliminated: csvBoolean,
  MatchKills: csvNumber,
  MatchDamageDealt: csvNumber,
  SeasonPointsEarned: csvNumber,
  SeasonPointsTotal: csvNumber,
  SeasonWinsTotal: csvNumber,
  SeasonMatchesPlayedTotal: csvNumber
})
export type RoyaleParticipant = z.infer<typeof RoyaleParticipantSchema>

// --- WebSocket push messages — desktop UI and OBS overlay both subscribe ---

export type WsMessage =
  | { type: 'hello'; message: string }
  | { type: 'race-event'; snapshotId: string }
  | { type: 'tilt-event'; snapshotId: string }
  | { type: 'royale-event'; snapshotId: string }
  | { type: 'leaderboard-labels-changed' }
  | ({ type: 'world-record-event' } & WorldRecordPayload)

/** Broadcast the moment a world record is confirmed broken — see customMapPlayed.ts's diff-based detection. Purely a live push, no catch-up GET endpoint: missing the live moment means missing the celebration, same as any broadcast graphic, and the chat post still announces it either way. */
export interface WorldRecordPayload {
  mapName: string
  mapCreator: string
  recordHolderName: string
  recordTimeSeconds: number
  previousRecordTimeSeconds: number
  previousRecordHolderName: string
  pointsEarned: number | null
}

// --- API response shapes — single source of truth for backend (Phase 2) and
// renderer/overlay (Phase 3/4), so the two never quietly drift apart. ---

export interface RaceStats {
  totalPoints: number
  totalCount: number
  avgPoints: number
  raceHs: number
  brHs: number
}

/**
 * What /api/stats/today actually returns — RaceStats plus who holds today's
 * Race HS / BR HS (Noah's ask for the Daily Stats overlay). Deliberately NOT
 * folded into RaceStats itself: /api/stats/season returns plain RaceStats
 * and doesn't compute holder names, so widening the shared type would make
 * every RaceStats consumer look like it should have holder fields when only
 * the today route actually provides them.
 */
export interface TodayStats extends RaceStats {
  raceHsHolder: string | null
  brHsHolder: string | null
}

export interface LeaderboardRow {
  username: string
  displayName: string
  racesPlayed: number
  wins: number
  totalPoints: number
}

/** Best (lowest) finish time ever captured on a map, all-time — not season-scoped, see getMapRecords. */
export interface MapRecord {
  mapName: string
  /** Disambiguates same-named maps by different creators — see getMapRecords. */
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
  /** Real count of every captured race on this map, independent of whether anyone finished — never affected by a manual override. */
  timesPlayed: number
  /** True if racerName/timeSeconds/achievedAt came from Noah manually setting this record rather than the automatic best-time computation. */
  isManualOverride: boolean
}

/** A free-text note Noah's attached to a map — "notes" sub-category of Maps, his word: a coverall for whatever doesn't fit elsewhere. */
export interface MapNote {
  mapName: string
  mapCreator: string
  noteText: string
  /** Null if no note has ever been saved for this map. */
  updatedAt: string | null
}

/** Per-map engagement stats — "Community" sub-category of Maps. Race mode only, same scope as MapRecord. */
export interface MapCommunityStat {
  mapName: string
  mapCreator: string
  /** Every captured race on this map, finished or not — same count as MapRecord.timesPlayed. */
  raceCount: number
  /** SUM(eliminated_count) / SUM(player_count) across every race on the map, as a percentage. Participant-weighted, not an average of each race's own rate. */
  deathRatePercent: number
  /** Null if nobody has ever finished this map — genuinely no data, not zero/instant. */
  avgFinishSeconds: number | null
}

/**
 * One entry per time a map's record actually changed hands — "History"
 * sub-category of Maps: "a history of when it was beaten and by who."
 * Derived entirely from race data + overrides at query time, see
 * getMapRecordHistory. previousTimeSeconds/previousRacerName are null when
 * this is the first-ever recorded time for the map — nothing to beat yet.
 */
export interface MapHistoryEntry {
  mapName: string
  mapCreator: string
  racerName: string
  timeSeconds: number
  achievedAt: string
  previousTimeSeconds: number | null
  previousRacerName: string | null
  isManualOverride: boolean
}

/**
 * A giveaway label for one leaderboard rank position (1-5), shown on the OBS
 * leaderboard overlay next to whoever currently holds that rank — Noah's
 * ask, e.g. typing "iPad" next to 1st place. Keyed by position, not by
 * racer, so it follows the rank as standings shift.
 */
export interface LeaderboardLabel {
  rankPosition: number
  labelText: string
}

/** Normalized "most recent thing that happened" across Race/Tilt/Royale — powers the overlay's result toast. */
export interface LatestEventSummary {
  kind: 'race' | 'tilt' | 'royale'
  occurredAt: string
  label: string
  winnerName: string
  winnerPoints: number
  /** Top 3 by points, for the overlay toast's compact "winner + runners-up" display — keep this short, it's a HUD element. */
  topFinishers: { name: string; points: number }[]
  /** Every participant who scored above 0, highest first, uncapped — for the chat post, which Noah wants to show everyone who got points, not just the top 3. */
  allScorers: { name: string; points: number }[]
}

export interface TwitchStatus {
  hasCredentials: boolean
  connected: boolean
  login: string | null
  autoPostEnabled: boolean
  /** Separate toggle: posts !lastmap's info (death rate, avg time, Ghost Ball record) automatically after every race, no command needed. Independent of autoPostEnabled. */
  autoPostLastMapEnabled: boolean
  /** Whether the chat-commands listener (!mystats etc.) is actually running — false if never started, or if the current token predates the user:read:chat scope and needs a reconnect. */
  chatCommandsActive: boolean
  /** Optional second account — if connected, it posts everything instead of the main account. Never affects chat-commands reading, which always stays on the main connection. */
  botConnected: boolean
  botLogin: string | null
}
