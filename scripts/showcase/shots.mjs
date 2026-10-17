// The README's still images, from a freshly reset showcase (reset.sh first).
// Writes docs/images/*.png at 2x.
import path from 'node:path'
import { base, connect, sleep } from './cdp.mjs'
import { out as images } from './paths.mjs'

const out = (name) => path.join(images, `${name}.png`)
const p = await connect()

async function rightClick(at) {
  await p.move(at)
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: at[0], y: at[1], button: 'right', clickCount: 1 })
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: at[0], y: at[1], button: 'right', clickCount: 1 })
  await sleep(700)
}

// 1. the overview: every review, by what it is waiting for
await p.clearState()
await p.theme('light')
await p.go(base + '/', 3000)
await p.hideCursor()
await p.shot(out('overview'))

// 2. a review: the diff with the conversation on it
await p.go(base + '/r/3/diff', 3500)
await p.hideCursor()
await p.shot(out('review'))

// 3. the same in dark, with every note of the review in the comments panel
await p.clearState()
await p.theme('dark')
await p.go(base + '/r/3/diff', 3500)
await p.click('[title*="omments" i], button[aria-label*="omments" i]', { glide: false })
await sleep(1500)
await p.hideCursor()
await p.shot(out('review-dark'))

// 4. across repositories: a note pointing into orbit-api, and usages in both repos
await p.clearState()
await p.theme('light')
await p.go(base + '/r/4/file/src/api.ts', 3500)
const [x, y] = await p.line(8, 'modified')
const at = [x + 22 * 8.4 + 20, y]
await rightClick(at)
await p.click([at[0] + 60, at[1] + 37], { glide: false }) // Find usages
await sleep(2000)
await p.click({ sel: 'button', text: 'search all repos', exact: true }, { glide: false })
await sleep(2500)
await p.move([1180, 560], 1)
await p.hideCursor()
await p.shot(out('cross-repo'))

// 5. MCP: what an agent connects to. The stdio line names a path on this
// machine, so it is left out of the picture.
await p.go(base + '/settings', 2500)
await p.click({ sel: 'nav a, nav button, a, button', text: 'Agents', exact: true }, { glide: false })
await sleep(1200)
const clip = await p.eval(`
  for (const code of document.querySelectorAll('pre, code')) {
    if (code.textContent.includes('stickie-mcp.js')) {
      const block = code.closest('pre') ?? code
      block.style.display = 'none'
      const lead = block.previousElementSibling
      if (lead && lead.textContent.includes('stdio')) lead.style.display = 'none'
    }
  }
  // the scratch instance runs on 4879; the picture shows the default port
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (walk.nextNode()) walk.currentNode.nodeValue = walk.currentNode.nodeValue.replaceAll(':4879', ':4870')
  const heads = [...document.querySelectorAll('h2, h3')]
  const agents = heads.find(h => h.textContent.trim() === 'Agents')
  const next = heads.slice(heads.indexOf(agents) + 1).find(h => h.tagName === agents.tagName)
  agents.scrollIntoView({ block: 'start' })
  let box = agents.parentElement
  while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement
  if (box) box.scrollTop -= 32
  await new Promise(r => setTimeout(r, 300))
  const a = agents.getBoundingClientRect(), n = next.getBoundingClientRect()
  const col = agents.parentElement.getBoundingClientRect()
  return { x: col.left - 24, y: a.top - 16, width: col.width + 48, height: n.top - a.top - 8 }`)
await p.hideCursor()
await p.shot(out('mcp'), clip)

await p.go('about:blank', 200)
p.close()
