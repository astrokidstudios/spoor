import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type BBox, type Trail, type TrailKind } from '../db'
import { bboxCenter, fmtDuration, fmtKm, intersects, padBBox } from '../geo'
import { fitBBox, getMap, setMap, useMapState } from '../mapbus'
import { cachedSearch, difficulty, estimateHours, SHAPE_LABEL, tripOf, fetchProfile, FRESH_MS, KIND_LABEL, offlineTrails, saveTrails, searchAndSave } from '../trails'
import { KIND_COLOR } from './MapView'
import Profile from './Profile'
import PlanPanel from './PlanPanel'
import { isMyRoute, setPlanActive, usePlan } from '../plan'

type Filter = 'all' | TrailKind | 'saved'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hiking', label: 'Hikes' },
  { id: 'walking', label: 'Walks' },
  { id: 'running', label: 'Runs' },
  { id: 'path', label: 'Paths' },
  { id: 'saved', label: '★ Saved' },
]

export default function TrailsTab({ onDownload, onStart }: { onDownload: () => void; onStart: (t: Trail) => void }) {
  const { trails, selectedId, bounds } = useMapState()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const starred = useLiveQuery(() => db.trails.filter((t) => !!t.starred).toArray(), [])
  const savedIds = useLiveQuery(async () => new Set((await db.trails.toArray()).filter((t) => t.packIds.length).map((t) => t.id)), [])

  async function show(list: Trail[], b: BBox) {
    // Keep elevation data / stars we already have.
    const known = new Map((await db.trails.bulkGet(list.map((t) => t.id))).filter(Boolean).map((t) => [t!.id, t!]))
    list = list.map((t) => ({ ...t, ...pick(known.get(t.id)) }))
    const keep = getMap().selectedId
    setMap({ trails: list, selectedId: keep && list.some((t) => t.id === keep) ? keep : null })
    setSearchedFor(JSON.stringify(b))
    return list
  }

  /** Ask the trail servers. Quietly = in the background behind a saved copy (no spinner, no errors shown). */
  async function fetchFresh(b: BBox, ac: AbortController, quietly: boolean) {
    const res = await searchAndSave(b, ac.signal, quietly ? undefined : (m) => setMsg(m))
    if (ac.signal.aborted) return
    const list = await show(res.trails, b)
    setSavedAt(res.at)
    setStatus('idle')
    setMsg(list.length ? '' : 'No mapped trails here yet. Try moving or zooming out the map.')
  }

  async function search(force = false) {
    const b = getMap().bounds
    if (!b) return
    abort.current?.abort()
    const ac = (abort.current = new AbortController())
    setMsg('')
    // 1. Searched this area in the last week? Show that straight away.
    const cached = force ? null : await cachedSearch(b).catch(() => null)
    if (ac.signal.aborted) return
    if (cached) {
      await show(cached.trails, b)
      setSavedAt(cached.at)
      setStatus('idle')
      if (!cached.trails.length) setMsg('No mapped trails here yet. Try moving or zooming out the map.')
      // Older than a day: refresh in the background while you look at the saved copy.
      if (Date.now() - cached.at > FRESH_MS && navigator.onLine !== false) void fetchFresh(b, ac, true).catch(() => {})
      return
    }
    // 2. Otherwise ask the trail servers.
    setStatus('loading')
    try {
      if (navigator.onLine === false) throw new Error('offline')
      try {
        await fetchFresh(b, ac, false)
      } catch (e) {
        if (ac.signal.aborted || (e as Error).message.startsWith('Zoom in')) throw e
        const list = await offlineTrails(b)
        if (!list.length) throw e
        await show(list, b)
        setSavedAt(null)
        setStatus('idle')
        setMsg('No connection, so showing trails you saved offline.')
      }
    } catch (e) {
      if (ac.signal.aborted) return
      if ((e as Error).message === 'offline' || navigator.onLine === false) {
        const list = await offlineTrails(b)
        setMap({ trails: list, selectedId: null })
        setSavedAt(null)
        setStatus('idle')
        setMsg(list.length ? 'Offline: showing trails you saved for this area.' : "You're offline and haven't saved trails for this area.")
        return
      }
      setStatus('error')
      setMsg((e as Error).message)
    }
  }

  // Search automatically the first time the map is ready.
  const ran = useRef(false)
  useEffect(() => {
    if (bounds && !ran.current) {
      ran.current = true
      void search()
    }
  }, [bounds]) // eslint-disable-line react-hooks/exhaustive-deps

  const moved = searchedFor !== null && bounds && searchedFor !== JSON.stringify(bounds)
  const shown = useMemo(() => {
    const src = filter === 'saved' ? [...(starred ?? [])] : trails
    const inView = bounds ? src.filter((t) => intersects(t.bbox, bounds)) : src
    return filter === 'all' || filter === 'saved' ? inView : inView.filter((t) => t.kind === filter)
  }, [trails, filter, bounds, starred])

  const selected = trails.find((t) => t.id === selectedId) ?? starred?.find((t) => t.id === selectedId)
  const planning = usePlan().active
  if (planning) return <PlanPanel onSaved={() => setFilter('saved')} />
  if (selected) return <TrailDetail trail={selected} saved={!!savedIds?.has(selected.id)} onBack={() => setMap({ selectedId: null })} onDownload={onDownload} onStart={onStart} />

  return (
    <div className="tab-body">
      <div className="row gap">
        <button className={`btn primary grow ${moved ? 'pulse' : ''}`} onClick={() => search()} disabled={status === 'loading'}>
          {status === 'loading' ? <span className="spin" /> : '🔎'} {status === 'loading' ? 'Sniffing out trails…' : moved ? 'Search this area' : 'Find trails on the map'}
        </button>
        <button className="btn" onClick={() => { setMap({ selectedId: null }); setPlanActive(true) }} title="Draw your own route on the map">✏️ Plan</button>
      </div>
      {savedAt && status !== 'loading' && !moved && (
        <p className="tiny muted saved-at">
          Trails saved {agoText(savedAt)}, so they load instantly.{' '}
          <button className="link-btn" onClick={() => search(true)}>Refresh</button>
        </p>
      )}
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}
          </button>
        ))}
      </div>
      {msg && <p className={`note ${status === 'error' ? 'error' : ''}`}>{msg}</p>}
      <ul className="trail-list">
        {shown.map((t) => (
          <TrailCard key={t.id} t={t} saved={!!savedIds?.has(t.id)} onClick={() => {
            if (filter === 'saved' && !trails.some((x) => x.id === t.id)) setMap({ trails: [...trails, t] })
            setMap({ selectedId: t.id })
            fitBBox(t.bbox)
          }} />
        ))}
      </ul>
      {!shown.length && status === 'idle' && !msg && filter !== 'all' && <p className="note">Nothing in this filter on the map right now.</p>}
      <p className="credit">Trails from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Always check conditions and carry a paper map in the mountains.</p>
    </div>
  )
}

