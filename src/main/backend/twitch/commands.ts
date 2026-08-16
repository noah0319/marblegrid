import {
  getRacerTodayStats,
  getRacerSeasonStats,
  getRacerSeasonWins,
  racerHasEverRaced,
  getRacerDisplayName
} from '../db/queries/racerStats.ts'
import { getTodayLeaderboard, getLeaderboard } from '../db/queries/leaderboard.ts'
import { getMapRecords, getLastMapSummary } from '../db/queries/mapRecords.ts'
import { getMapNotes } from '../db/queries/mapNotes.ts'
import { getSeasonStats, getSeasonRaceHighScore } from '../db/queries/stats.ts'
import { getOpenSeasonId } from '../db/queries/seasons.ts'
import { getAppSettings } from '../appSettingsStore.ts'
import { buildLastMapMessage } from './messageTemplates.ts'
import { formatFullNumber, formatSeconds } from '../../../shared/format.ts'

// Twitch caps chat messages at 500 characters — same constraint buildChatMessage
// handles for race results, applied here to the top10 commands.
const MAX_MESSAGE_LENGTH = 500

export interface ChatCommandContext {
  chatterId: string
  chatterName: string
  chatterDisplayName: string
  now?: Date
}

interface CommandDef {
  /** Per-user cooldown (different callers are independent) vs global (whole channel shares one window) — personalized answers use per-user, "same answer for everyone" commands use global. */
  cooldownScope: 'user' | 'global'
  cooldownMs: number
  handler: (args: string, ctx: ChatCommandContext) => string
}

// Aliases point at the same handler by design — !mystats, !mymarble, and
// !myballs are meant to be fully interchangeable, not different things.
const COMMANDS: Record<string, CommandDef> = {
  '!mystats': { cooldownScope: 'user', cooldownMs: 10_000, handler: myStats },
  '!mymarble': { cooldownScope: 'user', cooldownMs: 10_000, handler: myStats },
  '!myballs': { cooldownScope: 'user', cooldownMs: 10_000, handler: myStats },
  '!mywins': { cooldownScope: 'user', cooldownMs: 10_000, handler: myWins },
  '!top10today': { cooldownScope: 'global', cooldownMs: 15_000, handler: top10Today },
  '!top10season': { cooldownScope: 'global', cooldownMs: 15_000, handler: top10Season },
  '!racehs': { cooldownScope: 'global', cooldownMs: 15_000, handler: raceHs },
  '!ghostballs': { cooldownScope: 'user', cooldownMs: 10_000, handler: ghostBalls },
  '!lastmap': { cooldownScope: 'global', cooldownMs: 15_000, handler: lastMap },
  '!notes': { cooldownScope: 'user', cooldownMs: 10_000, handler: mapNotesCommand }
}

let lastTriggered = new Map<string, number>()

/** Test-only: cooldowns are module-level state so tests don't bleed into each other. */
export function resetCommandCooldowns(): void {
  lastTriggered = new Map()
}

/**
 * Pure(ish) — the only side effect is reading the cooldown map and the
 * database (via the query modules, same getDb() singleton pattern as
 * everywhere else). Returns the reply text to send, or null if nothing
 * should be sent (not a recognized command, or on cooldown). Sending is the
 * caller's job (chatListener.ts) — kept separate so this is testable without
 * a live Twitch connection, same split as buildChatMessage/chatPoster.
 */
export function handleChatCommand(messageText: string, ctx: ChatCommandContext): string | null {
  const trimmed = messageText.trim()
  if (!trimmed.startsWith('!')) return null

  const spaceIndex = trimmed.indexOf(' ')
  const commandWord = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase()
  const args = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim()

  const def = COMMANDS[commandWord]
  if (!def) return null

  const cooldownKey = `${commandWord}:${def.cooldownScope === 'user' ? ctx.chatterId : 'global'}`
  const now = (ctx.now ?? new Date()).getTime()
  const last = lastTriggered.get(cooldownKey)
  if (last !== undefined && now - last < def.cooldownMs) return null
  lastTriggered.set(cooldownKey, now)

  return def.handler(args, ctx)
}

interface TargetRacer {
  /** For DB lookups — every query here is COLLATE NOCASE anyway, but this keeps intent explicit. */
  username: string
  /** Best available form for the reply text. */
  displayName: string
}

/**
 * No argument means "me" — resolved from the caller's own live Twitch
 * identity, same as before. An argument (`!mystats @someone` or `!mystats
 * someone` — the @ is optional, stripped either way) means "look up someone
 * else": Noah's ask, so chat can check a friend's stats, not just their own.
 * We don't have a looked-up target's live Twitch identity (they didn't send
 * this message) — the best available display form is whatever the game
 * itself last reported for them, falling back to echoing back whatever the
 * caller typed if that person's never raced at all.
 */
function resolveTarget(args: string, ctx: ChatCommandContext): TargetRacer {
  const trimmed = args.trim().replace(/^@/, '').trim()
  if (!trimmed) return { username: ctx.chatterName, displayName: ctx.chatterDisplayName }
  return { username: trimmed, displayName: getRacerDisplayName(trimmed) ?? trimmed }
}

function myStats(args: string, ctx: ChatCommandContext): string {
  const target = resolveTarget(args, ctx)
  if (!racerHasEverRaced(target.username)) {
    return `@${target.displayName} hasn't raced yet — hop in with !play!`
  }
  const today = getRacerTodayStats(target.username, getAppSettings().dayBoundaryHour, ctx.now)
  const season = getRacerSeasonStats(target.username, getOpenSeasonId())
  const todayRaceWord = today.racesPlayed === 1 ? 'race' : 'races'
  const seasonRaceWord = season.racesPlayed === 1 ? 'race' : 'races'
  const ppr = season.racesPlayed > 0 ? season.totalPoints / season.racesPlayed : 0
  return (
    `@${target.displayName}: Today: ${formatFullNumber(today.totalPoints)} pts (${today.racesPlayed} ${todayRaceWord}) | ` +
    `Season: ${formatFullNumber(season.totalPoints)} pts, ${season.racesPlayed} ${seasonRaceWord}, ${formatFullNumber(ppr)} PPR.`
  )
}

