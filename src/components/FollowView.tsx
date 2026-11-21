import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchUpdates, type Update } from '../share'
import { makeTileLayer, SOURCES } from '../tiles'
import WhereBlock from './WhereBlock'

/** The page a contact opens from a share link. Works in any browser, no install. */
export default function FollowView({ topic, name, server }: { topic: string; name: string; server?: string }) {
  const [updates, setUpdates] = useState<Update[]>([])
  const [err, setErr] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [, tick] = useState(0)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const fitted = useRef(false)

  useEffect(() => {
    document.title = `Following ${name || 'a hiker'} · Trailz`
    const m = L.map(el.current!, { zoomControl: true }).setView([-29, 29.4], 6)
    makeTileLayer(SOURCES.topo).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => { m.remove() }
  }, [name])

  useEffect(() => {
    let live = true
    const load = () =>
      fetchUpdates(topic, server)
        .then((u) => { if (live) { setUpdates(u); setErr('') } })
        .catch((e) => live && setErr((e as Error).message))
        .finally(() => live && setLoaded(true))
    load()
    const t = setInterval(load, 60000)
    const c = setInterval(() => tick((n) => n + 1), 20000)
    const vis = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', vis)
    return () => { live = false; clearInterval(t); clearInterval(c); document.removeEventListener('visibilitychange', vis) }
  }, [topic, server])

  const pts = updates.filter((u) => !u.stopped)
  const last = pts[pts.length - 1]
  const stopped = updates.length > 0 && updates[updates.length - 1].stopped

  useEffect(() => {
    const g = layer.current
    if (!g || !map.current) return
    g.clearLayers()
    if (!pts.length) return
    const ll = pts.map((p) => [p.lat, p.lng] as [number, number])
    g.addLayer(L.polyline(ll, { color: '#c9792b', weight: 4, dashArray: '2 8', lineCap: 'round' }))
    pts.slice(0, -1).forEach((p) => g.addLayer(L.circleMarker([p.lat, p.lng], { radius: 4, color: '#c9792b', fillOpacity: 1 }).bindTooltip(new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))))
    g.addLayer(L.circle([last.lat, last.lng], { radius: last.acc || 10, color: '#1d4a3a', weight: 1, fillOpacity: 0.12 }))
    g.addLayer(L.circleMarker([last.lat, last.lng], { radius: 9, color: '#fff', weight: 3, fillColor: '#1d4a3a', fillOpacity: 1 }))
    if (!fitted.current) {
      fitted.current = true
      map.current.setView([last.lat, last.lng], 14)
    }
  }, [updates]) // eslint-disable-line react-hooks/exhaustive-deps

  const mins = last ? Math.round((Date.now() - last.t) / 60000) : 0
  const stale = last && mins > 15
  const who = name || 'Your hiker'
  return (
    <div className="follow">
      <header className="follow-head">
        <img src="./favicon.svg" alt="" width="32" height="32" />
        <div className="grow">
          <h1>Following {who}</h1>
          <p className="tiny">{stopped ? `${who} has stopped sharing.` : 'Updates every 5 minutes while they have signal. This page refreshes itself.'}</p>
        </div>
      </header>
      <section className="follow-card">
        {!loaded ? (
          <p>Loading…</p>
        ) : last ? (
          <>
            <WhereBlock w={last} label={who} big />
            <p className={stale ? 'error' : ''}>
              {mins < 1 ? 'Updated just now' : `Updated ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`} ago`} · {new Date(last.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            {stale && !stopped && <p className="tiny">No update for a while. They may be out of signal or have Trailz closed; mountain areas often have no coverage.</p>}
            <button className="btn small subtle" onClick={() => map.current?.setView([last.lat, last.lng], 15)}>Centre map</button>
          </>
        ) : (
          <p>{err || `No location yet. As soon as ${who}'s phone sends one, it will show here.`}</p>
        )}
        {err && last && <p className="tiny error">{err}</p>}
      </section>
      <div ref={el} className="follow-map" />
      <p className="tiny follow-foot">In an emergency in South Africa call 112 from a mobile, or 10177 and ask for Mountain Rescue. Read them the GPS coordinates above.</p>
    </div>
  )
}
