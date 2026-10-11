import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  Tray,
} from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { readPreferences, writePreferences } from './preferences.js'
import { adoptShellPath } from './shellPath.js'

/**
 * stickie as an app of its own: a window, a menu and a menu-bar icon around the
 * same server `stickie` runs from a terminal.
 *
 * The server runs inside the app, on the usual port, so a browser tab and an
 * agent's MCP bridge reach it exactly as they always have — the window is one
 * more client of it, not a different stickie. If a stickie is already serving that
 * port (one started from a terminal), the app uses it rather than starting a
 * second server over the same database, and closing the window then just
 * closes the window.
 *
 * Its own window rather than a browser's installed web app: no address-bar
 * remnants and no browser buttons in the title bar, the page's own top bar
 * sits in the title bar beside the window controls, and closing it can leave
 * the server running for the agents that use it.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
// desktop/dist, in the repository and in the packaged app alike; the server
// and the client sit beside desktop/ either way
const root = path.resolve(here, '../..')
const assets = path.join(root, 'desktop', 'assets')

// the server's own reading of the port, so the app, `stickie` and the MCP bridge
// cannot disagree about it: STICKIE_PORT, else what Settings stored, else 4870
const config = (await import(
  pathToFileURL(path.join(root, 'server', 'dist', 'config.js')).href
)) as {
  configuredPort: () => number
  configuredDevPort: () => number
  setPort: (port: number | null) => void
}

let port = config.configuredPort()
let origin = `http://localhost:${String(port)}`
const mac = process.platform === 'darwin'

/**
 * `--dev`, or `--dev=<url>`: working on stickie itself. The window shows Vite's
 * dev server (`pnpm dev`) instead of the page the server serves, so a change
 * to the client is in the app the moment it is saved, and the server is the
 * dev server Vite proxies to — the app starts no server of its own, or it
 * would take the port `pnpm dev` needs. Vite's port is STICKIE_DEV_PORT, else
 * `devPort` in ~/.stickie/config.json, else 5173; STICKIE_DEV_URL names the whole
 * address instead.
 */
const dev_flag = process.argv.find(
  (arg) => arg === '--dev' || arg.startsWith('--dev='),
)
const dev_url =
  dev_flag === undefined
    ? null
    : dev_flag === '--dev'
      ? (process.env.STICKIE_DEV_URL ??
        `http://localhost:${String(config.configuredDevPort())}`)
      : dev_flag.slice('--dev='.length).replace(/\/$/, '')

/** What the window shows. */
const page = () => dev_url ?? origin

/** Whether an address is stickie's own page, served or from Vite. */
function ours(url: string): boolean {
  return url.startsWith(origin) || (dev_url !== null && url.startsWith(dev_url))
}

let window: BrowserWindow | null = null
let tray: Tray | null = null
/** the server this app started; null when it is using one already running */
let server: { close: () => Promise<void> } | null = null
let quitting = false

/** The title bar's resting colours, until the page says which theme it is in. */
function titleBarColors(): { color: string; symbolColor: string } {
  return nativeTheme.shouldUseDarkColors
    ? { color: '#101012', symbolColor: '#e8e8ea' }
    : { color: '#f7f7f6', symbolColor: '#2a2a2e' }
}

/** Whether a stickie is already answering on the port. */
async function runningStickie(): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/api/settings`, {
      signal: AbortSignal.timeout(800),
    })
    if (!response.ok) return false
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'mcpCommand' in body
  } catch {
    return false
  }
}

/** Whether nothing is listening on a port, so a server could have it. */
function free(candidate: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(candidate, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/** The nearest free port above the one that is taken, if any is close. */
async function nearestFree(after: number): Promise<number | null> {
  for (let candidate = after + 1; candidate <= after + 50; candidate += 1) {
    if (await free(candidate)) return candidate
  }
  return null
}

/**
 * The port is held by something that is not stickie. Rather than only saying so,
 * offer the nearest free one — kept in Settings, so `stickie`, the MCP bridge and
 * the next start all follow — or quit.
 */
async function offerAnotherPort(error: unknown): Promise<boolean> {
  const instead = await nearestFree(port)
  const reason = error instanceof Error ? error.message : String(error)
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    message: `Port ${String(port)} is taken by another program`,
    detail:
      instead === null
        ? `${reason}\n\nNo free port is close by. ` +
          'Free the port, or set one with STICKIE_PORT.'
        : `${reason}\n\nstickie can use port ${String(instead)} instead, ` +
          'from now on — the command line and agents follow it, and it can ' +
          'be changed in Settings → App.',
    buttons: instead === null ? ['Quit'] : [`Use ${String(instead)}`, 'Quit'],
    defaultId: 0,
    cancelId: instead === null ? 0 : 1,
  })
  if (instead === null || response !== 0) return false
  config.setPort(instead)
  port = instead
  origin = `http://localhost:${String(port)}`
  return true
}

