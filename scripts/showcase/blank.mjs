// points the capture page at a blank page, so nothing reads the reviews while they are seeded
import { connect } from './cdp.mjs'
const p = await connect()
await p.send('Page.navigate', { url: 'about:blank' })
p.close()
