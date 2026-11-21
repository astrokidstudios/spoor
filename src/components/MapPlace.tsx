import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import { useMapState } from '../mapbus'
import { bboxCenter } from '../geo'

const cache = new Map<string, string>()

/** The town or area in the middle of the map, e.g. "Winterton, KwaZulu-Natal". Updates as you move around. */
export default function MapPlace() {
  const { bounds, zoom } = useMapState()
  const [name, setName] = useState('')
  const lastAsk = useRef(0)

  useEffect(() => {
    if (!bounds || navigator.onLine === false) return
    const [lat, lng] = bboxCenter(bounds)
    // Zoomed out: the province or region. Zoomed in: the town, village or suburb.
    const level = zoom >= 12 ? 14 : zoom >= 9 ? 10 : 5
    const key = `${level}:${lat.toFixed(level >= 14 ? 2 : 1)},${lng.toFixed(level >= 14 ? 2 : 1)}`
    if (cache.has(key)) { setName(cache.get(key)!); return }
    const ac = new AbortController()
    // Wait until the map stops moving, and ask at most about once a second (OpenStreetMap's fair-use rule).
    const wait = Math.max(900, 1100 - (Date.now() - lastAsk.current))
    const t = setTimeout(async () => {
      lastAsk.current = Date.now()
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${level}&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&accept-language=en`, { signal: ac.signal })
        if (!res.ok) return
        const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {}
        const local = a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || a.county
        const region = a.state || a.province || a.region
        const label = level >= 10 ? [local, region].filter(Boolean).join(', ') : [region, a.country].filter(Boolean).join(', ')
        cache.set(key, label)
        if (!ac.signal.aborted) setName(label)
      } catch { /* offline or cancelled */ }
    }, wait)
    return () => { clearTimeout(t); ac.abort() }
  }, [bounds, zoom])

  if (!name) return null
  return <div className="map-place" aria-live="polite"><MapPin size={13} aria-hidden="true" /> <span>{name}</span></div>
}
