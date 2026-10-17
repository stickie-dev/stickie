// A small Chrome DevTools Protocol driver for the showcase captures: one page
// of the headless Chrome from start-chrome.sh (CDP_PORT, 9341 by default), driven like a
// person would — mouse, keyboard — with a drawn cursor so GIFs show where the
// pointer is, PNG shots at 2x, and screencast frames for GIFs.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const port = process.env.CDP_PORT ?? 9341
export const base = process.env.STICKIE_URL ?? 'http://localhost:4879'
export const W = Number(process.env.VW ?? 1440)
export const H = Number(process.env.VH ?? 900)

export async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  let page = targets.find((t) => t.type === 'page')
  if (!page) page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(JSON.stringify(msg.error)))
      else resolve(msg.result)
    } else if (msg.method && listeners.has(msg.method)) {
      for (const fn of listeners.get(msg.method)) fn(msg.params)
    }
  })
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, [])
    listeners.get(method).push(fn)
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false })
  return new Page(send, on, ws)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Page {
  constructor(send, on, ws) {
    this.send = send
    this.on = on
    this.ws = ws
    this.mouse = [W / 2, H / 2]
  }

  close() {
    this.ws.close()
  }

  async eval(js) {
    const res = await this.send('Runtime.evaluate', {
      expression: `(async()=>{${js}})()`,
      awaitPromise: true,
      returnByValue: true,
    })
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? 'eval failed')
    return res.result.value
  }

  /** light or dark, as stickie's own toggle stores it */
  async theme(name) {
    await this.go(base + '/')
    await this.eval(`localStorage.setItem('stickie-theme', ${JSON.stringify(name)})`)
  }

  async clearState() {
    await this.go(base + '/')
    await this.eval(`localStorage.clear(); sessionStorage.clear()`)
  }

  async go(url, settle = 1500) {
    await this.send('Page.navigate', { url })
    await sleep(settle)
    await this.cursor()
  }

  /** wait until `js` (an expression) is truthy */
  async until(js, timeout = 10000) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await this.eval(`return !!(${js})`)) return
      await sleep(100)
    }
    throw new Error(`timed out waiting for ${js}`)
  }

  /** centre of the first element matching a selector, or containing text */
  async where(target) {
    const js =
      typeof target === 'string'
        ? `document.querySelector(${JSON.stringify(target)})`
        : `[...document.querySelectorAll(${JSON.stringify(target.sel ?? '*')})].filter(e => e.children.length === 0 || ${target.any || target.sel ? 'true' : 'false'}).find(e => e.textContent.trim()${target.exact ? ' === ' : '.includes('}${JSON.stringify(target.text)}${target.exact ? '' : ')'} && e.getClientRects().length)`
    const at = await this.eval(
      `const e = ${js}; if (!e) return null; e.scrollIntoView({block: 'nearest'}); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]`,
    )
    if (at === null) throw new Error(`nothing at ${JSON.stringify(target)}`)
    return at
  }

  /** where line `n` of a file tab's diff editor sits: [left of code, centre y, right of gutter] */
  async line(n, side = 'modified') {
    const r = await this.eval(`
      const other = '${side}' === 'modified' ? 'original' : 'modified'; const ed = [...document.querySelectorAll('.monaco-editor')].find(e => !e.classList.contains(other + '-in-monaco-diff-editor') && [...e.querySelectorAll('.line-numbers')].some(x => x.textContent.trim() === '${n}')) ?? document.body
      const num = [...ed.querySelectorAll('.line-numbers')].find(e => e.textContent.trim() === '${n}')
      if (!num) return null
      const g = num.getBoundingClientRect()
      const lines = ed.querySelector('.lines-content').getBoundingClientRect()
      return [lines.left + 4, g.top + g.height / 2]`)
    if (r === null) throw new Error(`line ${n} is not on screen`)
    return r
  }

  /** scrolls with the wheel over `at` until line `n` is in the middle third of the screen */
  async scrollToLine(n, at = [1000, 500], side = 'modified') {
    await this.move(at, 6)
    for (let i = 0; i < 60; i += 1) {
      const y = await this.eval(`
        const other = '${side}' === 'modified' ? 'original' : 'modified'; const ed = [...document.querySelectorAll('.monaco-editor')].find(e => !e.classList.contains(other + '-in-monaco-diff-editor') && [...e.querySelectorAll('.line-numbers')].some(x => x.textContent.trim() === '${n}')) ?? document.body
        const num = [...ed.querySelectorAll('.line-numbers')].find(e => e.textContent.trim() === '${n}')
        return num ? num.getBoundingClientRect().top : null`)
      if (y !== null && y > 250 && y < 650) return
      const dy = y === null || y >= 650 ? 120 : -120
      await this.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: at[0], y: at[1], deltaX: 0, deltaY: dy })
      await sleep(60)
    }
    throw new Error(`could not bring line ${n} into view`)
  }

  /** selects line `n` (its first `chars` characters) the way a mouse would */
  async selectLine(n, chars = 40, side = 'modified') {
    const [x, y] = await this.line(n, side)
    await this.drag([x + 2, y], [x + chars * 8.4, y])
  }

  /** draws the pointer the page cannot see in headless Chrome */
  async cursor() {
    const [x, y] = this.mouse
    await this.eval(`
      let c = document.getElementById('__cursor')
      if (!c) {
        c = document.createElement('div'); c.id = '__cursor'
        c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8.5-6.2 1.3L7.9 18z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>'
        c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;left:0;top:0;transition:transform 0s'
        document.documentElement.appendChild(c)
      }
      c.style.transform = 'translate(${x - 3}px, ${y - 2}px)'
      c.style.display = window.__hideCursor ? 'none' : 'block'`)
  }

  /** a caption pill over the page, for GIFs: who is acting. null removes it */
  async caption(text) {
    await this.eval(`
      let c = document.getElementById('__caption')
      if (!c) {
        c = document.createElement('div'); c.id = '__caption'
        c.style.cssText = 'position:fixed;z-index:2147483646;left:50%;bottom:96px;transform:translateX(-50%);padding:9px 16px;border-radius:999px;background:rgba(17,17,20,.88);color:#fff;font:500 15px -apple-system,system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25);pointer-events:none;white-space:nowrap'
        document.documentElement.appendChild(c)
      }
      const text = ${JSON.stringify(text)}
      c.style.display = text === null ? 'none' : 'block'
      if (text !== null) c.innerHTML = text`)
  }

  async hideCursor(hidden = true) {
    await this.eval(`window.__hideCursor = ${hidden}`)
    await this.cursor()
  }

  /** glides the pointer, so a recording shows the move */
  async move(to, steps = 14, ms = 18) {
    const [x0, y0] = this.mouse
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      this.mouse = [x0 + (to[0] - x0) * e, y0 + (to[1] - y0) * e]
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: this.mouse[0], y: this.mouse[1] })
      await this.cursor()
      await sleep(ms)
    }
  }

  async click(target, { glide = true, count = 1, modifiers = 0 } = {}) {
    const at = Array.isArray(target) ? target : await this.where(target)
    if (glide) await this.move(at)
    else this.mouse = at
    for (let n = 1; n <= count; n += 1) {
      await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'left', clickCount: n, modifiers })
      await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'left', clickCount: n, modifiers })
    }
    await this.cursor()
    await sleep(250)
  }

  async drag(from, to, steps = 16) {
    await this.move(from)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: from[0], y: from[1], button: 'left', clickCount: 1 })
    for (let i = 1; i <= steps; i += 1) {
      this.mouse = [from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]
      await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: this.mouse[0], y: this.mouse[1], button: 'left', buttons: 1 })
      await this.cursor()
      await sleep(20)
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to[0], y: to[1], button: 'left', clickCount: 1 })
    await sleep(300)
  }

  /** types like a person, a character at a time */
  async type(text, ms = 28) {
    for (const ch of text) {
      await this.send('Input.insertText', { text: ch })
      await sleep(ms)
    }
  }

  async key(key, { code, modifiers = 0, vk } = {}) {
    const keyCode = vk ?? { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38 }[key] ?? key.toUpperCase().charCodeAt(0)
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: code ?? key, modifiers, windowsVirtualKeyCode: keyCode, ...(key === 'Enter' ? { text: '\r' } : {}) })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: code ?? key, modifiers, windowsVirtualKeyCode: keyCode })
    await sleep(150)
  }

  /** a PNG of the viewport, or of `clip` ({x, y, width, height} in CSS px) */
  async shot(file, clip) {
    const res = await this.send('Page.captureScreenshot', {
      format: 'png',
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    })
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(res.data, 'base64'))
    console.log('shot', file)
  }

  /** records frames while `fn` runs, then makes a GIF of them at `file` */
  async record(file, fn, { width = 1200, fps = 12, tail = 1500, frames: framesDir } = {}) {
    const dir = path.join(framesDir ?? path.dirname(file), path.basename(file, '.gif'))
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const frames = []
    this.on('Page.screencastFrame', async (p) => {
      const n = String(frames.length).padStart(5, '0')
      const f = path.resolve(dir, `${n}.png`)
      fs.writeFileSync(f, Buffer.from(p.data, 'base64'))
      frames.push({ f, t: p.metadata.timestamp })
      await this.send('Page.screencastFrameAck', { sessionId: p.sessionId })
    })
    await this.send('Page.startScreencast', { format: 'png', maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 })
    await sleep(400)
    await fn()
    await sleep(tail)
    await this.send('Page.stopScreencast')
    await sleep(300)
    // a concat list holding each frame for as long as it was on screen
    const list = frames
      .map((fr, i) => `file '${fr.f}'\nduration ${((frames[i + 1]?.t ?? fr.t + tail / 1000) - fr.t).toFixed(3)}`)
      .join('\n')
    fs.writeFileSync(path.join(dir, 'list.txt'), `${list}\nfile '${frames.at(-1).f}'\n`)
    const filter = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff:max_colors=128[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'list.txt'), '-vf', filter, '-loop', '0', file])
    console.log('gif', file, `${frames.length} frames`, `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`)
  }
}

export { sleep }
