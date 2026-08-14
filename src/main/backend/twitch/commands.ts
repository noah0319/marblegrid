import {
  getRacerTodayStats,
  getRacerSeasonStats,
  getRacerSeasonWins,
  racerHasEverRaced,
  getRacerDisplayName
} from '../db/queries/racerStats.ts'
import { getTodayLeaderboard, getLeaderboard } from '../db/queries/leaderboard.ts'
import { getMapRecords } from '../db/queries/mapRecords.ts'
import { getSeasonStats, getSeasonRaceHighScore } from '../db/queries/stats.ts'
import { getOpenSeasonId } from '../db/queries/seasons.ts'
import { DEFAULT_DAY_BOUNDARY_HOUR } from '../../../shared/constants.ts'
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
  '!ghostballs': { cooldownScope: 'user', cooldownMs: 10_000, handler: ghostBalls }
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
  const today = getRacerTodayStats(target.username, DEFAULT_DAY_BOUNDARY_HOUR, ctx.now)
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
  const rows = getTodayLeaderboard(DEFAULT_DAY_BOUNDARY_HOUR, 10)
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
