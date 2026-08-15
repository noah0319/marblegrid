import { useEffect, useRef, useState } from 'react'
import type { LatestEventSummary } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './RaceResultToast.css'

const DEFAULT_VISIBLE_MS = 10_000

const MODE_LABEL: Record<LatestEventSummary['kind'], string> = {
  race: 'RACE',
  tilt: 'TILTED',
  royale: 'BATTLE ROYALE'
}

interface RaceResultToastProps {
  event: LatestEventSummary | null
  /** Noah's ask: configurable from Settings instead of a fixed 10s. Defaults to the old hardcoded value if the setting hasn't loaded yet. */
  visibleMs?: number
  /** Suppresses rendering while a world-record celebration is showing — same top-right slot, never both at once. The internal timer keeps running regardless, so this result still clears itself normally once the celebration ends. */
  hidden?: boolean
}

/**
 * Slides in when a NEW event arrives (keyed on occurredAt, so a duplicate
 * fetch of the same event doesn't re-trigger the animation), stays for
 * `visibleMs`, then disappears — this is the "wow" moment viewers actually
 * see live.
 */
export default function RaceResultToast({
  event,
  visibleMs = DEFAULT_VISIBLE_MS,
  hidden = false
}: RaceResultToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const shownKeyRef = useRef<string | null>(null)

  // Deliberately depends on event?.occurredAt (a primitive), NOT the whole
  // event object. useLatestEvent refetches on every WS 'hello' (sent on
  // every reconnect, not just the first — a fix for a DIFFERENT stale-
  // overlay bug) and setEvent(await res.json()) always produces a brand-new
  // object reference even when the data is identical. Depending on the
  // whole object meant a reconnect mid-display re-ran this effect: cleanup
  // cancelled the live hide-timer, then the shownKeyRef guard (correctly
  // recognizing "same event") returned early WITHOUT scheduling a new one —
  // leaving the toast stuck on screen indefinitely. That's the actual cause
  // of "why isn't it hiding by itself." OverlayLeaderboard's popup timer
  // already avoided this by depending on primitive row fields instead of
  // the whole row object; this brings RaceResultToast in line with that
  // already-proven-correct pattern.
  useEffect(() => {
    if (!event) return
    if (shownKeyRef.current === event.occurredAt) return
    shownKeyRef.current = event.occurredAt
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), visibleMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.occurredAt, visibleMs])

  if (!event || !visible || hidden) return null

  return (
    <div className={`race-toast race-toast--${event.kind}`}>
      <div className="race-toast__mode">{MODE_LABEL[event.kind]}</div>
      <div className="race-toast__label">{event.label}</div>
      <div className="race-toast__winner">
        <span className="race-toast__winner-name">{event.winnerName}</span>
        <span className="race-toast__winner-points">+{formatFullNumber(event.winnerPoints)}</span>
      </div>
      {event.topFinishers.length > 1 && (
        <div className="race-toast__runners-up">
          {event.topFinishers.slice(1).map((f) => (
            <span key={f.name} className="race-toast__runner-up">
              {f.name} <strong>{formatFullNumber(f.points)}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
