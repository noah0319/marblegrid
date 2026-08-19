import { getDb } from '../db/db.ts'
import { getSettings } from './settingsStore.ts'
import { getBroadcasterUserId, sendChatMessageAsConfigured } from './auth.ts'
import { buildChatMessage, buildWorldRecordMessage, buildLastMapMessage, buildSeasonRecordMessage, TEST_POST_MESSAGE } from './messageTemplates.ts'
import { getLastMapSummary, type LastMapSummary, type SeasonRecordBroken } from '../db/queries/mapRecords.ts'
import type { LatestEventSummary } from '../../../shared/types.ts'
import type { WorldRecordBroken } from '../watcher/parsers/customMapPlayed.ts'

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

/**
 * Called after a world record is confirmed broken (see
 * customMapPlayed.ts's diff-based detection — never fires on the first time
 * a map is ever observed). Same auto-post gate, retry-once, and restart-safe
 * dedupe policy as maybePostEventToChat, reusing the SAME chat_post_log
 * table with a distinct event_kind rather than a parallel mechanism.
 *
 * Identity for dedupe is derived from the record itself
 * (map+creator+time), not "now" — a world record has no natural
 * occurredAt the way a race/tilt/royale event does (LastCustomRaceMapPlayed
 * .csv is a snapshot, not a timestamped event), so this is the stable
 * equivalent: the same genuine record value can only ever be inserted once.
 */
export async function maybePostWorldRecordToChat(
  record: WorldRecordBroken,
  sendFn: SendFn = defaultSend
): Promise<ChatPostResult> {
  const settings = getSettings()
  if (!settings.autoPostEnabled) return { attempted: false, success: false }

  const broadcasterId = getBroadcasterUserId()
  if (!broadcasterId) return { attempted: false, success: false, error: 'Twitch is not connected' }

  const identity = `${record.mapName.toLowerCase()}::${record.mapCreator.toLowerCase()}::${record.recordTimeSeconds}`

  const db = getDb()
  const alreadyPosted = db
    .prepare(`SELECT 1 FROM chat_post_log WHERE event_kind = 'world_record' AND event_occurred_at = ? AND success = 1`)
    .get(identity)
  if (alreadyPosted) return { attempted: false, success: false }

  return sendWorldRecordWithRetry(record, identity, broadcasterId, sendFn, 1)
}

async function sendWorldRecordWithRetry(
  record: WorldRecordBroken,
  identity: string,
  broadcasterId: string,
  sendFn: SendFn,
  retriesLeft: number
): Promise<ChatPostResult> {
  const db = getDb()
  const message = buildWorldRecordMessage(record)

  try {
    await sendFn(broadcasterId, message)
    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('world_record', ?, ?, 1, ?, NULL)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 1, message = excluded.message, error = NULL`
    ).run(identity, new Date().toISOString(), message)
    return { attempted: true, success: true, message }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return sendWorldRecordWithRetry(record, identity, broadcasterId, sendFn, retriesLeft - 1)
    }

    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('world_record', ?, ?, 0, ?, ?)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 0, message = excluded.message, error = excluded.error`
    ).run(identity, new Date().toISOString(), message, errorMessage)
    return { attempted: true, success: false, error: errorMessage }
  }
}

/**
 * Noah's ask: an instant, honestly-scoped companion to maybePostWorldRecordToChat
 * — see findSeasonRecordBreak's doc comment for the full "why." Same
 * auto-post gate (reuses autoPostEnabled, not a separate toggle — matches
 * how world-record posting already piggybacks on the same setting rather
 * than adding a dedicated one) and retry-once/restart-safe dedupe policy,
 * same chat_post_log table with its own event_kind. Identity is the
 * triggering race's own occurredAt (matches maybePostLastMapToChat's
 * pattern) rather than derived from the record values themselves — this is
 * tied to one specific race event, not a standalone fact like a world
 * record is.
 */
