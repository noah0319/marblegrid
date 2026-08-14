import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { getLeaderboardLabels, setLeaderboardLabel } from '../src/main/backend/db/queries/leaderboardLabels.ts'

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

test('always returns exactly 5 ranks, blank for any Noah has not labeled yet', () => {
  const labels = getLeaderboardLabels()
  assert.equal(labels.length, 5)
  assert.deepEqual(
    labels.map((l) => l.rankPosition),
    [1, 2, 3, 4, 5]
  )
  assert.ok(labels.every((l) => l.labelText === ''))
})

test('setting a label makes it show up at the right rank, others stay blank', () => {
  setLeaderboardLabel(1, 'iPad')

  const labels = getLeaderboardLabels()
  assert.equal(labels.find((l) => l.rankPosition === 1)?.labelText, 'iPad')
  assert.equal(labels.find((l) => l.rankPosition === 2)?.labelText, '')
})

test('setting a label twice for the same rank replaces it rather than stacking', () => {
  setLeaderboardLabel(2, 'first guess')
  setLeaderboardLabel(2, 'AirPods')

  const labels = getLeaderboardLabels()
  assert.equal(labels.find((l) => l.rankPosition === 2)?.labelText, 'AirPods')
})

test('saving blank text clears an existing label rather than storing an empty one', () => {
  setLeaderboardLabel(3, 'gift card')
  setLeaderboardLabel(3, '   ') // whitespace-only

  const labels = getLeaderboardLabels()
  assert.equal(labels.find((l) => l.rankPosition === 3)?.labelText, '')
})

test('labels for different ranks are independent', () => {
  setLeaderboardLabel(1, 'iPad')
  setLeaderboardLabel(5, 'sticker pack')

  const labels = getLeaderboardLabels()
  assert.equal(labels.find((l) => l.rankPosition === 1)?.labelText, 'iPad')
  assert.equal(labels.find((l) => l.rankPosition === 5)?.labelText, 'sticker pack')
  assert.equal(labels.find((l) => l.rankPosition === 3)?.labelText, '')
})
