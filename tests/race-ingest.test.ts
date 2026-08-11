import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb, getDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { ingestTiltFromText } from '../src/main/backend/watcher/parsers/tilt.ts'
import { ingestRoyaleFromText } from '../src/main/backend/watcher/parsers/royale.ts'

// This file runs directly under `node --experimental-strip-types`, which
// parses it as an ES module (import/export syntax) rather than CommonJS —
// so __dirname isn't available as a bare global the way it is in the
// electron-vite-bundled main-process code (which builds to CJS).
const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

beforeEach(() => {
  initDb(':memory:')
})

afterEach(() => {
  closeDb()
})

test('ingests the real confirmed race sample and computes correct totals', () => {
  const raceEventId = ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  assert.notEqual(raceEventId, null)

  const db = getDb()
  const event = db.prepare('SELECT * FROM race_events WHERE id = ?').get(raceEventId) as Record<
    string,
    unknown
  >
  assert.equal(event.map_name, 'feel the fire')
  assert.equal(event.player_count, 49)
  assert.equal(event.finished_count, 19)
  assert.equal(event.eliminated_count, 30)
  assert.equal(event.winner_username, 'schoklad')

  const participantCount = db
    .prepare('SELECT COUNT(*) as c FROM race_participants WHERE race_event_id = ?')
    .get(raceEventId) as { c: number }
  assert.equal(participantCount.c, 49)

  const winnerRow = db
    .prepare(
      `SELECT rp.season_points_earned, rp.eliminated FROM race_participants rp
       JOIN racers r ON r.id = rp.racer_id
       WHERE rp.race_event_id = ? AND r.username = 'schoklad'`
    )
    .get(raceEventId) as { season_points_earned: number; eliminated: number }

  // This is the exact number that matches MyStats' "Race HS: 4,602" from the
  // real screenshot cross-checked this session — see
  // 00 Game & Data Reference/(C) csv-schemas-and-data-source.md.
  assert.equal(winnerRow.season_points_earned, 4602)
  assert.equal(winnerRow.eliminated, 0) // confirms "false" string -> 0, not a truthy non-empty-string bug
})

test('ingesting the same race twice does not duplicate it', () => {
  const summaryText = read('race-summary-sample.csv')
  const participantsText = read('race-participants-sample.csv')

  const firstId = ingestRaceFromText(summaryText, participantsText)
  const secondId = ingestRaceFromText(summaryText, participantsText)
  assert.equal(firstId, secondId)

  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as c FROM race_events').get() as { c: number }
  assert.equal(count.c, 1)
  const participantCount = db.prepare('SELECT COUNT(*) as c FROM race_participants').get() as {
    c: number
  }
  assert.equal(participantCount.c, 49)
})

test('a racer seen in more than one event is not duplicated in the racers table', () => {
  // noonspins (position 33) appears in both the race and tilt fixtures.
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  ingestTiltFromText(read('tilt-level-sample.csv'), read('tilt-players-sample.csv'))

  const db = getDb()
  const count = db.prepare("SELECT COUNT(*) as c FROM racers WHERE username = 'noonspins'").get() as {
    c: number
  }
  assert.equal(count.c, 1)
})

test('ingests the real confirmed tilt sample', () => {
  const tiltEventId = ingestTiltFromText(read('tilt-level-sample.csv'), read('tilt-players-sample.csv'))
  assert.notEqual(tiltEventId, null)

  const db = getDb()
  const event = db.prepare('SELECT * FROM tilt_events WHERE id = ?').get(tiltEventId) as Record<
    string,
    unknown
  >
  assert.equal(event.top_tiltee_username, 'lunchbox701')
  assert.equal(event.level_passed, 0) // "false" -> 0
  assert.equal(event.live_stream_active, 1) // "true" -> 1

  const playerCount = db
    .prepare('SELECT COUNT(*) as c FROM tilt_participants WHERE tilt_event_id = ?')
    .get(tiltEventId) as { c: number }
  assert.equal(playerCount.c, 8)
})

test('ingests the real confirmed royale sample despite its different schema (no SnapshotId/timestamp)', () => {
  const royaleEventId = ingestRoyaleFromText(read('royale-sample.csv'))
  assert.notEqual(royaleEventId, null)

  const db = getDb()
  const winner = db
    .prepare(
      `SELECT rp.points_earned, rp.eliminated FROM royale_participants rp
       JOIN racers r ON r.id = rp.racer_id
       WHERE rp.royale_event_id = ? AND r.username = 'shaidarharan'`
    )
    .get(royaleEventId) as { points_earned: number; eliminated: number }
  assert.equal(winner.points_earned, 400)
  assert.equal(winner.eliminated, 0)
})

test('ingesting the same royale content twice does not duplicate it (content-hash dedupe)', () => {
  const text = read('royale-sample.csv')
  const firstId = ingestRoyaleFromText(text)
  const secondId = ingestRoyaleFromText(text)
  assert.equal(firstId, secondId)

  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as c FROM royale_events').get() as { c: number }
  assert.equal(count.c, 1)
})

test('a Status: Error race (real data, captured live 2026-08-11 on "Buckshot") is never recorded as a real event', () => {
  // Confirmed live: the game writes a row for an errored race with the
  // point fields completely blank (not "0") — zod's coerce.number() turns
  // '' into 0 without throwing, so this specifically guards against
  // silently recording a broken race as a real one where everyone "scored 0."
  const raceEventId = ingestRaceFromText(
    read('race-summary-error-sample.csv'),
    read('race-participants-error-sample.csv')
  )
  assert.equal(raceEventId, null)

  const db = getDb()
  const eventCount = db.prepare('SELECT COUNT(*) as c FROM race_events').get() as { c: number }
  assert.equal(eventCount.c, 0)
  const participantCount = db.prepare('SELECT COUNT(*) as c FROM race_participants').get() as {
    c: number
  }
  assert.equal(participantCount.c, 0)
})

test('an errored race does not pollute season stats even if a valid race is also ingested', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  ingestRaceFromText(read('race-summary-error-sample.csv'), read('race-participants-error-sample.csv'))

  const db = getDb()
  const eventCount = db.prepare('SELECT COUNT(*) as c FROM race_events').get() as { c: number }
  assert.equal(eventCount.c, 1) // only the valid "feel the fire" race counts
})

test('the same Status guard applies to Tilt (no real errored sample exists yet, so this simulates one)', () => {
  const erroredLevelText = read('tilt-level-sample.csv').replace(',Final,', ',Error,')
  const tiltEventId = ingestTiltFromText(erroredLevelText, read('tilt-players-sample.csv'))
  assert.equal(tiltEventId, null)

  const db = getDb()
  const count = db.prepare('SELECT COUNT(*) as c FROM tilt_events').get() as { c: number }
  assert.equal(count.c, 0)
})
