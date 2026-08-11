import { join } from 'path'

// %LOCALAPPDATA% resolves per Windows user account automatically — never
// hardcode a specific username here, so this stays portable to any streamer
// running MarbleGrid on their own PC, not just noonspins.
export const MARBLES_SAVE_DIR = join(
  process.env.LOCALAPPDATA ?? '',
  'MarblesOnStream',
  'Saved',
  'SaveGames'
)

export const SESSIONS_DIR = join(MARBLES_SAVE_DIR, 'Sessions')
