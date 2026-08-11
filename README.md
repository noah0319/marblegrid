# MarbleGrid — 04 System

Real running code for MarbleGrid. See the project's [[KJ OS Template/03 Projects/MarbleGrid/CLAUDE.md|CLAUDE.md]] and [[KJ OS Template/03 Projects/MarbleGrid/01 Architecture & Design/(C) implementation-plan.md|implementation plan]] for the full design.

Nothing here is Noah/noonspins-specific — every path and identifier is resolved from the current Windows user and this machine's own local app-data at runtime (confirmed 2026-08-11 with a full source-tree check), so this same code runs correctly for anyone with their own copy: their own map times, their own leaderboard, their own Twitch connection.

## Running from a packaged install (recommended for most people)

If you received a `MarbleGrid Setup x.x.x.exe`, just run it — no Node.js, no terminal. It installs to your user profile (no admin rights needed), adds a Start Menu + Desktop shortcut, and MarbleGrid launches from there like any other app. Skip straight to **Twitch connection** below.

## Running from source (for development)

1. Install [Node.js](https://nodejs.org) if not already installed (this machine has v24.18.0).
2. From this folder: `npm install`.
3. `npm run dev` to launch the app in development mode.
4. Once built, double-click **`(C) Start MarbleGrid.bat`** any time to launch it normally.
5. `npm run dist` builds a real distributable installer (`dist/MarbleGrid Setup x.x.x.exe`) via `electron-builder` — this is what to hand someone else, not the raw source folder.

## Twitch connection (one-time)

See `../02 Twitch Integration/` for the walkthrough — you'll register a free app at dev.twitch.tv, paste two values into MarbleGrid's Settings screen, and click "Connect Twitch Account." No password is ever typed into MarbleGrid itself. Each person running their own copy needs their own Twitch app registration — you can't share Noah's Client ID/Secret with someone else's Twitch account.

## Notes

- The app needs to be running for your **whole stream** — it watches files the game overwrites on every race, so if MarbleGrid isn't running when a race finishes, that race's data is gone for good. It lives in the system tray and keeps running even if you close its window; use the tray icon to actually quit it.
- "Auto-post race results" to chat defaults to **off** in Settings until you've verified it with a few test posts.
- Live data lives in Electron's own per-user app-data folder (`%APPDATA%\marblegrid\`), not inside this project folder — machine-specific, never committed, and every install's data is completely separate from every other install's.
