import { useEffect, useRef, useState } from 'react'
import type L from 'leaflet'

type Mode = 'north' | 'free' | 'heading'

/** Smallest signed difference between two angles, in degrees. */
const diff = (a: number, b: number) => ((a - b + 540) % 360) - 180

/**
 * Compass button. The needle always points to north on the map.
 * Tap when rotated: snap back to north up. Tap when north up: turn the map with the phone (heading up).
 */
export default function Compass({ map }: { map: L.Map | null }) {
  const [bearing, setBearing] = useState(0)
  const [mode, setMode] = useState<Mode>('north')
  const [msg, setMsg] = useState('')
  const modeRef = useRef(mode)
  modeRef.current = mode
  const smooth = useRef<number | null>(null)

  useEffect(() => {
    if (!map) return
    const on = () => {
      const b = map.getBearing()
      setBearing(b)
      if (modeRef.current !== 'heading') setMode(Math.abs(diff(b, 0)) < 0.5 ? 'north' : 'free')
    }
    map.on('rotate', on)
    return () => { map.off('rotate', on) }
  }, [map])

  // Heading up: follow the phone's compass.
  useEffect(() => {
    if (mode !== 'heading' || !map) return
    const handle = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      let heading: number | null = null
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading
      else if (e.absolute && e.alpha != null) heading = 360 - e.alpha
      if (heading == null || !Number.isFinite(heading)) return
      heading += screen.orientation?.angle ?? 0
      const target = -heading
      // Ease towards the new reading so the map doesn't jitter.
      const cur = smooth.current ?? map.getBearing()
      const next = cur + diff(target, cur) * 0.35
      smooth.current = next
      if (Math.abs(diff(next, map.getBearing())) > 0.4) map.setBearing(((next % 360) + 360) % 360)
    }
    const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation'
    window.addEventListener(evt, handle as EventListener)
    const quit = () => setMode('free')
    // Grabbing the map to turn it yourself ends heading up.
    const grab = (ev: TouchEvent) => { if (ev.touches.length > 1) quit() }
    const box = map.getContainer()
    box.addEventListener('touchstart', grab)
    return () => { window.removeEventListener(evt, handle as EventListener); box.removeEventListener('touchstart', grab); smooth.current = null }
  }, [mode, map])

  async function tap() {
    if (!map) return
    setMsg('')
    if (mode !== 'north') {
      setMode('north')
      map.setBearing(0)
      return
    }
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined
    if (!DOE) return flash('This device has no compass.')
    try {
      if (DOE.requestPermission && (await DOE.requestPermission()) !== 'granted') return flash('Allow motion and orientation access to turn the map with your phone.')
    } catch {
      return flash('Allow motion and orientation access to turn the map with your phone.')
    }
    setMode('heading')
    flash('Map turns with your phone. Tap the compass again for north up.')
  }

  function flash(m: string) {
    setMsg(m)
    window.setTimeout(() => setMsg((x) => (x === m ? '' : x)), 3500)
  }

  const label = mode === 'heading' ? 'Heading up: tap for north up' : mode === 'free' ? 'Tap to point north up' : 'North up: tap to turn the map with your phone'
  return (
    <>
      <button className={`map-btn compass ${mode}`} onClick={tap} title={label} aria-label={label}>
        <svg viewBox="0 0 40 40" width="30" height="30" style={{ transform: `rotate(${bearing}deg)` }} aria-hidden="true">
          <path d="M20 4 L25 20 L15 20 Z" fill="#e5484d" />
          <path d="M20 36 L25 20 L15 20 Z" fill="currentColor" opacity="0.45" />
          <circle cx="20" cy="20" r="2.2" fill="var(--surface, #fff)" />
        </svg>
      </button>
      {msg && <div className="map-msg compass-msg" role="status" onClick={() => setMsg('')}>{msg}</div>}
    </>
  )
}
