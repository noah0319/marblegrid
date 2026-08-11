// Local-only — the backend never binds beyond 127.0.0.1, so a fixed port is fine.
export const SERVER_PORT = 43117

// Placeholder until Phase 3 adds a real Settings UI to override this per
// electron-store — see 01 Architecture & Design's "Per day" stats note.
export const DEFAULT_DAY_BOUNDARY_HOUR = 6
