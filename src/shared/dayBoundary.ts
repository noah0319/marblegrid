/**
 * "Today" is a local-calendar concept with a configurable boundary hour
 * (default 6am) rather than midnight, so a stream running past midnight
 * doesn't arbitrarily split into two "days." Pure function, no I/O — takes
 * "now" as a parameter so it's trivially testable without mocking the clock.
 *
 * Returns a UTC ISO range [startUtc, endUtc) suitable for comparing directly
 * against the UTC-stored `captured_at_local` columns (misleading column name
 * carried over from the data model doc — it's captured-at-in-UTC; "local" as
 * in "our capture time," not "local timezone." Comparisons here convert the
 * boundary to UTC using the system's local timezone, which is correct since
 * MarbleGrid only ever runs on the streamer's own PC.
 */
export function getTodayBoundaryRangeUtc(
  dayBoundaryHour: number,
  now: Date = new Date()
): { startUtc: string; endUtc: string } {
  const boundaryToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), dayBoundaryHour, 0, 0, 0)

  const start = new Date(boundaryToday)
  if (now < boundaryToday) {
    start.setDate(start.getDate() - 1)
  }

  const end = new Date(start)
  end.setDate(end.getDate() + 1)

  return { startUtc: start.toISOString(), endUtc: end.toISOString() }
}