async function startOwnServer(): Promise<void> {
  const entry = pathToFileURL(path.join(root, 'server', 'dist', 'serve.js')).href
  const { startServer } = (await import(entry)) as {
    startServer: (options: { port: number }) => Promise<{ close: () => Promise<void> }>
  }
  server = await startServer({ port })
}

function fromOurPage(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url
  return url !== undefined && ours(url)
}

function createWindow(): BrowserWindow {
  const preferences = readPreferences()
  const colors = titleBarColors()
  const created = new BrowserWindow({
    width: preferences.bounds?.width ?? 1440,
    height: preferences.bounds?.height ?? 900,
    ...(preferences.bounds === undefined
      ? {}
      : { x: preferences.bounds.x, y: preferences.bounds.y }),
    minWidth: 760,
    minHeight: 480,
    title: 'stickie',
    show: false,
    backgroundColor: colors.color,
    // the page's top bar is the title bar: the window controls sit over its
    // edge, and the page leaves room for them (index.css, window controls)
    titleBarStyle: 'hidden',
    ...(mac ? { trafficLightPosition: { x: 14, y: 15 } } : {}),
    titleBarOverlay: mac ? true : { ...colors, height: 40 },
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  })
  if (preferences.maximized === true) created.maximize()
  created.once('ready-to-show', () => created.show())

  // anything that is not stickie opens where links open, not in this window
  created.webContents.setWindowOpenHandler(({ url }) => {
    if (!ours(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  created.webContents.on('will-navigate', (event, url) => {
    if (ours(url)) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  created.on('close', (event) => {
    writePreferences({
      bounds: created.getNormalBounds(),
      maximized: created.isMaximized(),
    })
    // using someone else's server, or on the way out: closing is closing
    if (quitting || server === null) return
    event.preventDefault()
    void closeWhileServing(created)
  })
  created.on('closed', () => {
    if (window === created) window = null
  })

  // Vite may still be starting, or not started yet: keep knocking rather than
  // leaving a blank window that has to be reopened
  if (dev_url !== null) {
    created.webContents.on('did-fail-load', (_event, _code, _description, url) => {
      if (!url.startsWith(dev_url)) return
      created.setTitle(`stickie — waiting for ${dev_url} (pnpm dev)`)
      setTimeout(() => {
        if (!created.isDestroyed()) void created.loadURL(page())
      }, 1000)
    })
  }
  void created.loadURL(page())
  return created
}

/**
 * The window is closing and this app is the server. Whether that stops the
 * server is the reader's to say: asked the first time, remembered after, and
 * changeable in Settings → App.
 */
async function closeWhileServing(closing: BrowserWindow): Promise<void> {
  let choice = readPreferences().onClose
  if (choice === undefined) {
    const { response } = await dialog.showMessageBox(closing, {
      type: 'question',
      message: 'Keep stickie running when its window is closed?',
      detail:
        'Agents and browser tabs reach stickie through its server, and the ' +
        'server runs in this app. Kept running, it waits in the menu bar; ' +
        'quit, they lose it until stickie is opened again.\n\n' +
        'You can change this in Settings → App.',
      buttons: ['Keep running', 'Quit stickie'],
      defaultId: 0,
      cancelId: 0,
    })
    choice = response === 0 ? 'keep' : 'quit'
    writePreferences({ onClose: choice })
  }
  if (choice === 'quit') {
    quitting = true
    // not from inside the close it is answering: a quit asked for while that
    // close is still being cancelled is dropped, and the app stays up with no
    // window and its server running
    setTimeout(() => app.quit(), 0)
    return
  }
  closing.hide()
  ensureTray()
  // a menu-bar app while it has no window: no Dock icon sitting there
  if (mac) app.dock?.hide()
}

function showWindow(): void {
  if (window === null || window.isDestroyed()) window = createWindow()
  else window.show()
  window.focus()
  if (mac) void app.dock?.show()
}

function ensureTray(): void {
  if (tray !== null) return
  const image = nativeImage.createFromPath(
    path.join(assets, mac ? 'trayTemplate.png' : 'tray.png'),
  )
  if (mac) image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip(`stickie — serving ${origin}`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open stickie', click: showWindow },
      { label: 'Open in Browser', click: () => void shell.openExternal(origin) },
      { type: 'separator' },
      { label: `Serving ${origin.replace('http://', '')}`, enabled: false },
      { type: 'separator' },
      { label: 'Quit stickie', click: () => app.quit() },
    ]),
  )
  // on Windows and Linux the icon is clicked, not opened as a menu
  tray.on('click', () => {
    if (!mac) showWindow()
  })
}

/** A command from the menu for the page to carry out, opening it if needed. */
function command(name: string): void {
  showWindow()
  window?.webContents.send('stickie:command', name)
}

function buildMenu(): Menu {
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: 'stickie',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: () => command('settings'),
              },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open in Browser',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => void shell.openExternal(origin),
        },
        ...(mac
          ? []
          : [
              {
                label: 'Settings',
                accelerator: 'Ctrl+,',
                click: () => command('settings'),
              },
            ]),
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // copy and paste in a text field go through this menu on macOS; without
    // it ⌘C does nothing in a note being written
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]
  return Menu.buildFromTemplate(template)
}

function listen(): void {
  ipcMain.handle('stickie:about', (event) => {
    if (!fromOurPage(event)) return null
    return {
      version: app.getVersion(),
      platform: process.platform,
      serving: server !== null,
      url: origin,
    }
  })
  ipcMain.handle('stickie:close-behaviour', (event) =>
    fromOurPage(event) ? (readPreferences().onClose ?? null) : null,
  )
  ipcMain.handle('stickie:set-close-behaviour', (event, value: unknown) => {
    if (!fromOurPage(event)) return
    if (value === 'keep' || value === 'quit') writePreferences({ onClose: value })
  })
  ipcMain.on('stickie:title-bar', (event, colors: unknown) => {
    if (!fromOurPage(event) || mac || window === null) return
    const { color, symbolColor } = (colors ?? {}) as Record<string, unknown>
    if (typeof color === 'string' && typeof symbolColor === 'string') {
      window.setTitleBarOverlay({ color, symbolColor })
      window.setBackgroundColor(color)
    }
  })
  // a new port only takes effect on a new start; the app can do that itself
  ipcMain.on('stickie:relaunch', (event) => {
    if (!fromOurPage(event)) return
    app.relaunch()
    quitting = true
    app.quit()
  })
  ipcMain.on('stickie:open-in-browser', (event) => {
    if (fromOurPage(event)) void shell.openExternal(origin)
  })
}

async function start(): Promise<void> {
  adoptShellPath()
  if (dev_url === null && !(await runningStickie())) {
    for (;;) {
      try {
        await startOwnServer()
        break
      } catch (error) {
        const taken =
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
        if (taken && (await offerAnotherPort(error))) continue
        if (!taken) {
          dialog.showErrorBox(
            'stickie could not start',
            error instanceof Error ? error.message : String(error),
          )
        }
        quitting = true
        app.quit()
        return
      }
    }
  }
  listen()
  Menu.setApplicationMenu(buildMenu())
  window = createWindow()
}

// a separate profile, for running a second copy beside the real one (testing,
// or a scratch database on another port)
if (process.env.STICKIE_USER_DATA !== undefined) {
  app.setPath('userData', process.env.STICKIE_USER_DATA)
}

if (!app.requestSingleInstanceLock()) {
  // a second launch brings the first one forward instead
  app.quit()
} else {
  app.setName('stickie')
  app.on('second-instance', showWindow)
  app.on('activate', showWindow)
  app.on('before-quit', () => {
    quitting = true
  })
  // nothing left to show and nothing being served: done
  app.on('window-all-closed', () => {
    if (server === null) app.quit()
  })
  // the server stops with the app, and the app waits for it — then exits
  // outright, since a quit asked for again could meet whatever held it up
  app.on('will-quit', (event) => {
    const running = server
    if (running === null) return
    event.preventDefault()
    server = null
    void running.close().finally(() => app.exit(0))
  })
  void app.whenReady().then(start)
}
