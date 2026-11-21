import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import MapPlace from './MapPlace'
import MapSearch from './MapSearch'
import { Layers, LocateFixed, Star } from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import '../leaflet-global'
import 'leaflet-rotate'
import Compass from './Compass'
import { memberColor } from '../group'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, photoBlob, type Trail } from '../db'
import { bindMap, getMap, rememberView, savedView, setMap, useMapState } from '../mapbus'
import { setSettings, useSettings } from '../settings'
import { activeSource, makeTileLayer, SOURCES } from '../tiles'
import { addPoint, getPlan, usePlan } from '../plan'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export const KIND_COLOR: Record<Trail['kind'], string> = { hiking: '#c2410c', walking: '#7c3aed', running: '#0e7490', path: '#a16207' }

export default function MapView({ onSelect }: { onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const trailLayer = useRef<L.LayerGroup | null>(null)
  const packLayer = useRef<L.LayerGroup | null>(null)
  const meLayer = useRef<L.LayerGroup | null>(null)
  const previewLayer = useRef<L.LayerGroup | null>(null)
  const trackLayer = useRef<L.LayerGroup | null>(null)
  const planLayer = useRef<L.LayerGroup | null>(null)
  const followedTrack = useRef(false)
  const groupLayer = useRef<L.LayerGroup | null>(null)
  const plan = usePlan()
  const watchRef = useRef<number | null>(null)
  const settings = useSettings()
  const { trails, selectedId, me, preview, follow, track, group } = useMapState()
  const packs = useLiveQuery(() => db.packs.toArray(), [])
  const [styleOpen, setStyleOpen] = useState(false)
  const [locErr, setLocErr] = useState('')
  const [leafletMap, setLeafletMap] = useState<L.Map | null>(null)
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  // Create the map once.
  useEffect(() => {
    const map = L.map(el.current!, { zoomControl: false, attributionControl: true, rotate: true, bearing: 0, touchRotate: true, shiftKeyRotate: true, rotateControl: false }).setView(savedView.c, savedView.z)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
    packLayer.current = L.layerGroup().addTo(map)
    trailLayer.current = L.layerGroup().addTo(map)
    previewLayer.current = L.layerGroup().addTo(map)
    trackLayer.current = L.layerGroup().addTo(map)
    planLayer.current = L.layerGroup().addTo(map)
    groupLayer.current = L.layerGroup().addTo(map)
    meLayer.current = L.layerGroup().addTo(map)
    const report = () => {
      const b = map.getBounds()
      setMap({ bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], zoom: map.getZoom() })
      const c = map.getCenter()
      rememberView([c.lat, c.lng], map.getZoom())
    }
    map.on('moveend', report)
    // Planning a route: each tap on the map adds a point.
    map.on('click', (e: L.LeafletMouseEvent) => { if (getPlan().active) void addPoint([e.latlng.lat, e.latlng.lng]) })
    map.on('dragstart', () => getMap().follow && setMap({ follow: false }))
    report()
    mapRef.current = map
    setLeafletMap(map)
    bindMap(map)
    // While the map is hidden (list-only view) it has no size: keep the last view instead of shrinking to nothing.
    const ro = new ResizeObserver(() => { if (el.current && el.current.clientWidth > 0 && el.current.clientHeight > 0) map.invalidateSize() })
    ro.observe(el.current!)
    return () => { ro.disconnect(); bindMap(null); map.remove() }
  }, [])

  // Base map.
  useEffect(() => {
    const map = mapRef.current!
    const layer = makeTileLayer(activeSource()).addTo(map)
    layer.bringToBack()
    return () => { layer.remove() }
  }, [settings.mapStyle, settings.thunderforestKey])

  // Trails.
  useEffect(() => {
    const g = trailLayer.current!
    g.clearLayers()
    const sel = trails.find((t) => t.id === selectedId)
    for (const t of trails) {
      if (t.id === selectedId) continue
      const line = L.polyline(t.lines, { color: KIND_COLOR[t.kind], weight: 4, opacity: sel ? 0.35 : 0.85, dashArray: t.kind === 'path' ? '6 6' : undefined })
      line.bindTooltip(t.name, { sticky: true })
      // While planning, taps on a trail go through to the map (to add a point) instead of opening it.
      const pick = () => { if (!getPlan().active) selectRef.current(t.id) }
      line.on('click', pick)
      g.addLayer(L.polyline(t.lines, { color: '#000', opacity: 0, weight: 16 }).on('click', pick))
      g.addLayer(line)
    }
    if (sel) {
      g.addLayer(L.polyline(sel.lines, { color: '#fff', weight: 9, opacity: 0.9 }))
      g.addLayer(L.polyline(sel.lines, { color: KIND_COLOR[sel.kind], weight: 5 }))
      const start = sel.lines[0]?.[0]
      if (start) g.addLayer(L.circleMarker(start, { radius: 7, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Start'))
    }
  }, [trails, selectedId])

  // Downloaded areas.
  useEffect(() => {
    const g = packLayer.current!
    g.clearLayers()
    for (const p of packs ?? []) {
      g.addLayer(L.rectangle([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { color: '#1d4a3a', weight: 1.5, dashArray: '4 4', fill: false, interactive: false }))
    }
  }, [packs])

  useEffect(() => {
    const g = previewLayer.current!
    g.clearLayers()
    if (preview) g.addLayer(L.rectangle([[preview[0], preview[1]], [preview[2], preview[3]]], { color: '#c9792b', weight: 2, fillOpacity: 0.12, interactive: false }))
  }, [preview])

  // Recorded walk: the trail being followed, the track so far and photo spots.
  useEffect(() => {
    const g = trackLayer.current!
    g.clearLayers()
    if (!track) return
    const urls: string[] = []
    // The trail you're following: muted, so the path you've actually walked stands out on top of it.
    if (track.guide) {
      g.addLayer(L.polyline(track.guide, { color: '#fff', weight: 8, opacity: 0.55, interactive: false }))
      g.addLayer(L.polyline(track.guide, { color: '#c2410c', weight: 4, opacity: 0.45, dashArray: '2 8', lineCap: 'round', interactive: false }))
    }
    // Where you've walked: bright, with a soft glow and a white edge.
    g.addLayer(L.polyline(track.lines, { color: '#38bdf8', weight: 14, opacity: 0.25, interactive: false }))
    g.addLayer(L.polyline(track.lines, { color: '#fff', weight: 9, opacity: 0.95, interactive: false }))
    g.addLayer(L.polyline(track.lines, { color: '#0ea5e9', weight: 5.5, interactive: false }))
    const first = track.lines.find((l) => l.length)?.[0]
    if (first) g.addLayer(L.circleMarker(first, { radius: 6, color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }).bindTooltip('Start'))
    // You, at the end of the line, while the walk is live; the map keeps you in view until you drag it.
    const lastLine = [...track.lines].reverse().find((l) => l.length)
    const here = lastLine?.[lastLine.length - 1]
    if (track.live && here) {
      g.addLayer(L.marker(here, { interactive: false, icon: L.divIcon({ className: 'you-dot', html: '<span></span>', iconSize: [22, 22] }) }))
      const map = mapRef.current
      if (map) {
        if (!followedTrack.current) { followedTrack.current = true; map.setView(here, Math.max(map.getZoom(), 15)); setMap({ follow: true }) }
        else if (getMap().follow) map.panTo(here, { animate: true })
      }
    }
    if (!track.live) followedTrack.current = false
    for (const ph of track.photos) {
      const m = L.marker([ph.lat, ph.lng], { icon: L.divIcon({ className: 'photo-pin', html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></svg>', iconSize: [32, 32] }) })
      m.bindPopup('<div class="photo-pop">Loading…</div>', { maxWidth: 260 })
      m.on('popupopen', async () => {
        const p = await db.photos.get(ph.id)
        if (!p) return
        const u = URL.createObjectURL(photoBlob(p))
        urls.push(u)
        m.setPopupContent(`<img class="photo-pop" src="${u}" alt="Photo from this walk" />`)
      })
      g.addLayer(m)
    }
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [track])

  // Route being planned: snapped parts solid, straight parts dashed, a dot per tap.
  useEffect(() => {
    const g = planLayer.current!
    g.clearLayers()
    if (!plan.active) return
    for (const leg of plan.legs) {
      if (!leg) continue
      g.addLayer(L.polyline(leg.line, { color: '#fff', weight: 8, opacity: 0.9, interactive: false }))
      g.addLayer(L.polyline(leg.line, { color: '#9333ea', weight: 5, dashArray: leg.snapped ? undefined : '8 8', interactive: false }))
    }
    plan.points.forEach((p, i) => {
      const end = i === plan.points.length - 1
      g.addLayer(L.circleMarker(p, { radius: i === 0 || end ? 7 : 5, color: '#fff', weight: 3, fillColor: i === 0 ? '#16a34a' : end ? '#9333ea' : '#6b21a8', fillOpacity: 1, interactive: false }))
    })
  }, [plan.active, plan.legs, plan.points])

  // People on my group walk.
  useEffect(() => {
    const g = groupLayer.current!
    g.clearLayers()
    for (const m of group ?? []) {
      if (m.me || m.status === 'left') continue
      const stale = Date.now() - m.t > 3 * 60000 || m.status === 'done'
      const icon = L.divIcon({ className: 'group-pin', html: `<span style="background:${memberColor(m.id)};opacity:${stale ? 0.6 : 1}">${esc(m.name.slice(0, 1).toUpperCase())}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] })
      g.addLayer(L.marker([m.lat, m.lng], { icon, zIndexOffset: 500 }).bindTooltip(`${esc(m.name)}${m.pct != null ? ` · ${m.pct}%` : ''}`, { direction: 'top', offset: [0, -14] }))
    }
  }, [group])

  // My location.
  useEffect(() => {
    const g = meLayer.current!
    g.clearLayers()
    if (!me) return
    g.addLayer(L.circle([me.lat, me.lng], { radius: me.acc, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }))
    g.addLayer(L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('You'))
    const map = mapRef.current
    if (follow && map) {
      // While recording, keep you in view close enough to see the path you're on.
      if (getMap().track && map.getZoom() < 15) map.setView([me.lat, me.lng], 15)
      else map.panTo([me.lat, me.lng])
    }
  }, [me, follow])

  useEffect(() => () => { if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current) }, [])

  function locate() {
    setLocErr('')
    if (!('geolocation' in navigator)) return setLocErr('Location is not available here.')
    if (watchRef.current != null) {
      const cur = getMap().me
      if (cur) mapRef.current?.flyTo([cur.lat, cur.lng], Math.max(mapRef.current.getZoom(), 14))
      setMap({ follow: true })
      return
    }
    let first = true
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setMap({ me: { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }, ...(first ? { follow: true } : {}) })
        if (first) mapRef.current?.flyTo([pos.coords.latitude, pos.coords.longitude], Math.max(mapRef.current.getZoom(), 14))
        first = false
      },
      (e) => {
        setLocErr(e.code === 1 ? 'Location permission is off for Trailz.' : 'Could not find your location.')
        if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    )
  }

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <MapPlace />
      <div className="map-tools">
        <Compass map={leafletMap} />
        <button className={`map-btn ${follow ? 'on' : ''}`} title="Show my location" aria-label="Show my location" onClick={locate}>
          <LocateFixed size={20} strokeWidth={2.2} />
        </button>
        <MapSearch />
        <button className="map-btn" title="Map style" aria-label="Map style" onClick={() => setStyleOpen((o) => !o)}>
          <Layers size={20} strokeWidth={2.2} />
        </button>
        {styleOpen && (
          <div className="style-menu">
            {Object.values(SOURCES).map((s) => {
              const isDefault = (settings.defaultMapStyle ?? 'topo') === s.id
              return (
                <div key={s.id} className={`style-row ${settings.mapStyle === s.id ? 'on' : ''}`}>
                  <button className="style-pick" onClick={() => { setSettings({ mapStyle: s.id as never }); setStyleOpen(false) }}>
                    {s.label}{s.needsKey && !settings.thunderforestKey ? ' (needs key)' : ''}
                  </button>
                  <button className={`style-star ${isDefault ? 'is-default' : ''}`} aria-pressed={isDefault} aria-label={isDefault ? `${s.label} is your default map` : `Make ${s.label} your default map`} title={isDefault ? 'Default map' : 'Make default'}
                    onClick={() => setSettings({ defaultMapStyle: s.id as never, mapStyle: s.id as never })}>
                    <Star size={17} fill={isDefault ? 'currentColor' : 'none'} />
                  </button>
                </div>
              )
            })}
            <p className="style-hint">Star = the map Trailz opens with</p>
          </div>
        )}
      </div>
      {locErr && <div className="map-msg" role="status" onClick={() => setLocErr('')}>{locErr}</div>}
    </div>
  )
}
