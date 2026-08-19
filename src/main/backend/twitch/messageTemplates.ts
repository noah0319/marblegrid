import type { LatestEventSummary } from '../../../shared/types.ts'
import type { WorldRecordBroken } from '../watcher/parsers/customMapPlayed.ts'
import type { LastMapSummary, SeasonRecordBroken } from '../db/queries/mapRecords.ts'
import { formatFullNumber, formatSeconds } from '../../../shared/format.ts'

const RESULTS_LABEL: Record<LatestEventSummary['kind'], string> = {
  race: 'Race Results',
  tilt: 'Tilted Results',
  royale: 'Battle Royale Results'
}

const MEDALS = ['🥇', '🥈', '🥉']

// Twitch's Helix "Send Chat Message" caps a single message at 500 characters
// — a real constraint once every scorer is listed instead of just the
// winner (a well-attended race can easily have 15-20+ people on the board).
const MAX_MESSAGE_LENGTH = 500

/**
 * Pure function — the actual wording is centralized here so it's easy for
 * Noah (or a future session) to tweak without hunting through the poster
 * logic, and so unit tests don't need a live Twitch connection to check it.
 *
 * Format is Noah's own reference example (2026-08-11): medal emojis for the
 * top 3, "#N:" for the rest, pipe-separated, "Name - points points" per
 * entry. Lists every scorer (not just the winner — his earlier ask),
 * sourced from allScorers, not topFinishers (which stays capped at 3 for
 * the overlay's compact HUD toast and is untouched by this).
 */
export function buildChatMessage(event: LatestEventSummary): string {
  const label = RESULTS_LABEL[event.kind]
  // Every kind has a real, meaningful label now: Race/Royale get the map
  // name, Tilt gets the level. Royale didn't have a map concept until the
  // 2026-08-13 game update — see getLatestEvent.
  const header = `🏁 ${label} (${event.label}):`

  // allScorers can be empty even though a winner is still announced — eg. a
  // Tilt level nobody finishes, where every participant is at 0 points and
  // the game's own winner signal is distance/time-survived, not points (see
  // getLatestEvent's topTiltee lookup). Falls back to a synthetic one-entry
  // list so the exact same ranked formatting still applies, no special case.
  const scorers = event.allScorers.length > 0 ? event.allScorers : [{ name: event.winnerName, points: event.winnerPoints }]

  const entries = scorers.map((s, i) => {
    const medal = MEDALS[i]
    const rankPart = medal ? `${medal} #${i + 1}` : `#${i + 1}`
    return `${rankPart}: ${s.name} - ${formatFullNumber(s.points)} points`
  })

  const build = (shown: number): string => {
    const list = entries.slice(0, shown).join(' | ')
    const more = shown < entries.length ? ` | +${entries.length - shown} more` : ''
    return `${header} ${list}${more}`
  }

  // Drop from the tail (lowest scorers — already sorted highest-to-lowest)
  // rather than truncating mid-name if the full list won't fit; a "+N more"
  // is honest, a message cut off mid-username isn't.
  let shown = entries.length
  let message = build(shown)
  while (message.length > MAX_MESSAGE_LENGTH && shown > 0) {
    shown -= 1
    message = build(shown)
  }
  return message
}

/**
 * Deliberately more dramatic than buildChatMessage's normal race-result
 * format — Noah's ask: "a big exciting message." Points are omitted
 * entirely (not shown as "0" or missing) when no matching race could be
 * cross-referenced — see customMapPlayed.ts's lookUpPointsForRecord.
 */
export function buildWorldRecordMessage(record: WorldRecordBroken): string {
  const time = formatSeconds(record.recordTimeSeconds)
  const previousTime = formatSeconds(record.previousRecordTimeSeconds)
  const pointsPart = record.pointsEarned !== null ? ` (+${formatFullNumber(record.pointsEarned)} points!)` : ''
  return (
    `🌍💥 WORLD RECORD! ${record.recordHolderName} just SHATTERED the record on ${record.mapName} — ${time}!` +
    ` (previous: ${previousTime}, held by ${record.previousRecordHolderName})${pointsPart} 🏆`
  )
}

/**
 * Deliberately says "season record," never "world record" or just "record"
 * — this is a local/channel best scoped to the current season (see
 * findSeasonRecordBreak), not verified against the game's own cross-player
 * data the way buildWorldRecordMessage's feature is. Honest framing on
 * purpose: exciting, but not overclaiming what it actually checked.
 */
export function buildSeasonRecordMessage(record: SeasonRecordBroken): string {
  const time = formatSeconds(record.timeSeconds)
  const previousPart =
    record.previousTimeSeconds !== null && record.previousRacerName
      ? ` — previous best this season: ${formatSeconds(record.previousTimeSeconds)} by ${record.previousRacerName}`
      : " — first finish on this map this season!"
  return `🏆 New season record! ${record.racerName} just posted the fastest time on ${record.mapName} this season — ${time}!${previousPart}`
}

/**
 * Shared by !lastmap (the chat command) and the auto-post-after-each-race
 * toggle — identical wording either way, only the trigger differs (someone
 * typing the command vs. firing automatically once a race commits).
 */
export function buildLastMapMessage(summary: LastMapSummary): string {
  const { mapName, mapCreator, community, record } = summary
  const deathRate = community ? `${community.deathRatePercent.toFixed(0)}% death rate` : 'no death rate data'
  const avgTime =
    community?.avgFinishSeconds != null ? `avg finish ${formatSeconds(community.avgFinishSeconds)}` : 'no finishes yet'
  const played = community ? `played ${community.raceCount}x` : ''
  const recordPart = record ? ` — Ghost Ball ${formatSeconds(record.timeSeconds)} by ${record.racerName}` : ''
  return `🗺️ Last map: ${mapName} (${mapCreator}) — ${deathRate}, ${avgTime}, ${played}${recordPart}.`
}

export const TEST_POST_MESSAGE = '[MarbleGrid test message — confirms chat posting works. Ignore.]'