const KIND_EMOJI: Record<Trail['kind'], string> = { hiking: '🥾', walking: '🚶', running: '🏃', path: '🌿' }

const pick = (t?: Trail) => (t ? { profile: t.profile, ascent: t.ascent, descent: t.descent, starred: t.starred, packIds: t.packIds } : {})

function TrailCard({ t, saved, onClick }: { t: Trail; saved: boolean; onClick: () => void }) {
  const d = difficulty(t.tags)
  const est = estimateHours(t)
  const trip = tripOf(t)
  return (
    <li>
      <button className="trail-card" onClick={onClick}>
        <span className="trail-ico" style={{ color: KIND_COLOR[t.kind] }} aria-hidden="true">{KIND_EMOJI[t.kind]}</span>
        <span className="grow">
          <span className="trail-name">{t.name}</span>
          <span className="trail-meta">
            <span className={`shape ${trip.shape}`}>{SHAPE_LABEL[trip.shape]}</span> {fmtKm(trip.km)}{trip.shape === 'out-back' ? ' return' : ''} · ~{fmtDuration(est.walk)} · {KIND_LABEL[t.kind]}
            {d && <span className={`diff d${d.level}`}>{d.label}</span>}
          </span>
        </span>
        {t.starred && <span className="badge star" title="Saved">★</span>}
        {saved && <span className="badge" title="Available offline">⬇</span>}
      </button>
    </li>
  )
}

