import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync } from 'fs'
import { initDb, closeDb, getDb } from '../src/main/backend/db/db.ts'
import { initSettingsStore, updateSettings } from '../src/main/backend/twitch/settingsStore.ts'
import { maybePostEventToChat, sendTestPost } from '../src/main/backend/twitch/chatPoster.ts'
import { buildChatMessage } from '../src/main/backend/twitch/messageTemplates.ts'
import type { LatestEventSummary } from '../src/shared/types.ts'

let settingsPath: string

beforeEach(() => {
  initDb(':memory:')
  settingsPath = join(tmpdir(), `marblegrid-test-settings-${Date.now()}-${Math.random()}.json`)
  initSettingsStore(settingsPath)
})

afterEach(() => {
  closeDb()
  rmSync(settingsPath, { force: true })
})

const raceEvent: LatestEventSummary = {
  kind: 'race',
  occurredAt: '2026-08-11T16:59:03.229Z',
  label: 'feel the fire',
  winnerName: 'schoklad',
  winnerPoints: 4602,
  topFinishers: [
    { name: 'schoklad', points: 4602 },
    { name: 'RahHerself', points: 4234 }
  ],
  allScorers: [
    { name: 'schoklad', points: 4602 },
    { name: 'RahHerself', points: 4234 },
    { name: 'Coryash', points: 3866 }
  ]
}

test('buildChatMessage formats each event kind distinctly, listing every scorer', () => {
  assert.equal(
    buildChatMessage(raceEvent),
    'Race complete on feel the fire! 🏆 schoklad wins with 4,602 points. Also scoring: RahHerself 4,234, Coryash 3,866'
  )
  assert.equal(
    buildChatMessage({ ...raceEvent, kind: 'tilt', label: 'Tilted — Level 13' }),
    'Tilted level complete — Tilted — Level 13! 🏆 schoklad wins with 4,602 points. Also scoring: RahHerself 4,234, Coryash 3,866'
  )
  assert.equal(
    buildChatMessage({ ...raceEvent, kind: 'royale', label: 'Battle Royale' }),
    'Battle Royale complete! 🏆 schoklad wins with 4,602 points. Also scoring: RahHerself 4,234, Coryash 3,866'
  )
})

test('buildChatMessage falls back to winner-only when nobody scored above 0 (eg. a Tilt level nobody finished)', () => {
  assert.equal(
    buildChatMessage({ ...raceEvent, winnerPoints: 0, allScorers: [] }),
    'Race complete on feel the fire! schoklad takes it with 0 points.'
  )
})

test('buildChatMessage omits "Also scoring" when only the winner actually scored', () => {
  assert.equal(
    buildChatMessage({ ...raceEvent, allScorers: [{ name: 'schoklad', points: 4602 }] }),
    'Race complete on feel the fire! 🏆 schoklad wins with 4,602 points.'
  )
})

test('buildChatMessage truncates a long scorer list with "+N more" instead of exceeding the 500-char Twitch limit', () => {
  const manyScorers = Array.from({ length: 60 }, (_, i) => ({
    name: `RacerWithALongUsername${i}`,
    points: 1000 - i
  }))
  const message = buildChatMessage({ ...raceEvent, allScorers: manyScorers })
  assert.ok(message.length <= 500, `expected <=500 chars, got ${message.length}`)
  assert.match(message, /\+\d+ more$/)
  // The winner and the highest-ranked runners-up must never be the ones cut —
  // truncation drops from the tail (lowest scorers), not the front.
  assert.match(message, /RacerWithALongUsername0\b/)
})

test('does nothing when auto-post is off (the default)', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: false })
  let calls = 0
  const result = await maybePostEventToChat(raceEvent, async () => {
    calls += 1
  })
  assert.equal(result.attempted, false)
  assert.equal(calls, 0)
})

test('does nothing when auto-post is on but nothing is connected', async () => {
  updateSettings({ userId: null, autoPostEnabled: true })
  let calls = 0
  const result = await maybePostEventToChat(raceEvent, async () => {
    calls += 1
  })
  assert.equal(result.attempted, false)
  assert.equal(calls, 0)
})

test('sends and logs success when enabled and connected', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: true })
  const sent: { broadcasterId: string; message: string }[] = []
  const result = await maybePostEventToChat(raceEvent, async (broadcasterId, message) => {
    sent.push({ broadcasterId, message })
  })

  assert.equal(result.attempted, true)
  assert.equal(result.success, true)
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.broadcasterId, 'u1')
  assert.match(sent[0]?.message ?? '', /schoklad/)

  const db = getDb()
  const row = db
    .prepare('SELECT * FROM chat_post_log WHERE event_kind = ? AND event_occurred_at = ?')
    .get('race', raceEvent.occurredAt) as { success: number }
  assert.equal(row.success, 1)
})

test('the exact same event is never posted twice (restart-safe dedupe)', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: true })
  let calls = 0
  const sendFn = async (): Promise<void> => {
    calls += 1
  }

  await maybePostEventToChat(raceEvent, sendFn)
  const second = await maybePostEventToChat(raceEvent, sendFn)

  assert.equal(calls, 1)
  assert.equal(second.attempted, false)
})

test('retries exactly once on failure, then gives up and logs — never queues stale posts', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: true })
  let calls = 0
  const alwaysFails = async (): Promise<void> => {
    calls += 1
    throw new Error('simulated network failure')
  }

  const result = await maybePostEventToChat(raceEvent, alwaysFails)

  assert.equal(calls, 2) // one attempt + one retry, not more
  assert.equal(result.success, false)
  assert.equal(result.error, 'simulated network failure')

  const db = getDb()
  const row = db
    .prepare('SELECT * FROM chat_post_log WHERE event_kind = ? AND event_occurred_at = ?')
    .get('race', raceEvent.occurredAt) as { success: number; error: string }
  assert.equal(row.success, 0)
  assert.equal(row.error, 'simulated network failure')
})

test('a failed post CAN be retried by a later call for the same event (only successes block re-sending)', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: true })
  let attempt = 0

  const firstResult = await maybePostEventToChat(raceEvent, async () => {
    attempt += 1
    throw new Error('down')
  })
  assert.equal(firstResult.success, false)

  const secondResult = await maybePostEventToChat(raceEvent, async () => {
    attempt += 1
  })
  assert.equal(secondResult.attempted, true)
  assert.equal(secondResult.success, true)
  assert.equal(attempt, 3) // 2 failed attempts from the first call, 1 successful from the second
})

test('sendTestPost bypasses the auto-post toggle and dedupe entirely', async () => {
  updateSettings({ userId: 'u1', autoPostEnabled: false }) // deliberately off
  let calls = 0
  const result = await sendTestPost(async () => {
    calls += 1
  })
  assert.equal(result.success, true)
  assert.equal(calls, 1)
})

test('sendTestPost fails clearly when nothing is connected', async () => {
  updateSettings({ userId: null })
  const result = await sendTestPost(async () => {})
  assert.equal(result.success, false)
  assert.match(result.error ?? '', /not connected/)
})
