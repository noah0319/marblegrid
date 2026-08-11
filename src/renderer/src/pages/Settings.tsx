import { useCallback, useEffect, useState } from 'react'
import type { TwitchStatus } from '@shared/types'
import { SERVER_PORT } from '@shared/constants'
import './Settings.css'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface TestPostResult {
  success: boolean
  message?: string
  error?: string
}

export default function Settings(): React.JSX.Element {
  const [status, setStatus] = useState<TwitchStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [testResult, setTestResult] = useState<TestPostResult | null>(null)
  const [testing, setTesting] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`${BASE}/api/twitch/status`)
    if (res.ok) setStatus((await res.json()) as TwitchStatus)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // While waiting on the browser-based OAuth step (which happens outside
  // this window entirely), poll for the moment it completes instead of
  // making Noah manually refresh.
  useEffect(() => {
    if (!connecting) return
    const timer = setInterval(() => {
      void refresh().then(() => {
        if (status?.connected) setConnecting(false)
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [connecting, refresh, status?.connected])

  async function saveCredentials(): Promise<void> {
    setSaving(true)
    try {
      await fetch(`${BASE}/api/twitch/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      })
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  async function connect(): Promise<void> {
    setConnecting(true)
    await fetch(`${BASE}/api/twitch/connect`, { method: 'POST' })
  }

  async function disconnect(): Promise<void> {
    await fetch(`${BASE}/api/twitch/disconnect`, { method: 'POST' })
    await refresh()
  }

  async function toggleAutoPost(enabled: boolean): Promise<void> {
    await fetch(`${BASE}/api/twitch/auto-post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled })
    })
    await refresh()
  }

  async function sendTestPost(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`${BASE}/api/twitch/test-post`, { method: 'POST' })
      setTestResult((await res.json()) as TestPostResult)
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <h1 className="settings__title">Settings</h1>

      <section className="settings__card">
        <h2 className="settings__card-title">Twitch connection</h2>
        <p className="settings__hint">
          Register a free app at{' '}
          <span className="settings__mono">dev.twitch.tv/console/apps</span> — see{' '}
          <span className="settings__mono">02 Twitch Integration</span> in the vault for the full
          walkthrough. Redirect URL must be exactly{' '}
          <span className="settings__mono">http://localhost:{SERVER_PORT}/oauth/callback</span>.
        </p>

        {status?.connected ? (
          <div className="settings__connected">
            <span className="settings__connected-dot" />
            Connected as <strong>{status.login}</strong>
            <button type="button" className="settings__btn settings__btn--ghost" onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        ) : (
          <>
            <div className="settings__field">
              <label htmlFor="clientId">Client ID</label>
              <input
                id="clientId"
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="from dev.twitch.tv"
              />
            </div>
            <div className="settings__field">
              <label htmlFor="clientSecret">Client Secret</label>
              <input
                id="clientSecret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="from dev.twitch.tv"
              />
            </div>
            <div className="settings__actions">
              <button
                type="button"
                className="settings__btn"
                disabled={!clientId || !clientSecret || saving}
                onClick={() => void saveCredentials()}
              >
                {saving ? 'Saving…' : 'Save credentials'}
              </button>
              <button
                type="button"
                className="settings__btn settings__btn--accent"
                disabled={!status?.hasCredentials || connecting}
                onClick={() => void connect()}
              >
                {connecting ? 'Waiting for you to authorize…' : 'Connect Twitch Account'}
              </button>
            </div>
            {connecting && (
              <p className="settings__hint">
                A browser tab should have opened to Twitch's own site. Authorize there — this page updates
                automatically once it's done.
              </p>
            )}
          </>
        )}
      </section>

      <section className="settings__card">
        <h2 className="settings__card-title">Chat posting</h2>
        {!status?.connected ? (
          <p className="settings__hint">Connect Twitch above first.</p>
        ) : (
          <>
            <div className="settings__actions">
              <button
                type="button"
                className="settings__btn"
                disabled={testing}
                onClick={() => void sendTestPost()}
              >
                {testing ? 'Sending…' : 'Send test post'}
              </button>
            </div>
            {testResult && (
              <p className={`settings__test-result ${testResult.success ? 'settings__test-result--ok' : 'settings__test-result--fail'}`}>
                {testResult.success ? '✓ Sent — check your chat.' : `✗ ${testResult.error ?? 'Failed to send.'}`}
              </p>
            )}

            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={status.autoPostEnabled}
                onChange={(e) => void toggleAutoPost(e.target.checked)}
              />
              <span>Auto-post race results to chat</span>
            </label>
            <p className="settings__hint">
              Defaults off on purpose. Verify with a test post and watch the dashboard track correctly for a
              bit before turning this on — and ideally on a low-stakes stream, not a big event night.
            </p>
          </>
        )}
      </section>

      <section className="settings__card">
        <h2 className="settings__card-title">Stats</h2>
        <p className="settings__hint">
          Day-boundary hour for &quot;Today&quot; stats: <strong>6:00 AM</strong> (fixed for now).
        </p>
      </section>
    </div>
  )
}
