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

// --- Battle Royale: LastSeasonRoyale.csv ---
// Confirmed schema lacks SnapshotId/timestamp/SchemaVersion entirely, and has
// no Platform column — a different, older shape than Race/Tilt. Re-verify
// against 00 Game & Data Reference once Noah triggers a fresh Royale race;
// this schema may have changed since the June sample this was built from.

export const RoyaleParticipantSchema = z.object({
  Position: csvNumber,
  Username: z.string().min(1),
  Displayname: z.string(),
  NameColor: z.string(),
  PointsEarned: csvNumber,
  Eliminated: csvBoolean,
  Eliminations: csvNumber,
  DamageDealt: csvNumber
})
export type RoyaleParticipant = z.infer<typeof RoyaleParticipantSchema>

// --- WebSocket push messages — desktop UI and OBS overlay both subscribe ---

export type WsMessage =
  | { type: 'hello'; message: string }
  | { type: 'race-event'; snapshotId: string }
  | { type: 'tilt-event'; snapshotId: string }
  | { type: 'royale-event'; contentHash: string }

// --- API response shapes — single source of truth for backend (Phase 2) and
// renderer/overlay (Phase 3/4), so the two never quietly drift apart. ---

export interface RaceStats {
  totalPoints: number
  totalCount: number
  avgPoints: number
  raceHs: number
  brHs: number
}

export interface LeaderboardRow {
  username: string
  displayName: string
  racesPlayed: number
  wins: number
  totalPoints: number
}

/** Normalized "most recent thing that happened" across Race/Tilt/Royale — powers the overlay's result toast. */
export interface LatestEventSummary {
  kind: 'race' | 'tilt' | 'royale'
  occurredAt: string
  label: string
  winnerName: string
  winnerPoints: number
  topFinishers: { name: string; points: number }[]
}

export interface TwitchStatus {
  hasCredentials: boolean
  connected: boolean
  login: string | null
  autoPostEnabled: boolean
}
