import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Keyboard shortcuts: 1 / 2 / 3 switch views.
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return
  const map: Record<string, string> = { '1': '#/report', '2': '#/daily', '3': '#/explore' }
  if (map[e.key]) window.location.hash = map[e.key]
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
