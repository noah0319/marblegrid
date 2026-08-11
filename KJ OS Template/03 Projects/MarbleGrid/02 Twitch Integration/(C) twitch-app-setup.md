---
status: not yet started — needed before Phase 5
---

# Twitch App Setup (Noah's one-time steps)

MarbleGrid needs a Twitch "app" registered to Noah's account before it can post race results to chat in Phase 5. This only has to be done once. **Never put the Client Secret or any token in this vault or in Git** — they go into MarbleGrid's Settings screen only, which stores them locally via `electron-store` in Electron's own app-data folder.

## Steps

1. Go to [dev.twitch.tv/console/apps](https://dev.twitch.tv/console/apps) and log in with your normal noonspins Twitch account.
2. Click **Register Your Application**.
   - **Name:** something like "MarbleGrid" (must be unique across all of Twitch's registered apps — if it's taken, try a variant).
   - **OAuth Redirect URL:** `http://localhost:43117/oauth/callback` — must match exactly what MarbleGrid's Twitch-connect flow requests, so use this exact value.
   - **Category:** Application Integration.
3. Click **Manage** on the new app.
   - Copy the **Client ID**.
   - Click **New Secret** to generate the **Client Secret** — Twitch only shows this once, so copy it somewhere safe immediately (a password manager, not a plain text file).
4. Open MarbleGrid → Settings → paste the Client ID and Client Secret.
5. Click **Connect Twitch Account**. This opens your normal browser to Twitch's own authorization page — not MarbleGrid — pre-filled with exactly one permission request: `user:write:chat` (send chat messages). You click **Authorize** on Twitch's real site. You never type your Twitch password into MarbleGrid itself.
6. MarbleGrid finishes the connection automatically and should show "Connected as noonspins." After this, the connection refreshes itself forever — no manual token upkeep.

## Why the permission ask is minimal

`user:write:chat` is the only scope requested. MarbleGrid never reads your chat — the game itself already handles `!play`/`!vote`/etc. — it only ever sends one message per completed race, via Twitch's Helix "Send Chat Message" API. Since Noah is both the token owner and the broadcaster posting into his own channel, no extra `bot`-related scopes are needed.

## Before relying on this for real

- Use the **Test post** button in Settings to confirm the connection sends correctly, without waiting for a real race.
- The **"Auto-post race results"** toggle defaults to **off**. Turn it on only after test posts look right and you've watched Phase 3/4 data track correctly for a bit — ideally verify on a low-stakes stream, not a big event night.
