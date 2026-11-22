import { useEffect, useRef, useState } from 'react'
import { MapPin, Search, X } from 'lucide-react'
import { placesNamed, type PlaceHit } from '../findtrails'
import { goToPlace, leaflet } from '../mapbus'

/** Search button on the map: type a town, peak or park and the map goes there. Works on every tab. */
export default function MapSearch() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<PlaceHit[]>([])
  const [state, setState] = useState<'idle' | 'busy' | 'none' | 'error'>('idle')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50) }, [open])

  useEffect(() => {
    const text = q.trim()
    if (text.length < 3) { setHits([]); setState('idle'); return }
    const ac = new AbortController()
    const t = setTimeout(async () => {
      setState('busy')
      const c = leaflet()?.getCenter()
      try {
        const r = await placesNamed(text, c ? [c.lat, c.lng] : [-29.035, 29.37], ac.signal)
        if (ac.signal.aborted) return
        setHits(r)
        setState(r.length ? 'idle' : 'none')
      } catch {
        if (!ac.signal.aborted) setState(navigator.onLine === false ? 'error' : 'none')
      }
    }, 350)
    return () => { clearTimeout(t); ac.abort() }
  }, [q])

  function go(p: PlaceHit) {
    goToPlace(p)
    close()
  }
  function close() { setOpen(false); setQ(''); setHits([]); (document.activeElement as HTMLElement | null)?.blur() }

  if (!open) return <button className="map-btn" title="Search for a place" aria-label="Search for a place on the map" onClick={() => setOpen(true)}><Search size={20} strokeWidth={2.2} /></button>

  return (
    <div className="map-search" role="search">
      <form className="map-search-box" onSubmit={(e) => { e.preventDefault(); if (hits[0]) go(hits[0]) }}>
        <Search size={17} aria-hidden="true" />
        <input ref={input} type="search" enterKeyHint="go" placeholder="Go to a town, peak or park" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Go to a place" autoCorrect="off" />
        <button type="button" className="icon-btn sm" onClick={close} aria-label="Close search"><X size={18} /></button>
      </form>
      {(hits.length > 0 || state !== 'idle') && (
        <ul className="map-search-list">
          {hits.map((p) => (
            <li key={p.id}><button onClick={() => go(p)}><MapPin size={16} aria-hidden="true" /><span><b>{p.name}</b><span className="muted tiny">{p.sub}</span></span></button></li>
          ))}
          {state === 'busy' && !hits.length && <li className="muted small map-search-note">Searching…</li>}
          {state === 'none' && <li className="muted small map-search-note">No place called “{q.trim()}”.</li>}
          {state === 'error' && <li className="muted small map-search-note">Place search needs a connection.</li>}
        </ul>
      )}
    </div>
  )
}
