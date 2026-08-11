import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getTodayBoundaryRangeUtc } from '../src/shared/dayBoundary.ts'

test('a time after the boundary hour belongs to today starting at the boundary', () => {
  // 2026-08-11 14:30 local, 6am boundary -> today spans [08-11 06:00, 08-12 06:00) local
  const now = new Date(2026, 7, 11, 14, 30, 0)
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(6, now)

  assert.equal(startUtc, new Date(2026, 7, 11, 6, 0, 0).toISOString())
  assert.equal(endUtc, new Date(2026, 7, 12, 6, 0, 0).toISOString())
})

test('a time before the boundary hour still belongs to the previous window (late-night stream case)', () => {
  // 2026-08-11 03:00 local (past midnight, before 6am boundary) -> the
  // "day" that started 2026-08-10 06:00 hasn't rolled over yet.
  const now = new Date(2026, 7, 11, 3, 0, 0)
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(6, now)

  assert.equal(startUtc, new Date(2026, 7, 10, 6, 0, 0).toISOString())
  assert.equal(endUtc, new Date(2026, 7, 11, 6, 0, 0).toISOString())
})

test('exactly at the boundary hour belongs to the new day', () => {
  const now = new Date(2026, 7, 11, 6, 0, 0)
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(6, now)

  assert.equal(startUtc, new Date(2026, 7, 11, 6, 0, 0).toISOString())
  assert.equal(endUtc, new Date(2026, 7, 12, 6, 0, 0).toISOString())
})

test('a captured timestamp just before the boundary is excluded, just after is included', () => {
  const now = new Date(2026, 7, 11, 14, 0, 0) // some time solidly "today"
  const { startUtc, endUtc } = getTodayBoundaryRangeUtc(6, now)

  const justBefore = new Date(2026, 7, 11, 5, 59, 59).toISOString()
  const justAfter = new Date(2026, 7, 11, 6, 0, 1).toISOString()

  assert.ok(justBefore < startUtc, 'timestamp just before the boundary should be excluded')
  assert.ok(justAfter >= startUtc && justAfter < endUtc, 'timestamp just after the boundary should be included')
})