export async function maybePostSeasonRecordToChat(
  record: SeasonRecordBroken,
  occurredAt: string,
  sendFn: SendFn = defaultSend
): Promise<ChatPostResult> {
  const settings = getSettings()
  if (!settings.autoPostEnabled) return { attempted: false, success: false }

  const broadcasterId = getBroadcasterUserId()
  if (!broadcasterId) return { attempted: false, success: false, error: 'Twitch is not connected' }

  const db = getDb()
  const alreadyPosted = db
    .prepare(`SELECT 1 FROM chat_post_log WHERE event_kind = 'season_record' AND event_occurred_at = ? AND success = 1`)
    .get(occurredAt)
  if (alreadyPosted) return { attempted: false, success: false }

  return sendSeasonRecordWithRetry(record, occurredAt, broadcasterId, sendFn, 1)
}

async function sendSeasonRecordWithRetry(
  record: SeasonRecordBroken,
  occurredAt: string,
  broadcasterId: string,
  sendFn: SendFn,
  retriesLeft: number
): Promise<ChatPostResult> {
  const db = getDb()
  const message = buildSeasonRecordMessage(record)

  try {
    await sendFn(broadcasterId, message)
    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('season_record', ?, ?, 1, ?, NULL)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 1, message = excluded.message, error = NULL`
    ).run(occurredAt, new Date().toISOString(), message)
    return { attempted: true, success: true, message }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return sendSeasonRecordWithRetry(record, occurredAt, broadcasterId, sendFn, retriesLeft - 1)
    }

    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('season_record', ?, ?, 0, ?, ?)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 0, message = excluded.message, error = excluded.error`
    ).run(occurredAt, new Date().toISOString(), message, errorMessage)
    return { attempted: true, success: false, error: errorMessage }
  }
}

/**
 * Noah's ask: a separate toggle to post !lastmap's info automatically after
 * EVERY race, not just on-demand when someone types the command. Deliberately
 * a distinct toggle from autoPostEnabled — a streamer might want either
 * independently. Keyed by the triggering race's occurredAt (not the map),
 * so back-to-back races on the SAME map each still get their own post —
 * "after each race" is literal, not "once per map." Same retry-once/
 * restart-safe dedupe policy as the other two posters, reusing chat_post_log
 * with event_kind = 'last_map'.
 */
export async function maybePostLastMapToChat(
  occurredAt: string,
  sendFn: SendFn = defaultSend
): Promise<ChatPostResult> {
  const settings = getSettings()
  if (!settings.autoPostLastMapEnabled) return { attempted: false, success: false }

  const broadcasterId = getBroadcasterUserId()
  if (!broadcasterId) return { attempted: false, success: false, error: 'Twitch is not connected' }

  const db = getDb()
  const alreadyPosted = db
    .prepare(`SELECT 1 FROM chat_post_log WHERE event_kind = 'last_map' AND event_occurred_at = ? AND success = 1`)
    .get(occurredAt)
  if (alreadyPosted) return { attempted: false, success: false }

  const summary = getLastMapSummary()
  if (!summary) return { attempted: false, success: false }

  return sendLastMapWithRetry(summary, occurredAt, broadcasterId, sendFn, 1)
}

async function sendLastMapWithRetry(
  summary: LastMapSummary,
  occurredAt: string,
  broadcasterId: string,
  sendFn: SendFn,
  retriesLeft: number
): Promise<ChatPostResult> {
  const db = getDb()
  const message = buildLastMapMessage(summary)

  try {
    await sendFn(broadcasterId, message)
    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('last_map', ?, ?, 1, ?, NULL)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 1, message = excluded.message, error = NULL`
    ).run(occurredAt, new Date().toISOString(), message)
    return { attempted: true, success: true, message }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)

    if (retriesLeft > 0) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return sendLastMapWithRetry(summary, occurredAt, broadcasterId, sendFn, retriesLeft - 1)
    }

    db.prepare(
      `INSERT INTO chat_post_log (event_kind, event_occurred_at, attempted_at, success, message, error)
       VALUES ('last_map', ?, ?, 0, ?, ?)
       ON CONFLICT(event_kind, event_occurred_at) DO UPDATE SET
         attempted_at = excluded.attempted_at, success = 0, message = excluded.message, error = excluded.error`
    ).run(occurredAt, new Date().toISOString(), message, errorMessage)
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
