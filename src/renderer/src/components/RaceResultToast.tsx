import { useEffect, useRef, useState } from 'react'
import type { LatestEventSummary } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './RaceResultToast.css'

const VISIBLE_MS = 10_000

const MODE_LABEL: Record<LatestEventSummary['kind'], string> = {
  race: 'RACE',
  tilt: 'TILTED',
  royale: 'BATTLE ROYALE'
}

interface RaceResultToastProps {
  event: LatestEventSummary | null
}

/**
 * Slides in when a NEW event arrives (keyed on occurredAt, so a duplicate
 * fetch of the same event doesn't re-trigger the animation), stays for 10s,
 * then disappears — this is the "wow" moment viewers actually see live.
 */
export default function RaceResultToast({ event }: RaceResultToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const shownKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!event) return
    if (shownKeyRef.current === event.occurredAt) return
    shownKeyRef.current = event.occurredAt
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [event])

  if (!event || !visible) return null

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
