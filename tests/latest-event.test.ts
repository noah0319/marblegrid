import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { ingestTiltFromText } from '../src/main/backend/watcher/parsers/tilt.ts'
import { getLatestEvent } from '../src/main/backend/db/queries/latestEvent.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

test('returns null when nothing has been ingested yet', () => {
  assert.equal(getLatestEvent(), null)
})

test('surfaces the real confirmed race as a normalized event summary', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const latest = getLatestEvent()
  assert.ok(latest)
  assert.equal(latest?.kind, 'race')
  assert.equal(latest?.label, 'feel the fire')
  assert.equal(latest?.winnerName, 'schoklad')
  assert.equal(latest?.winnerPoints, 4602)
  assert.equal(latest?.topFinishers.length, 3)
  assert.equal(latest?.topFinishers[1]?.name, 'RahHerself')
  assert.equal(latest?.topFinishers[1]?.points, 4234)
})

test('allScorers lists every real participant who earned points, uncapped — topFinishers stays capped at 3', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))

  const latest = getLatestEvent()
  // Real fixture: 49 participants, exactly 12 with SeasonPointsEarned > 0
  // (the rest are 0 — DNF/eliminated-before-scoring). allScorers must
  // include all 12, not just the top 3 the overlay's HUD toast wants.
  assert.equal(latest?.allScorers.length, 12)
  assert.equal(latest?.allScorers[0]?.name, 'schoklad')
  assert.equal(latest?.allScorers[0]?.points, 4602)
  assert.equal(latest?.allScorers[11]?.name, 'craPPed_')
  assert.equal(latest?.allScorers[11]?.points, 1564)
  assert.ok(latest?.allScorers.every((s) => s.points > 0))
  assert.equal(latest?.topFinishers.length, 3)
})

test('picks whichever event actually happened most recently, not just "the race table"', () => {
  // Race ingested first, Tilt ingested second -> Tilt's captured_at_local is
  // later, so it should win even though Race is checked first in the query.
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  ingestTiltFromText(read('tilt-level-sample.csv'), read('tilt-players-sample.csv'))

  const latest = getLatestEvent()
  assert.equal(latest?.kind, 'tilt')
  assert.equal(latest?.label, 'Tilted — Level 13')
  // Properly-cased display name, resolved by direct username lookup — not
  // whichever 0-point participant an unstable ORDER BY tie-break sorted
  // first (every participant in this real sample has 0 points: nobody
  // finished the level).
  assert.equal(latest?.winnerName, 'Lunchbox701')
})

test('tilt winner resolution is not fooled by an all-zero-points tie (the real-data case)', () => {
  ingestTiltFromText(read('tilt-level-sample.csv'), read('tilt-players-sample.csv'))

  const latest = getLatestEvent()
  assert.equal(latest?.kind, 'tilt')
  assert.equal(latest?.winnerName, 'Lunchbox701')
  assert.equal(latest?.winnerPoints, 0)
  // Nobody scored above 0 in this real sample — allScorers must come back
  // empty rather than including a pile of 0-point rows, so buildChatMessage
  // knows to fall back to winner-only phrasing instead of an empty-looking
  // "Also scoring:" list.
  assert.equal(latest?.allScorers.length, 0)
})
