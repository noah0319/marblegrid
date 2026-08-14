import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from '../src/main/backend/db/db.ts'
import { ingestRaceFromText } from '../src/main/backend/watcher/parsers/race.ts'
import { handleChatCommand, resetCommandCooldowns } from '../src/main/backend/twitch/commands.ts'
import type { ChatCommandContext } from '../src/main/backend/twitch/commands.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures')
const read = (name: string): string => readFileSync(join(FIXTURES_DIR, name), 'utf-8')

// Deliberately NOT a fixed historical date: ingestRaceFromText sets
// captured_at_local to the REAL wall-clock time of ingestion (confirmed by
// stats.test.ts's "today stats include an event captured moments ago"),
// not the fixture CSV's embedded GeneratedAtUtc. Pinning `now` to a fixed
// past date here would desync the day-boundary window from where the
// ingested row actually lands and break the "today"-scoped assertions.
function ctx(overrides: Partial<ChatCommandContext> = {}): ChatCommandContext {
  return { chatterId: '1', chatterName: 'schoklad', chatterDisplayName: 'schoklad', ...overrides }
}

beforeEach(() => {
  initDb(':memory:')
  resetCommandCooldowns()
})

afterEach(() => {
  closeDb()
})

test('a plain chat message (no leading !) is not a command', () => {
  assert.equal(handleChatCommand('gg that was close', ctx()), null)
})

test('an unrecognized command is ignored, not an error', () => {
  assert.equal(handleChatCommand('!notarealcommand', ctx()), null)
})

test('command matching is case-insensitive', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!MyStats', ctx())
  assert.ok(reply?.includes('schoklad'))
})

test('!mystats, !mymarble, and !myballs are true aliases — identical behavior', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  // Different chatterId on each call so a later one isn't just suppressed by
  // an earlier one's own per-user cooldown — this is testing alias
  // equivalence, not cooldown behavior (that's covered separately below).
  const a = handleChatCommand('!mystats', ctx({ chatterId: '1' }))
  const b = handleChatCommand('!mymarble', ctx({ chatterId: '2' }))
  const c = handleChatCommand('!myballs', ctx({ chatterId: '3' }))
  assert.ok(a)
  assert.equal(a, b)
  assert.equal(a, c)
})

test('!myballs @username is the same lookup as !mystats @username — same handler, Noah asked for this explicitly ("for the memes")', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // includes schoklad and RahHerself
  const viaMystats = handleChatCommand('!mystats @RahHerself', ctx({ chatterId: 'caller-1' }))
  const viaMyballs = handleChatCommand('!myballs @RahHerself', ctx({ chatterId: 'caller-2' }))
  assert.ok(viaMystats)
  assert.equal(viaMystats, viaMyballs)
  assert.match(viaMyballs ?? '', /^@RahHerself:/)
})

test('!myballs username (no @) also works', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!myballs schoklad', ctx({ chatterId: 'caller-3', chatterName: 'rahherself', chatterDisplayName: 'RahHerself' }))
  assert.match(reply ?? '', /^@schoklad:/)
})

test('!mystats reports today AND season stats (points, races, PPR), using the real fixture', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!mystats', ctx())
  // Only one race exists in this test, so today and season are identical
  // here by coincidence, not because they're the same query — see the
  // dedicated "can differ" test below for proof they're independent scopes.
  assert.equal(reply, '@schoklad: Today: 4,602 pts (1 race) | Season: 4,602 pts, 1 race, 4,602 PPR.')
})

test('!mystats resolves the chatter to a racer case-insensitively', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  // Twitch reports the chatter's login as "RahHerself" here; the racers
  // table has it lowercase ("rahherself") from the CSV's Username column.
  const reply = handleChatCommand('!mystats', ctx({ chatterName: 'RahHerself', chatterDisplayName: 'RahHerself' }))
  assert.equal(reply, '@RahHerself: Today: 4,234 pts (1 race) | Season: 4,234 pts, 1 race, 4,234 PPR.')
})

test('!mystats is friendly to someone who has never raced, not a crash or a bare zero', () => {
  const reply = handleChatCommand('!mystats', ctx({ chatterName: 'totalstranger', chatterDisplayName: 'TotalStranger' }))
  assert.match(reply ?? '', /hasn't raced yet/)
})

test("!mystats season stats CAN differ from today's — they're independent scopes, not the same window read twice", () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // real captured_at_local = actual test-run time

  // Push "today" far into the future so the real ingestion timestamp falls
  // outside today's window, while season scoping (not day-based at all)
  // still includes it.
  const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const reply = handleChatCommand('!mystats', ctx({ now: farFuture }))
  assert.match(reply ?? '', /Today: 0 pts \(0 races\)/)
  assert.match(reply ?? '', /Season: 4,602 pts, 1 race, 4,602 PPR/)
})

test('!mystats @username looks up someone elses stats, not the callers own', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // includes schoklad and RahHerself
  const reply = handleChatCommand('!mystats @RahHerself', ctx({ chatterId: 'caller', chatterName: 'schoklad', chatterDisplayName: 'schoklad' }))
  assert.equal(reply, '@RahHerself: Today: 4,234 pts (1 race) | Season: 4,234 pts, 1 race, 4,234 PPR.')
})

