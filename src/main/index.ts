import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { startServer } from './backend/server'
import { SERVER_PORT } from '../shared/constants'

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

// Do NOT quit when every window is closed — the backend (watcher, db, chat
// poster) needs to keep running for the whole stream regardless of whether
// the companion window is open. This is the single most important lifecycle
// decision in the app; see the implementation plan's Architecture section.
app.on('window-all-closed', () => {})

app.whenReady().then(async () => {
  await startServer(SERVER_PORT)
  createWindow()
  createTray()
})
