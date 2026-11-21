import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/plus-jakarta-sans'
import './index.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { LowBatterySheet } from './components/LowBattery'
import { startBatteryWatch } from './battery'

// Offline caching for the web/iPhone version. The desktop app is already fully local.
if (location.protocol.startsWith('http') && 'serviceWorker' in navigator) registerSW({ immediate: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <LowBatterySheet />
  </StrictMode>,
)

// Watch the battery while you're out, so friends hear before your phone dies.
startBatteryWatch()
