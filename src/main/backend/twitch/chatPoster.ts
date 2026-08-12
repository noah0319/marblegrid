import { getDb } from '../db/db.ts'
import { getSettings } from './settingsStore.ts'
import { getBroadcasterUserId, sendChatMessageAsConfigured } from './auth.ts'
import { buildChatMessage, TEST_POST_MESSAGE } from './messageTemplates.ts'
import type { LatestEventSummary } from '../../../shared/types.ts'

export interface ChatPostResult {
  attempted: boolean
  success: boolean
  message?: string
  error?: string
}

type SendFn = (broadcasterId: string, message: string) => Promise<void>

// Routes through the bot account if one's connected, else Noah's own —
// see sendChatMessageAsConfigured for the actual decision.
const defaultSend: SendFn = sendChatMessageAsConfigured

/**
 * Called after a Race/Tilt/Royale event successfully commits to the
 * database — never off the raw file-change event, so a chat post can never
 * reference data that didn't actually land durably (see the implementation
 * plan's ingest pipeline). Does nothing unless auto-post is explicitly
 * enabled and Twitch is connected — both are OFF by default. `sendFn` is
 * injectable so the retry/log/dedupe policy is unit-testable without a real
 * Twitch connection; production call sites use the default.
 */
export async function maybePostEventToChat(
  event: LatestEventSummary,
  sendFn: SendFn = defaultSend
): Promise<ChatPostResult> {
  const settings = getSettings()
  if (!settings.autoPostEnabled) return { attempted: false, success: false }

  const broadcasterId = getBroadcasterUserId()
  if (!broadcasterId) return { attempted: false, success: false, error: 'Twitch is not connected' }

  const db = getDb()
  const alreadyPosted = db
    .prepare(
      'SELECT 1 FROM chat_post_log WHERE event_kind = ? AND event_occurred_at = ? AND success = 1'
    )
    .get(event.kind, event.occurredAt)
  // Restart-safe: checked BEFORE sending, not just written after — an app
  // restart mid-post can never cause a duplicate.
  if (alreadyPosted) return { attempted: false, success: false }

  return sendWithRetry(event, broadcasterId, sendFn, 1)
}

async function sendWithRetry(
  event: LatestEventSummary,
  broadcasterId: string,
  sendFn: SendFn,
  retriesLeft: number
): Promise<ChatPostResult> {
  const db = getDb()
  const message = buildChatMessage(event)

  try {
    await sendFn(broadcasterId, message)
    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES (?, ?, ?, 1, ?, NULL)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 1, message = excluded.message, error = NULL`
    ).run(event.kind, event.occurredAt, new Date().toISOString(), message)
    return { attempted: true, success: true, message }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return sendWithRetry(event, broadcasterId, sendFn, retriesLeft - 1)
    }

    // Retry-once-then-give-up: never queue up and dump stale results later
    // (see implementation plan) — if it fails twice, log it and move on.
    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 0, message = excluded.message, error = excluded.error`
    ).run(event.kind, event.occurredAt, new Date().toISOString(), message, errorMessage)
    return { attempted: true, success: false, error: errorMessage }
  }
}

/** Settings screen's "Test post" button — bypasses the auto-post toggle and dedupe entirely, on demand. */
export async function sendTestPost(sendFn: SendFn = defaultSend): Promise<ChatPostResult> {
  const broadcasterId = getBroadcasterUserId()
  if (!broadcasterId) {
    return { attempted: true, success: false, error: 'Twitch is not connected' }
  }
  try {
    await sendFn(broadcasterId, TEST_POST_MESSAGE)
    return { attempted: true, success: true, message: TEST_POST_MESSAGE }
  } catch (err) {
    return { attempted: true, success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
