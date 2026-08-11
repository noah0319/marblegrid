import { useEffect, useState } from 'react'
import { SERVER_PORT } from '@shared/constants'

interface StatusResponse {
  status: string
  app: string
  phase: number
}

// Phase 0 placeholder — proves the Electron window <-> local backend loop
// works end to end. Real dashboard UI (dark HUD/neon, via the dataviz skill)
// lands in Phase 3.
export default function App(): React.JSX.Element {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`http://127.0.0.1:${SERVER_PORT}/api/status`)
      .then((res) => res.json())
      .then(setStatus)
      .catch((err: unknown) => setError(String(err)))
  }, [])

  return (
    <div
      style={{
        background: '#0a0a0f',
        color: '#e8e8f0',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        gap: '0.5rem'
      }}
    >
      <h1 style={{ color: '#7dfdfe', textShadow: '0 0 12px #7dfdfe88', letterSpacing: '0.05em' }}>
        MARBLEGRID
      </h1>
      {status && (
        <p>
          Backend status: <strong style={{ color: '#7dfe9c' }}>{status.status}</strong> (Phase{' '}
          {status.phase} scaffold)
        </p>
      )}
      {error && <p style={{ color: '#ff6b6b' }}>Could not reach backend: {error}</p>}
    </div>
  )
}
