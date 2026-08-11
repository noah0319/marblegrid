import { getRacerTodayStats, getRacerSeasonWins, racerHasEverRaced } from '../db/queries/racerStats.ts'
import { getTodayLeaderboard, getLeaderboard } from '../db/queries/leaderboard.ts'
import { getMapRecords } from '../db/queries/mapRecords.ts'
import { getSeasonStats } from '../db/queries/stats.ts'
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

// Aliases point at the same handler by design — !mystats and !mymarble are
// meant to be interchangeable, not two different things.
const COMMANDS: Record<string, CommandDef> = {
  '!mystats': { cooldownScope: 'user', cooldownMs: 10_000, handler: myStats },
  '!mymarble': { cooldownScope: 'user', cooldownMs: 10_000, handler: myStats },
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

function myStats(_args: string, ctx: ChatCommandContext): string {
  if (!racerHasEverRaced(ctx.chatterName)) {
    return `@${ctx.chatterDisplayName} hasn't raced yet — hop in with !play!`
  }
  const stats = getRacerTodayStats(ctx.chatterName, DEFAULT_DAY_BOUNDARY_HOUR, ctx.now)
  const raceWord = stats.racesPlayed === 1 ? 'race' : 'races'
  return `@${ctx.chatterDisplayName}: ${formatFullNumber(stats.totalPoints)} points across ${stats.racesPlayed} ${raceWord} today.`
}

function myWins(_args: string, ctx: ChatCommandContext): string {
  if (!racerHasEverRaced(ctx.chatterName)) {
    return `@${ctx.chatterDisplayName} hasn't raced yet — hop in with !play!`
  }
  const wins = getRacerSeasonWins(ctx.chatterName, getOpenSeasonId())
  const winWord = wins === 1 ? 'win' : 'wins'
  return `@${ctx.chatterDisplayName} has ${wins} ${winWord} this season.`
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
  const stats = getSeasonStats(getOpenSeasonId())
  return `🏁 Season Race HS: ${formatFullNumber(stats.raceHs)} points.`
}

function ghostBalls(args: string): string {
  if (!args) return 'Usage: !ghostballs <map name>'

  const query = args.toLowerCase()
  const matches = getMapRecords().filter((r) => r.mapName.toLowerCase().includes(query))

  if (matches.length === 0) return `No Ghost Balls record found for "${args}".`
  if (matches.length === 1) {
    const m = matches[0]!
    return `👻 ${m.mapName}: ${formatSeconds(m.timeSeconds)} by ${m.racerName}.`
  }

  const names = matches
    .slice(0, 5)
    .map((m) => m.mapName)
    .join(', ')
  const more = matches.length > 5 ? `, +${matches.length - 5} more` : ''
  return `Multiple maps match "${args}": ${names}${more} — try being more specific.`
}
