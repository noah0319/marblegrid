// Shared "a real quit is actually happening" flag.
//
// index.ts's main window intercepts the close button (X) and hides instead
// of closing — the watcher/db/chat-poster live in this process and must
// keep running even with no window open (see CLAUDE.md: a race that lands
// while nothing's watching is lost for good). That interception needs to
// tell "user clicked X" apart from "the app is genuinely quitting" — the
// tray's "Quit MarbleGrid" sets this before calling app.quit().
//
// Pulled into its own module (not just a local variable in index.ts)
// because electron-updater's quitAndInstall() ALSO needs to set this
// before it runs — confirmed via a real report (2026-08-16): someone force-
// closed MarbleGrid via Task Manager after an update had downloaded, then
// reopened it and was still on the old version. Root cause: they never
// went through app.quit() at all, so autoInstallOnAppQuit's hook never
// fired — Task Manager's "End Task" on a backgrounded/tray app skips the
// graceful WM_CLOSE sequence entirely once there's no visible top-level
// window left to send it to. A right-click-tray-icon "Quit" would have
// worked, but expecting a non-technical user to find that is not reliable
// — see updater.ts's installUpdateNow(), which gives them a direct button
// instead. electron-updater's own docs confirm quitAndInstall() closes
// windows BEFORE emitting 'before-quit' (opposite order from a normal
// app.quit()), so this flag has to be set proactively before calling it,
// not reactively inside a 'before-quit' handler — that would fire too late
// here specifically.
let quitting = false

export function markQuitting(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}
