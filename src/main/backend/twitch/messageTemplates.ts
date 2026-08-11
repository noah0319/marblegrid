import type { LatestEventSummary } from '../../../shared/types.ts'
import { formatFullNumber } from '../../../shared/format.ts'

const VERB: Record<LatestEventSummary['kind'], string> = {
  race: 'Race complete',
  tilt: 'Tilted level complete',
  royale: 'Battle Royale complete'
}

/**
 * Pure function — the actual wording is centralized here so it's easy for
 * Noah (or a future session) to tweak without hunting through the poster
 * logic, and so unit tests don't need a live Twitch connection to check it.
 */
export function buildChatMessage(event: LatestEventSummary): string {
  const verb = VERB[event.kind]
  const context = event.kind === 'race' ? ` on ${event.label}` : event.kind === 'tilt' ? ` — ${event.label}` : ''
  return `${verb}${context}! ${event.winnerName} takes it with ${formatFullNumber(event.winnerPoints)} points.`
}

export const TEST_POST_MESSAGE = '[MarbleGrid test message — confirms chat posting works. Ignore.]'
