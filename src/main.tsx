import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/nunito'
import '@fontsource/fredoka/500.css'
import '@fontsource/fredoka/600.css'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'

// Offline caching for the web/iPhone version. The desktop app is already fully local.
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