function myWins(args: string, ctx: ChatCommandContext): string {
  const target = resolveTarget(args, ctx)
  if (!racerHasEverRaced(target.username)) {
    return `@${target.displayName} hasn't raced yet — hop in with !play!`
  }
  const wins = getRacerSeasonWins(target.username, getOpenSeasonId())
  const winWord = wins === 1 ? 'win' : 'wins'
  return `@${target.displayName} has ${wins} ${winWord} this season.`
}

function top10Today(): string {
  const rows = getTodayLeaderboard(getAppSettings().dayBoundaryHour, 10)
  if (rows.length === 0) return 'No races captured yet today.'
  return listWithBudget('🏁 Top 10 today: ', rows)
}

function top10Season(): string {
  const rows = getLeaderboard(getOpenSeasonId(), 10)
  if (rows.length === 0) return 'No races captured yet this season.'
  return listWithBudget('🏁 Top 10 this season: ', rows)
}

function listWithBudget(prefix: string, rows: { displayName: string; username: string; totalPoints: number }[]): string {
  const entries = rows.map((r, i) => `${i + 1}. ${r.displayName || r.username} (${formatFullNumber(r.totalPoints)})`)
  let shown = entries.length
  const build = (n: number): string => {
    const list = entries.slice(0, n).join(', ')
    const more = n < entries.length ? ` +${entries.length - n} more` : ''
    return `${prefix}${list}${more}`
  }
  let message = build(shown)
  while (message.length > MAX_MESSAGE_LENGTH && shown > 0) {
    shown -= 1
    message = build(shown)
  }
  return message
}

function raceHs(): string {
  const hs = getSeasonRaceHighScore(getOpenSeasonId())
  if (!hs) return '🏁 No races captured yet this season.'
  return `🏁 Season Race HS: ${formatFullNumber(hs.points)} points — ${hs.racerName} on ${hs.mapName}.`
}

function ghostBalls(args: string): string {
  if (!args) return 'Usage: !ghostballs <map name>'

  const query = args.toLowerCase()
  // Matches creator too — same-named maps by different creators are real
  // (Noah confirmed one directly), so this doubles as "!ghostballs
  // <creator>" to find everything by one map-maker.
  const matches = getMapRecords().filter(
    (r) => r.mapName.toLowerCase().includes(query) || r.mapCreator.toLowerCase().includes(query)
  )

  if (matches.length === 0) return `No Ghost Balls record found for "${args}".`
  if (matches.length === 1) {
    const m = matches[0]!
    const playCount = `played ${m.timesPlayed} time${m.timesPlayed === 1 ? '' : 's'}`
    return `👻 ${m.mapName} (${m.mapCreator}): best time ${formatSeconds(m.timeSeconds)}, held by ${m.racerName} — ${playCount}.`
  }

  const names = matches
    .slice(0, 5)
    .map((m) => `${m.mapName} (${m.mapCreator})`)
    .join(', ')
  const more = matches.length > 5 ? `, +${matches.length - 5} more` : ''
  return `Multiple maps match "${args}": ${names}${more} — try being more specific.`
}

/**
 * Noah's ask: "the last map played along with death percentage, avg time,
 * etc." Race mode only, same scope as Ghost Balls/Community — Tilt/Royale
 * don't have a "map" the same way. getLastMapSummary + buildLastMapMessage
 * are shared with the auto-post-after-each-race toggle (chatPoster.ts) so
 * the command and the automatic version can never show different numbers.
 */
function lastMap(): string {
  const summary = getLastMapSummary()
  if (!summary) return 'No maps played yet.'
  return buildLastMapMessage(summary)
}

/**
 * Noah's ask: "!notes command so if i do that command followed by the map
 * name it will post the notes ive listed for that map in my chat." Search/
 * multi-match handling mirrors !ghostballs — matches by creator too, and
 * asks for more specificity if several maps match. Distinguishes "no map
 * matches at all" from "the map exists but has no note yet," since those
 * mean different things to whoever's asking.
 */
function mapNotesCommand(args: string): string {
  if (!args) return 'Usage: !notes <map name>'

  const query = args.toLowerCase()
  const nameMatches = getMapNotes().filter(
    (n) => n.mapName.toLowerCase().includes(query) || n.mapCreator.toLowerCase().includes(query)
  )
  if (nameMatches.length === 0) return `No map found matching "${args}".`

  const withNotes = nameMatches.filter((n) => n.noteText)
  if (withNotes.length === 0) {
    return nameMatches.length === 1
      ? `No notes set for ${nameMatches[0]!.mapName} yet.`
      : `No notes set for any map matching "${args}" yet.`
  }
  if (withNotes.length === 1) {
    const n = withNotes[0]!
    const prefix = `📝 ${n.mapName} (${n.mapCreator}): `
    const budget = MAX_MESSAGE_LENGTH - prefix.length
    const note = n.noteText.length > budget ? `${n.noteText.slice(0, Math.max(0, budget - 1))}…` : n.noteText
    return `${prefix}${note}`
  }

  const names = withNotes
    .slice(0, 5)
    .map((n) => `${n.mapName} (${n.mapCreator})`)
    .join(', ')
  const more = withNotes.length > 5 ? `, +${withNotes.length - 5} more` : ''
  return `Multiple noted maps match "${args}": ${names}${more} — try being more specific.`
}