function TrailDetail({ trail, saved, onBack, onDownload, onStart }: { trail: Trail; saved: boolean; onBack: () => void; onDownload: () => void; onStart: (t: Trail) => void }) {
  const [t, setT] = useState(trail)
  const [profileErr, setProfileErr] = useState(false)
  useEffect(() => setT(trail), [trail])
  useEffect(() => {
    if (t.profile || navigator.onLine === false) return
    let live = true
    fetchProfile(t).then(async (p) => {
      if (!live) return
      const next = { ...t, ...p }
      setT(next)
      setMap({ trails: getMap().trails.map((x) => (x.id === next.id ? next : x)) })
      if (await db.trails.get(t.id)) await db.trails.update(t.id, p)
    }).catch(() => live && setProfileErr(true))
    return () => { live = false }
  }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = difficulty(t.tags)
  const est = estimateHours(t)
  const trip = tripOf(t)
  const start = t.lines[0]?.[0] ?? bboxCenter(t.bbox)
  async function toggleStar() {
    const starred = !t.starred
    const next = { ...t, starred }
    setT(next)
    if (await db.trails.get(t.id)) await db.trails.update(t.id, { starred })
    else await saveTrails([next])
    setMap({ trails: getMap().trails.map((x) => (x.id === t.id ? next : x)) })
  }
  const info = [
    ['Surface', t.tags.surface],
    ['Marked', t.tags.trail_visibility || t.tags.osmc_symbol ? 'Yes' : undefined],
    ['Operator', t.tags.operator],
    ['From', t.tags.from],
    ['To', t.tags.to],
    ['Ref', t.tags.ref],
  ].filter(([, v]) => v) as [string, string][]
  const desc = t.tags.description || t.tags['description:en'] || t.tags.note

  return (
    <div className="tab-body">
      <button className="link-btn" onClick={onBack}>‹ All trails</button>
      <div className="row between gap" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="trail-title">{t.name}</h2>
          <p className="muted small"><span className={`shape ${trip.shape}`}>{SHAPE_LABEL[trip.shape]}</span> {isMyRoute(t) ? 'Your route' : KIND_LABEL[t.kind]}{d && <span className={`diff d${d.level}`}>{d.label}</span>}</p>
        </div>
        <button className={`icon-btn ${t.starred ? 'on' : ''}`} onClick={toggleStar} aria-label={t.starred ? 'Unsave trail' : 'Save trail'} title={t.starred ? 'Saved' : 'Save trail'}>★</button>
      </div>
      <div className="stats">
        <div><b>{fmtKm(trip.km)}</b><span>{trip.shape === 'out-back' ? 'return' : 'loop'}</span></div>
        <div><b>{trip.climb != null ? `${Math.round(trip.climb)} m` : '–'}</b><span>climb</span></div>
        <div><b>~{fmtDuration(est.walk)}</b><span>walking</span></div>
        <div><b>~{fmtDuration(est.run)}</b><span>running</span></div>
      </div>
      {trip.shape === 'out-back' && <p className="small muted out-back-note">↔ Out and back: {fmtKm(t.distanceKm)} each way{t.ascent != null ? `, ${t.ascent} m up on the way out` : ''}. Times are for the full return.</p>}
      <button className="btn primary block" onClick={() => onStart(t)}>▶ Start this trail</button>
      {t.profile ? <Profile data={t.profile} /> : <p className="note small">{profileErr ? 'Elevation profile needs a connection.' : navigator.onLine === false ? 'Elevation profile needs a connection.' : 'Loading elevation…'}</p>}
      {desc && <p>{desc}</p>}
      {info.length > 0 && (
        <dl className="info">
          {info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      <div className="row gap wrap">
        <button className="btn" onClick={() => { fitBBox(padBBox(t.bbox, 3), 14); onDownload() }}>⬇ {saved ? 'Save more of this area' : 'Save for offline'}</button>
        <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${start[0]},${start[1]}`} target="_blank" rel="noreferrer">🚗 Drive to start</a>
        {t.tags.website && <a className="btn" href={t.tags.website} target="_blank" rel="noreferrer">Website</a>}
        <a className="btn subtle" href={`https://www.openstreetmap.org/${t.id.startsWith('r') ? 'relation/' + t.id.slice(1) : 'way/' + t.id.slice(1).split('-')[0]}`} target="_blank" rel="noreferrer">Fix on OSM</a>
      </div>
      {saved && <p className="note good small">✓ Map and trail saved on this device: works without signal.</p>}
    </div>
  )
}

function agoText(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} day${h >= 36 ? 's' : ''} ago`
}
