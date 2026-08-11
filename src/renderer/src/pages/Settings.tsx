export default function Settings(): React.JSX.Element {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 28 }}>Settings</h1>
      <div
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-hairline)',
          borderRadius: 'var(--radius-lg)',
          padding: 24,
          color: 'var(--text-secondary)',
          maxWidth: 520,
          lineHeight: 1.5
        }}
      >
        <p style={{ marginTop: 0 }}>
          Twitch connection and auto-post controls are coming in a later phase — this app
          doesn&apos;t post to chat yet, by design, until the data pipeline and stats have
          been proven correct on a real stream first.
        </p>
        <p style={{ marginBottom: 0 }}>
          Day-boundary hour for &quot;Today&quot; stats: <strong>6:00 AM</strong> (fixed for
          now — becomes adjustable here once this settings screen is wired to real
          persistence).
        </p>
      </div>
    </div>
  )
}
