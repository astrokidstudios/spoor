import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Trail } from '../db'
import { bindMap, getMap, rememberView, savedView, setMap, useMapState } from '../mapbus'
import { setSettings, useSettings } from '../settings'
import { activeSource, makeTileLayer, SOURCES } from '../tiles'

export const KIND_COLOR: Record<Trail['kind'], string> = { hiking: '#c2410c', walking: '#7c3aed', running: '#0e7490', path: '#a16207' }

export default function MapView({ onSelect }: { onSelect: (id: string) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const trailLayer = useRef<L.LayerGroup | null>(null)
  const packLayer = useRef<L.LayerGroup | null>(null)
  const meLayer = useRef<L.LayerGroup | null>(null)
  const previewLayer = useRef<L.LayerGroup | null>(null)
  const watchRef = useRef<number | null>(null)
  const settings = useSettings()
  const { trails, selectedId, me, preview, follow } = useMapState()
  const packs = useLiveQuery(() => db.packs.toArray(), [])
  const [styleOpen, setStyleOpen] = useState(false)
  const [locErr, setLocErr] = useState('')
  const selectRef = useRef(onSelect)
  selectRef.current = onSelect

  // Create the map once.
  useEffect(() => {
    const map = L.map(el.current!, { zoomControl: false, attributionControl: true }).setView(savedView.c, savedView.z)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map)
    packLayer.current = L.layerGroup().addTo(map)
    trailLayer.current = L.layerGroup().addTo(map)
    previewLayer.current = L.layerGroup().addTo(map)
    meLayer.current = L.layerGroup().addTo(map)
    const report = () => {
      const b = map.getBounds()
      setMap({ bounds: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], zoom: map.getZoom() })
      const c = map.getCenter()
      rememberView([c.lat, c.lng], map.getZoom())
    }
    map.on('moveend', report)
    map.on('dragstart', () => getMap().follow && setMap({ follow: false }))
    report()
    mapRef.current = map
    bindMap(map)
    const ro = new ResizeObserver(() => map.invalidateSize())
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
      line.on('click', () => selectRef.current(t.id))
      g.addLayer(L.polyline(t.lines, { color: '#000', opacity: 0, weight: 16 }).on('click', () => selectRef.current(t.id)))
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

  // My location.
  useEffect(() => {
    const g = meLayer.current!
    g.clearLayers()
    if (!me) return
    g.addLayer(L.circle([me.lat, me.lng], { radius: me.acc, color: '#2563eb', weight: 1, fillOpacity: 0.1, interactive: false }))
    g.addLayer(L.circleMarker([me.lat, me.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }).bindTooltip('You'))
    if (follow) mapRef.current?.panTo([me.lat, me.lng])
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
        setLocErr(e.code === 1 ? 'Location permission is off for Spoor.' : 'Could not find your location.')
        if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      },
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    )
  }

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      <div className="map-tools">
        <button className={`map-btn ${follow ? 'on' : ''}`} title="Show my location" aria-label="Show my location" onClick={locate}>
          <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="4" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
        </button>
        <button className="map-btn" title="Map style" aria-label="Map style" onClick={() => setStyleOpen((o) => !o)}>
          <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 3 2 8l10 5 10-5-10-5Zm-7.6 8.2L2 12.5l10 5 10-5-2.4-1.3L12 15l-7.6-3.8Zm0 4.5L2 17l10 5 10-5-2.4-1.3L12 19.5l-7.6-3.8Z" fill="currentColor" /></svg>
        </button>
        {styleOpen && (
          <div className="style-menu">
            {Object.values(SOURCES).map((s) => (
              <button key={s.id} className={settings.mapStyle === s.id ? 'on' : ''} onClick={() => { setSettings({ mapStyle: s.id as never }); setStyleOpen(false) }}>
                {s.label}{s.needsKey && !settings.thunderforestKey ? ' 🔑' : ''}
              </button>
            ))}
          </div>
        )}
      </div>
      {locErr && <div className="map-msg" role="status" onClick={() => setLocErr('')}>{locErr}</div>}
    </div>
  )
}