test('!mystats username also works without the leading @', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!mystats RahHerself', ctx({ chatterId: 'caller', chatterName: 'schoklad', chatterDisplayName: 'schoklad' }))
  assert.match(reply ?? '', /^@RahHerself:/)
})

test('!mystats @username resolves the LOOKED-UP racers own stored display name, not whatever casing the caller typed', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!mystats @RAHHERSELF', ctx({ chatterId: 'caller', chatterName: 'schoklad', chatterDisplayName: 'schoklad' }))
  assert.match(reply ?? '', /^@RahHerself:/, 'should show the stored "RahHerself" casing, not the typed "RAHHERSELF"')
})

test('!mystats @username for someone who has never raced is friendly, not a crash', () => {
  const reply = handleChatCommand('!mystats @totalstranger', ctx())
  assert.match(reply ?? '', /^@totalstranger hasn't raced yet/)
})

test('!mywins @username also looks up someone else, same mechanism as !mystats', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv')) // schoklad is the real winner (position 1)
  const reply = handleChatCommand('!mywins @schoklad', ctx({ chatterId: 'caller', chatterName: 'rahherself', chatterDisplayName: 'RahHerself' }))
  assert.equal(reply, '@schoklad has 1 win this season.')
})

test('!mywins counts season wins (position 1) for the real winner', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!mywins', ctx())
  assert.equal(reply, '@schoklad has 1 win this season.')
})

test('!mywins is 0 for someone who raced but never won', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!mywins', ctx({ chatterName: 'rahherself', chatterDisplayName: 'RahHerself' }))
  assert.equal(reply, '@RahHerself has 0 wins this season.')
})

test('!top10today lists real racers ranked by points earned today', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!top10today', ctx())
  assert.match(reply ?? '', /^🏁 Top 10 today: 1\. schoklad \(4,602\), 2\. RahHerself \(4,234\)/)
})

test('!top10season lists real racers ranked by season points', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!top10season', ctx())
  assert.match(reply ?? '', /^🏁 Top 10 this season: 1\. schoklad \(4,602\)/)
})

test('!racehs reports the real season Race HS, who holds it, and which map it was scored on', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!racehs', ctx())
  assert.equal(reply, '🏁 Season Race HS: 4,602 points — schoklad on feel the fire.')
})

test('!racehs is friendly when no race has been captured yet this season, not a fake zero', () => {
  const reply = handleChatCommand('!racehs', ctx())
  assert.equal(reply, '🏁 No races captured yet this season.')
})

test('!ghostballs with no argument gives a usage hint instead of guessing', () => {
  const reply = handleChatCommand('!ghostballs', ctx())
  assert.equal(reply, 'Usage: !ghostballs <map name>')
})

test('!ghostballs finds the real map record by exact name, showing the creator for disambiguation', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!ghostballs feel the fire', ctx())
  assert.match(reply ?? '', /^👻 feel the fire \(zim2325\): best time 2m 13\.4s, held by schoklad — played 1 time\.$/)
})

test('!ghostballs matches case-insensitively and by partial name', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!ghostballs FIRE', ctx())
  assert.match(reply ?? '', /feel the fire/)
})

test('!ghostballs also matches by map CREATOR — a lookup for "everything by this person"', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!ghostballs zim2325', ctx())
  assert.match(reply ?? '', /^👻 feel the fire \(zim2325\)/)
})

test('!ghostballs reports no match cleanly rather than an empty/broken reply', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const reply = handleChatCommand('!ghostballs nonexistent map xyz', ctx())
  assert.equal(reply, 'No Ghost Balls record found for "nonexistent map xyz".')
})

test('a per-user command on cooldown returns null for the SAME user but still answers a DIFFERENT user', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const first = handleChatCommand('!mystats', ctx({ chatterId: 'user-a' }))
  const secondSameUser = handleChatCommand('!mystats', ctx({ chatterId: 'user-a' }))
  const differentUser = handleChatCommand('!mystats', ctx({ chatterId: 'user-b', chatterName: 'rahherself', chatterDisplayName: 'RahHerself' }))
  assert.ok(first)
  assert.equal(secondSameUser, null, 'same user, same command, within cooldown must be suppressed')
  assert.ok(differentUser, "a different user's own request must not be blocked by someone else's cooldown")
})

test('a global-cooldown command (!top10today) is shared across ALL users, not per-user', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  const first = handleChatCommand('!top10today', ctx({ chatterId: 'user-a' }))
  const secondDifferentUser = handleChatCommand('!top10today', ctx({ chatterId: 'user-b' }))
  assert.ok(first)
  assert.equal(secondDifferentUser, null, 'global cooldown must block a second caller too, not just the same one')
})

test('cooldown expires after enough time passes', () => {
  ingestRaceFromText(read('race-summary-sample.csv'), read('race-participants-sample.csv'))
  // Offsets from the real current time (not a fixed historical date) so the
  // underlying "today" window (also real-time-based) still contains the
  // race that was just really-ingested a moment ago.
  const base = Date.now()
  const first = handleChatCommand('!mystats', ctx({ now: new Date(base) }))
  const tooSoon = handleChatCommand('!mystats', ctx({ now: new Date(base + 1000) }))
  const later = handleChatCommand('!mystats', ctx({ now: new Date(base + 11_000) }))
  assert.ok(first)
  assert.equal(tooSoon, null)
  assert.ok(later)
})
