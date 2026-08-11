import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import { join } from 'path'
import { startServer } from './backend/server.ts'
import { initDb } from './backend/db/db.ts'
import { startWatcher } from './backend/watcher/fileWatcher.ts'
import { reconcileSeasonsAtStartup } from './backend/watcher/seasonDetector.ts'
import { initSettingsStore } from './backend/twitch/settingsStore.ts'
import { SERVER_PORT } from '../shared/constants.ts'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0f',
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
  // TODO(Phase 3): swap for a real icon asset once visual design lands.
  tray = new Tray(nativeImage.createEmpty())
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
