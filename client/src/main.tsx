import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App'
import './index.css'
import { registerWorker } from './install'
import { tameUnfoldAll } from './collapsedRegions'

registerWorker()
tameUnfoldAll()

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
