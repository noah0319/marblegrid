import { useCallback, useEffect, useState } from 'react'
import type { TwitchStatus } from '@shared/types'
import { SERVER_PORT } from '@shared/constants'
import { useAppSettings } from '../hooks/useAppSettings'
import './Settings.css'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface TestPostResult {
  success: boolean
  message?: string
  error?: string
}

interface PreviewPostResult {
  success: boolean
  message?: string
  error?: string
}

export default function Settings(): React.JSX.Element {
  const [status, setStatus] = useState<TwitchStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [testResult, setTestResult] = useState<TestPostResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [previewResult, setPreviewResult] = useState<PreviewPostResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [botConnecting, setBotConnecting] = useState(false)

  const { settings: appSettings, loading: appSettingsLoading, refresh: refreshAppSettings } = useAppSettings()
  const [toastSeconds, setToastSeconds] = useState('10')
  const [toastSaving, setToastSaving] = useState(false)
  const [toastSaved, setToastSaved] = useState(false)
  const [boundaryHour, setBoundaryHour] = useState('6')
  const [boundarySaving, setBoundarySaving] = useState(false)
  const [boundarySaved, setBoundarySaved] = useState(false)

  // Local editable field only takes the fetched value once it actually
  // arrives — otherwise it'd stomp whatever Noah's mid-typing the moment the
  // fetch resolves.
  useEffect(() => {
    if (!appSettingsLoading) setToastSeconds(String(Math.round(appSettings.toastDurationMs / 1000)))
  }, [appSettingsLoading, appSettings.toastDurationMs])

  useEffect(() => {
    if (!appSettingsLoading) setBoundaryHour(String(appSettings.dayBoundaryHour))
  }, [appSettingsLoading, appSettings.dayBoundaryHour])

  async function saveToastDuration(): Promise<void> {
    const seconds = Number(toastSeconds)
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 120) return
    setToastSaving(true)
    setToastSaved(false)
    try {
      await fetch(`${BASE}/api/app-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toastDurationMs: Math.round(seconds * 1000) })
      })
      await refreshAppSettings()
      setToastSaved(true)
    } finally {
      setToastSaving(false)
    }
  }

  // Noah's ask: someone whose stream runs late (e.g. 10am-8pm) can move the
  // "today" reset point to something like 9pm instead of the default 6am
  // splitting a still-live stream into two days. Feeds getTodayStats, the
  // Dashboard's Today toggle, !mystats, and !top10today — one setting, every
  // consumer picks it up live (all read fresh from appSettingsStore per
  // request, nothing caches the old value).
  async function saveDayBoundaryHour(): Promise<void> {
    const hour = Number(boundaryHour)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return
    setBoundarySaving(true)
    setBoundarySaved(false)
    try {
      await fetch(`${BASE}/api/app-settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayBoundaryHour: hour })
      })
      await refreshAppSettings()
      setBoundarySaved(true)
    } finally {
      setBoundarySaving(false)
    }
  }

  // Noah's ask: "lots of streamers don't do BRs but some do" — saves
  // immediately on toggle rather than needing a separate Save button, same
  // as the Auto-post checkbox below (a boolean doesn't need a staged "are
  // you sure" step the way a typed number/hour does).
  async function toggleShowBrHs(checked: boolean): Promise<void> {
    await fetch(`${BASE}/api/app-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showBrHs: checked })
    })
    await refreshAppSettings()
  }

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

  // Same pattern, for the optional bot account's own OAuth round-trip.
  useEffect(() => {
    if (!botConnecting) return
    const timer = setInterval(() => {
      void refresh().then(() => {
        if (status?.botConnected) setBotConnecting(false)
      })
    }, 2000)
    return () => clearInterval(timer)
  }, [botConnecting, refresh, status?.botConnected])

  async function saveCredentials(): Promise<void> {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`${BASE}/api/twitch/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? `Save failed (HTTP ${res.status})`)
      }
      await refresh()
    } catch (err) {
      // A save that silently does nothing is worse than an ugly error message
      // — that's exactly the shape of bug this replaces (see server.ts's CORS
      // preflight fix): the fetch used to fail with zero visible feedback.
      setSaveError(err instanceof Error ? err.message : String(err))
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

  async function connectBot(): Promise<void> {
    setBotConnecting(true)
    await fetch(`${BASE}/api/twitch/bot-connect`, { method: 'POST' })
  }

  async function disconnectBot(): Promise<void> {
    await fetch(`${BASE}/api/twitch/bot-disconnect`, { method: 'POST' })
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

  // Noah's ask: a separate toggle from the one above — posts !lastmap's
  // info automatically after every race instead of needing someone to type
  // the command.
  async function toggleAutoPostLastMap(enabled: boolean): Promise<void> {
    await fetch(`${BASE}/api/twitch/auto-post-lastmap`, {
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

  // Sends the real formatted message for whatever race/tilt/royale was most
  // recently captured — same wording a real auto-post would use — so Noah
  // can judge how it actually reads in chat without waiting for a fresh
  // race. Deliberately separate from the auto-post bookkeeping server-side.
  async function sendPreviewPost(): Promise<void> {
    setPreviewing(true)
    setPreviewResult(null)
    try {
      const res = await fetch(`${BASE}/api/twitch/preview-post`, { method: 'POST' })
      setPreviewResult((await res.json()) as PreviewPostResult)
    } finally {
      setPreviewing(false)
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
          <div>
            <div className="settings__connected">
              <span className="settings__connected-dot" />
              Connected as <strong>{status.login}</strong>
              <button type="button" className="settings__btn settings__btn--ghost" onClick={() => void disconnect()}>
                Disconnect
              </button>
            </div>
            {!status.chatCommandsActive && (
              <p className="settings__hint">
                Chat commands aren&apos;t active on this connection yet — this usually means it was made before
                chat commands existed. Click <strong>Disconnect</strong>, then reconnect and re-authorize once
                more to grant the added permission.
              </p>
            )}
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
            {saveError && (
              <p className="settings__test-result settings__test-result--fail">✗ {saveError}</p>
            )}
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
        <h2 className="settings__card-title">Bot account (optional)</h2>
        {!status?.connected ? (
          <p className="settings__hint">Connect Twitch above first.</p>
        ) : status.botConnected ? (
          <div>
            <div className="settings__connected">
              <span className="settings__connected-dot" />
              Posting as <strong>{status.botLogin}</strong> instead of {status.login}
              <button
                type="button"
                className="settings__btn settings__btn--ghost"
                onClick={() => void disconnectBot()}
              >
                Disconnect bot
              </button>
            </div>
            <p className="settings__hint">
              Make sure <span className="settings__mono">{status.botLogin}</span> is modded in your own chat (
              <span className="settings__mono">/mod {status.botLogin}</span>) — Twitch requires that for it to
              post here at all. If sends start failing, that&apos;s the first thing to check.
            </p>
          </div>
        ) : (
          <>
            <p className="settings__hint">
              By default, everything posts as <strong>{status.login}</strong>. Connecting a separate account here
              makes it post everything instead — race results, command replies, test/preview posts. Reuses the
              same Client ID/Secret above; you&apos;ll just log into Twitch as the bot account instead of your
              own during the next step.
            </p>
            <div className="settings__actions">
              <button
                type="button"
                className="settings__btn settings__btn--accent"
                disabled={botConnecting}
                onClick={() => void connectBot()}
              >
                {botConnecting ? 'Waiting for you to authorize…' : 'Connect Bot Account'}
              </button>
            </div>
            {botConnecting && (
              <p className="settings__hint">
                A browser tab should have opened to Twitch&apos;s own site — log in as the <em>bot&apos;s</em>{' '}
                account there, not your own, then Authorize.
              </p>
            )}
            <p className="settings__hint">
              After connecting, go to your own Twitch chat and type <span className="settings__mono">/mod</span>{' '}
              followed by the bot&apos;s username — Twitch requires the bot to be a moderator in your channel to
              post there as a separate account. This is a normal Twitch chat command, not something MarbleGrid
              can do for you.
            </p>
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
              <button
                type="button"
                className="settings__btn"
                disabled={previewing}
                onClick={() => void sendPreviewPost()}
              >
                {previewing ? 'Sending…' : 'Preview last result in chat'}
              </button>
            </div>
            {testResult && (
              <p className={`settings__test-result ${testResult.success ? 'settings__test-result--ok' : 'settings__test-result--fail'}`}>
                {testResult.success ? '✓ Sent — check your chat.' : `✗ ${testResult.error ?? 'Failed to send.'}`}
              </p>
            )}
            {previewResult && (
              <p className={`settings__test-result ${previewResult.success ? 'settings__test-result--ok' : 'settings__test-result--fail'}`}>
                {previewResult.success
                  ? `✓ Sent: "${previewResult.message}"`
                  : `✗ ${previewResult.error ?? 'Failed to send.'}`}
              </p>
            )}
            <p className="settings__hint">
              &quot;Preview last result&quot; re-sends whatever race/tilt/royale was most recently captured, using
              the exact wording a real auto-post would use — handy for checking formatting without waiting for a
              fresh race. It does not affect auto-post&apos;s own record of what has already been announced.
            </p>

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

            <label className="settings__toggle">
              <input
                type="checkbox"
                checked={status.autoPostLastMapEnabled}
                onChange={(e) => void toggleAutoPostLastMap(e.target.checked)}
              />
              <span>Auto-post last map info after each race</span>
            </label>
            <p className="settings__hint">
              Posts the same info as <span className="settings__mono">!lastmap</span> (death rate, avg finish
              time, Ghost Ball record) automatically once each race lands — nobody needs to type the command.
              Separate from the toggle above, so you can run either one on its own. Defaults off.
            </p>
          </>
        )}
      </section>

      <section className="settings__card">
        <h2 className="settings__card-title">Chat commands</h2>
        {!status?.connected ? (
          <p className="settings__hint">Connect Twitch above first.</p>
        ) : (
          <>
            <p className="settings__hint">
              {status.chatCommandsActive
                ? 'Active — any viewer can use these in chat:'
                : 'Not active on this connection yet (see the note above) — once reconnected, viewers can use:'}
            </p>
            <ul className="settings__commands">
              <li>
                <span className="settings__mono">!mystats</span>, <span className="settings__mono">!mymarble</span>, or{' '}
                <span className="settings__mono">!myballs</span> — today&apos;s points/races/wins plus season
                points, season races, season wins, and points-per-race (PPR)
              </li>
              <li>
                <span className="settings__mono">!mywins</span> — wins this season
              </li>
              <li>
                Add <span className="settings__mono">@username</span> to either one (e.g.{' '}
                <span className="settings__mono">!mystats @schoklad</span>) to look up someone else instead of
                yourself
              </li>
              <li>
                <span className="settings__mono">!top10today</span> — today&apos;s top 10
              </li>
              <li>
                <span className="settings__mono">!top10season</span> — this season&apos;s top 10
              </li>
              <li>
                <span className="settings__mono">!racehs</span> — the season&apos;s highest single-race score, who
                holds it, and which map
              </li>
              <li>
                <span className="settings__mono">!ghostballs &lt;map&gt;</span> — that map&apos;s best time and
                who holds it
              </li>
              <li>
                <span className="settings__mono">!lastmap</span> — the last map played, death rate, avg finish
                time, and its Ghost Ball record
              </li>
              <li>
                <span className="settings__mono">!notes &lt;map&gt;</span> — posts whatever note you&apos;ve saved
                for that map (Maps → Notes)
              </li>
            </ul>
          </>
        )}
      </section>

      <section className="settings__card">
        <h2 className="settings__card-title">Overlay</h2>
        <div className="settings__field">
          <label htmlFor="toast-duration">Result toast on-screen time (seconds)</label>
          <input
            id="toast-duration"
            type="number"
            min={1}
            max={120}
            value={toastSeconds}
            onChange={(e) => {
              setToastSeconds(e.target.value)
              setToastSaved(false)
            }}
          />
        </div>
        <button type="button" className="settings__btn" onClick={() => void saveToastDuration()} disabled={toastSaving}>
          {toastSaving ? 'Saving…' : 'Save'}
        </button>
        {toastSaved && <p className="settings__hint">Saved — takes effect next time the overlay page loads.</p>}
        <p className="settings__hint">
          How long the race/Tilted/Royale result pop-in stays on screen in OBS before it hides again. 1–120 seconds.
        </p>
      </section>

      <section className="settings__card">
        <h2 className="settings__card-title">Stats</h2>
        <div className="settings__field">
          <label htmlFor="day-boundary">&quot;Today&quot; resets at</label>
          <select
            id="day-boundary"
            value={boundaryHour}
            onChange={(e) => {
              setBoundaryHour(e.target.value)
              setBoundarySaved(false)
            }}
          >
            {HOUR_OPTIONS.map((hour) => (
              <option key={hour} value={hour}>
                {formatHourLabel(hour)}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="settings__btn" onClick={() => void saveDayBoundaryHour()} disabled={boundarySaving}>
          {boundarySaving ? 'Saving…' : 'Save'}
        </button>
        {boundarySaved && <p className="settings__hint">Saved — Dashboard, chat commands, and the daily-stats overlay all switch over immediately.</p>}
        <p className="settings__hint">
          Controls where &quot;Today&quot; splits from &quot;yesterday&quot; — matters if your stream runs past
          midnight or you just prefer a different cutoff (e.g. 9 PM if you typically stream 10am–8pm). Default is
          6:00 AM.
        </p>

        <label className="settings__toggle">
          <input
            type="checkbox"
            checked={appSettings.showBrHs}
            onChange={(e) => void toggleShowBrHs(e.target.checked)}
          />
          <span>Show Battle Royale high score</span>
        </label>
        <p className="settings__hint">
          Hides the BR HS tile on the Dashboard and the Daily Stats overlay — handy if you don&apos;t run Battle
          Royale mode and don&apos;t want an always-zero stat taking up space. On by default.
        </p>
      </section>
    </div>
  )
}

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour)

function formatHourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM'
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12
  return `${twelveHour}:00 ${period}`
}
