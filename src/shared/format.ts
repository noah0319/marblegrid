// Shared so the desktop UI, the OBS overlay (Phase 4), and chat message
// templates (Phase 5) all render numbers identically.

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
})
const fullFormatter = new Intl.NumberFormat('en-US')

/** 1,284 -> "1.3K", 4200000 -> "4.2M" — for stat-tile headline values. */
export function formatCompactNumber(value: number): string {
  return compactFormatter.format(value)
}

/** 32932 -> "32,932" — for table columns and anywhere the exact value matters. */
export function formatFullNumber(value: number): string {
  return fullFormatter.format(Math.round(value))
}

export function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60)
  const seconds = (value % 60).toFixed(1)
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`
}
