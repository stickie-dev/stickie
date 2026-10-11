import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './index.css'
import { retireWorker } from './desktop'
import { tameUnfoldAll } from './collapsedRegions'
import { installHints } from './hints'

retireWorker()
tameUnfoldAll()
installHints()

const root = document.getElementById('root')
if (root === null) {
  throw new Error('missing #root element')
}
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
