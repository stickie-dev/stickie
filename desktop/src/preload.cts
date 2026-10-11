// What the page may ask of the app it runs in. The same page also runs in a
// plain browser tab, where none of this exists, so everything the client does
// with it starts by asking whether `window.stickieDesktop` is there.
//
// CommonJS, because a sandboxed preload is not an ES module.
import electron = require('electron')

const { contextBridge, ipcRenderer } = electron

type CloseBehaviour = 'keep' | 'quit'

contextBridge.exposeInMainWorld('stickieDesktop', {
  /** the app's version, its platform, and whether it is the one serving */
  about: (): Promise<{
    version: string
    platform: string
    serving: boolean
    url: string
  }> => ipcRenderer.invoke('stickie:about'),
  closeBehaviour: (): Promise<CloseBehaviour | null> =>
    ipcRenderer.invoke('stickie:close-behaviour'),
  setCloseBehaviour: (value: CloseBehaviour): Promise<void> =>
    ipcRenderer.invoke('stickie:set-close-behaviour', value),
  /** the title bar's own buttons, coloured to match the theme */
  setTitleBarColors: (colors: { color: string; symbolColor: string }): void => {
    ipcRenderer.send('stickie:title-bar', colors)
  },
  openInBrowser: (): void => {
    ipcRenderer.send('stickie:open-in-browser')
  },
  /** quits and starts again, for a setting that only applies at start */
  relaunch: (): void => {
    ipcRenderer.send('stickie:relaunch')
  },
  /** commands from the app's own menu that the page carries out */
  onCommand: (listener: (command: string) => void): (() => void) => {
    const handler = (_event: unknown, command: string) => listener(command)
    ipcRenderer.on('stickie:command', handler)
    return () => ipcRenderer.removeListener('stickie:command', handler)
  },
})
