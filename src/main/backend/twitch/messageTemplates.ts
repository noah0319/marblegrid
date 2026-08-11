import type { LatestEventSummary } from '../../../shared/types.ts'
import { formatFullNumber } from '../../../shared/format.ts'

const VERB: Record<LatestEventSummary['kind'], string> = {
  race: 'Race complete',
  tilt: 'Tilted level complete',
  royale: 'Battle Royale complete'
}

// Twitch's Helix "Send Chat Message" caps a single message at 500 characters
// — a real constraint once every scorer is listed instead of just the
// winner (a well-attended race can easily have 15-20+ people on the board).
const MAX_MESSAGE_LENGTH = 500

/**
 * Pure function — the actual wording is centralized here so it's easy for
 * Noah (or a future session) to tweak without hunting through the poster
 * logic, and so unit tests don't need a live Twitch connection to check it.
 *
 * Lists every scorer (Noah's ask: he wants the whole board, not just the
 * winner), sourced from allScorers — not topFinishers, which stays capped
 * at 3 for the overlay's compact HUD toast and is untouched by this.
 */
export function buildChatMessage(event: LatestEventSummary): string {
  const verb = VERB[event.kind]
  const context = event.kind === 'race' ? ` on ${event.label}` : event.kind === 'tilt' ? ` — ${event.label}` : ''
  const intro = `${verb}${context}!`

  // allScorers can be empty even though a winner is still announced — eg. a
  // Tilt level nobody finishes, where every participant is at 0 points and
  // the game's own winner signal is distance/time-survived, not points (see
  // getLatestEvent's topTiltee lookup). Falls back to the original
  // winner-only phrasing in that case, same as before this feature existed.
  if (event.allScorers.length === 0) {
    return `${intro} ${event.winnerName} takes it with ${formatFullNumber(event.winnerPoints)} points.`
  }

  const [winner, ...rest] = event.allScorers
  const winnerLine = `🏆 ${winner.name} wins with ${formatFullNumber(winner.points)} points.`
  if (rest.length === 0) {
    return `${intro} ${winnerLine}`
  }

  const restEntries = rest.map((s) => `${s.name} ${formatFullNumber(s.points)}`)
  const build = (shown: number): string => {
    const list = restEntries.slice(0, shown).join(', ')
    const more = shown < restEntries.length ? ` +${restEntries.length - shown} more` : ''
    return `${intro} ${winnerLine} Also scoring: ${list}${more}`
  }

  // Drop from the tail (lowest scorers — already sorted highest-to-lowest)
  // rather than truncating mid-name if the full list won't fit; a "+N more"
  // is honest, a message cut off mid-username isn't.
  let shown = restEntries.length
  let message = build(shown)
  while (message.length > MAX_MESSAGE_LENGTH && shown > 0) {
    shown -= 1
    message = build(shown)
  }
  return message
}

export const TEST_POST_MESSAGE = '[MarbleGrid test message — confirms chat posting works. Ignore.]'
