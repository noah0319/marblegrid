import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { startServer } from './backend/server.ts'
import { initDb } from './backend/db/db.ts'
import { startWatcher } from './backend/watcher/fileWatcher.ts'
import { reconcileSeasonsAtStartup } from './backend/watcher/seasonDetector.ts'
import { initSettingsStore } from './backend/twitch/settingsStore.ts'
import { initAppSettingsStore } from './backend/appSettingsStore.ts'
import { isConnected } from './backend/twitch/auth.ts'
import { startChatListener } from './backend/twitch/chatListener.ts'
import { SERVER_PORT } from '../shared/constants.ts'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

// build/icon.ico is the app's real logo (Noah's marble-in-a-grid render —
// see 06 Attachments/ for the source and tools/build-icon.mjs for how the
// multi-res .ico gets regenerated if it ever changes). app.getAppPath()
// resolves to the project root in dev; a packaged build (Phase 6) will need
// this revisited once electron-builder's asar/resources layout is in play.
const appIcon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.ico'))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // Clicking the window's close button hides it instead of destroying it —
  // the watcher/db/chat-poster all live in this process, and closing the
  // window must not stop them mid-stream (see CLAUDE.md: a race that lands
  // while nothing is watching is lost the instant the game overwrites the
  // file). Only the tray's "Quit MarbleGrid" really exits.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function createTray(): void {
  tray = new Tray(appIcon.resize({ width: 32, height: 32 }))
  tray.setToolTip('MarbleGrid')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show MarbleGrid', click: () => mainWindow?.show() },
      { type: 'separator' },
      {
        label: 'Quit MarbleGrid',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

// Single-instance lock: caught a real bug during Phase 4 testing where two
// launch attempts overlapped, the second silently failed to bind the port
// (no error surfaced anywhere — see below), and left zombie processes
// holding the port hostage for later launches too. Without this, a second
// double-click of the desktop shortcut mid-stream would be a confusing,
// hard-to-diagnose failure at exactly the worst time.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // Someone tried to launch a second copy — surface the existing window
    // instead of doing nothing (or worse, silently failing to start).
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // Do NOT quit when every window is closed — the backend (watcher, db, chat
  // poster) needs to keep running for the whole stream regardless of whether
  // the companion window is open.
  app.on('window-all-closed', () => {})

  app.whenReady().then(async () => {
    try {
      initDb(join(app.getPath('userData'), 'marblegrid.db'))
      initSettingsStore(join(app.getPath('userData'), 'twitch-settings.json'))
      initAppSettingsStore(join(app.getPath('userData'), 'app-settings.json'))
      // Resume chat commands across restarts if already connected from a
      // prior session — same "resume, don't require re-clicking Connect"
      // spirit as ensureProvider()'s lazy auth resumption. Wrapped so a
      // failure here (eg. Twitch/network hiccup) can't take down startup —
      // core race-tracking must not depend on chat commands working.
      if (isConnected()) startChatListener()
      reconcileSeasonsAtStartup()
      startWatcher()
      await startServer(SERVER_PORT)
      createWindow()
      createTray()
    } catch (err) {
      // A silent startup failure (this is exactly what happened before this
      // fix: a port conflict threw here, nothing caught it, and the app sat
      // running with zero windows and zero explanation) is worse than a
      // blunt error box — at least this is diagnosable.
      const message = err instanceof Error ? err.message : String(err)
      // eslint-disable-next-line no-console
      console.error('MarbleGrid failed to start:', err)
      dialog.showErrorBox(
        'MarbleGrid failed to start',
        `Something went wrong during startup:\n\n${message}\n\n` +
          'If this keeps happening, check Task Manager for a leftover "Electron" ' +
          'or "node" process from MarbleGrid and end it, then try again.'
      )
      app.quit()
    }
  })
}
