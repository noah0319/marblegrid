# MarbleGrid — 04 System

Real running code for MarbleGrid. See the project's [[KJ OS Template/03 Projects/MarbleGrid/CLAUDE.md|CLAUDE.md]] and [[KJ OS Template/03 Projects/MarbleGrid/01 Architecture & Design/(C) implementation-plan.md|implementation plan]] for the full design.

## First-time setup

1. Install [Node.js](https://nodejs.org) if not already installed (this machine has v24.18.0).
2. From this folder: `npm install` (also rebuilds the native `better-sqlite3` module for Electron automatically via `postinstall`).
3. `npm run dev` to launch the app in development mode.
4. Once built, double-click **`(C) Start MarbleGrid.bat`** any time to launch it normally.

## Twitch connection (one-time)

See `../02 Twitch Integration/` for the walkthrough — you'll register a free app at dev.twitch.tv, paste two values into MarbleGrid's Settings screen, and click "Connect Twitch Account." No password is ever typed into MarbleGrid itself.

## Notes

- The app needs to be running for your **whole stream** — it watches files the game overwrites on every race, so if MarbleGrid isn't running when a race finishes, that race's data is gone for good. It lives in the system tray and keeps running even if you close its window; use the tray icon to actually quit it.
- "Auto-post race results" to chat defaults to **off** in Settings until you've verified it with a few test posts.
- Live data: `data/marblegrid.db` (SQLite, gitignored, machine-specific — don't commit or share this file, it's your race history).
