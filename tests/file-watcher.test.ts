import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTooStaleForCatchup } from '../src/main/backend/watcher/fileWatcher.ts'

// Pure decision logic extracted from the chokidar/fs glue specifically so it
// can be unit tested directly — the real bug this guards against (a 49-day-
// stale LastSeasonRoyale.csv ingested as a live event on first-ever startup,
// see fileWatcher.ts's comment) was found via live investigation, not a
// test, but the fix itself should never regress silently.

test('a file modified moments ago is never too stale for catchup', () => {
  const now = Date.now()
  assert.equal(isTooStaleForCatchup(now - 1000, now), false)
})

test('a file modified a couple days ago (a realistic gap between streams) still counts as a live catch-up', () => {
  const now = Date.now()
  const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000
  assert.equal(isTooStaleForCatchup(twoDaysAgo, now), false)
})

test('a file modified 49 days ago — the real bug this guards against — is too stale', () => {
  const now = Date.now()
  const fortyNineDaysAgo = now - 49 * 24 * 60 * 60 * 1000
  assert.equal(isTooStaleForCatchup(fortyNineDaysAgo, now), true)
})

test('the 72h threshold boundary is exclusive — exactly 72h old is not yet too stale, a moment past it is', () => {
  const now = Date.now()
  const seventyTwoHoursMs = 72 * 60 * 60 * 1000
  assert.equal(isTooStaleForCatchup(now - seventyTwoHoursMs, now), false)
  assert.equal(isTooStaleForCatchup(now - seventyTwoHoursMs - 1, now), true)
})
