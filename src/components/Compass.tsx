import { useEffect, useRef, useState } from 'react'
import type L from 'leaflet'
import { Lock, LockOpen } from 'lucide-react'
import { readJSON, writeJSON } from '../settings'
import './compass.css'

type Mode = 'north' | 'free' | 'heading'

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export const cardinal = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]

interface OrientationEventIOS extends DeviceOrientationEvent { webkitCompassHeading?: number }
type PermissionAPI = { requestPermission?: () => Promise<'granted' | 'denied'> }

/**
 * Compass button for the map.
 * The needle always points to north on the map. Tap: if the map is turned, put north back up;
 * if north is up, follow the way the phone is facing (the map turns as you turn). Tap again to stop.
 * Two-finger twist on the map rotates it freely, unless rotation is locked with the small lock button
 * (then the map stays as it is while you pinch and pan).
 */
export default function Compass({ map }: { map: L.Map | null }) {
  const [bearing, setBearing] = useState(0)
  const [mode, setMode] = useState<Mode>('north')
  const [heading, setHeading] = useState<number | null>(null)
  const [msg, setMsg] = useState('')
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [locked, setLocked] = useState(() => readJSON<boolean>('trailz.rotateLock', false))

  // Rotation lock: no accidental twisting while you pinch-zoom and pan.
  useEffect(() => {
    const tr = (map as unknown as { touchRotate?: { enable(): void; disable(): void } } | null)?.touchRotate
    if (!tr) return
    if (locked) tr.disable()
    else tr.enable()
  }, [map, locked])

  function toggleLock() {
    const next = !locked
    setLocked(next)
    writeJSON('trailz.rotateLock', next)
    setMsg(next ? 'Map rotation locked' : 'Twist with two fingers to rotate')
    setTimeout(() => setMsg(''), 2200)
  }

  // Keep the needle in step with the map's rotation.
  useEffect(() => {
    if (!map) return
    const on = () => {
      const b = map.getBearing()
      setBearing(b)
      if (modeRef.current === 'north' && Math.abs(norm(b)) > 0.5) setMode('free')
    }
    map.on('rotate', on)
    return () => { map.off('rotate', on) }
  }, [map])

  // Follow the phone's heading.
  useEffect(() => {
    if (!map || mode !== 'heading') return
    let last = 0
    const on = (e: Event) => {
      const o = e as OrientationEventIOS
      const h = o.webkitCompassHeading ?? (o.absolute && o.alpha != null ? 360 - o.alpha : null)
      if (h == null || !Number.isFinite(h)) return
      const turn = window.screen.orientation?.angle ?? 0
      const facing = (h + turn + 360) % 360
      setHeading(facing)
      const now = performance.now()
      if (now - last < 60) return
      last = now
      map.setBearing(360 - facing)
    }
    // iPhone gives webkitCompassHeading on "deviceorientation"; Android gives an absolute alpha on "deviceorientationabsolute".
    window.addEventListener('deviceorientation', on)
    window.addEventListener('deviceorientationabsolute', on)
    return () => { window.removeEventListener('deviceorientation', on); window.removeEventListener('deviceorientationabsolute', on) }
  }, [map, mode])

  async function tap() {
    if (!map) return
    setMsg('')
    if (mode === 'heading') {
      setMode('north')
      setHeading(null)
      map.setBearing(0)
      return
    }
    if (mode === 'free' || Math.abs(norm(map.getBearing())) > 0.5) {
      setMode('north')
      map.setBearing(0)
      return
    }
    // North is up: start following the phone's direction (iPhone asks permission first).
    const api = (window.DeviceOrientationEvent as unknown as PermissionAPI | undefined)
    if (!api) return setMsg('No compass on this device.')
    if (api.requestPermission) {
      const r = await api.requestPermission().catch(() => 'denied' as const)
      if (r !== 'granted') return setMsg('Allow motion & orientation access to use the compass.')
    }
    setMode('heading')
  }

  const label = mode === 'heading' ? 'Stop following your direction' : mode === 'free' ? 'Reset map to north' : 'Follow the direction you face'
  return (
    <div className="compass-wrap">
      <button className={`map-btn compass ${mode}`} onClick={tap} aria-label={label} title={label}>
        <svg viewBox="0 0 40 40" width="30" height="30" style={{ transform: `rotate(${bearing}deg)` }} aria-hidden="true">
          <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="2" />
          <path d="M20 4 L25 20 L15 20 Z" fill="#e5484d" />
          <path d="M20 36 L25 20 L15 20 Z" fill="currentColor" fillOpacity=".55" />
          <circle cx="20" cy="20" r="2.4" fill="var(--surface)" />
        </svg>
      </button>
      <button className={`map-btn lock-btn ${locked ? 'on' : ''}`} onClick={toggleLock} aria-pressed={locked} aria-label={locked ? 'Unlock map rotation' : 'Lock map rotation'} title={locked ? 'Rotation locked' : 'Lock rotation'}>
        {locked ? <Lock size={16} strokeWidth={2.4} /> : <LockOpen size={16} strokeWidth={2.4} />}
      </button>
      {mode === 'heading' && heading != null && <span className="compass-read">{cardinal(heading)} {Math.round(heading)}°</span>}
      {msg && <span className="compass-read warn">{msg}</span>}
    </div>
  )
}

const norm = (b: number) => ((((b + 180) % 360) + 360) % 360) - 180
