import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type BBox, type Trail, type TrailKind } from '../db'
import { bboxCenter, fmtDuration, fmtKm, intersects, padBBox } from '../geo'
import { fitBBox, getMap, goToPlace, leaflet, setMap, useMapState } from '../mapbus'
import { importGpxFile } from '../gpx'
import { builtInTrails, driveMinutes, loadIndex, searchIndex, trailsFor, trailsNear } from '../trailindex'
import { useTrailArea, allTrailsUrl, localTrailsNamed, placesNamed, trailsNamed, type PlaceHit } from '../findtrails'
import { cachedSearch, difficulty, estimateHours, SHAPE_LABEL, tripOf, fetchProfile, FRESH_MS, KIND_LABEL, offlineTrails, searchAndSave } from '../trails'
import { KIND_COLOR } from './MapView'
import Profile from './Profile'
import TrailPhotos from './TrailPhotos'
import RouteThumb from './RouteThumb'
import SaveSheet from './SaveSheet'
import { ArrowLeftRight, Car, ChevronLeft, FileUp, ImageUp, MapPin, Mountain, X, CloudDownload, ExternalLink, Globe, PenLine, Play, Search, ShieldCheck, Star } from 'lucide-react'
import PlanPanel from './PlanPanel'
import FromPhoto from './FromPhoto'
import { isMyRoute, setPlanActive, usePlan } from '../plan'

type Filter = 'all' | TrailKind | 'saved' | 'near'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'near', label: 'Near me' },
  { id: 'hiking', label: 'Hikes' },
  { id: 'walking', label: 'Walks' },
  { id: 'running', label: 'Runs' },
  { id: 'path', label: 'Paths' },
  { id: 'saved', label: 'Saved' },
]

export default function TrailsTab({ onDownload, onStart }: { onDownload: () => void; onStart: (t: Trail) => void }) {
  const { trails, selectedId, bounds } = useMapState()
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const allGroups = useLiveQuery(() => db.groups.orderBy('createdAt').toArray(), [])
  const [searchedFor, setSearchedFor] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [builtAt, setBuiltAt] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)
  const starred = useLiveQuery(() => db.trails.filter((t) => !!t.starred).toArray(), [])
  const savedIds = useLiveQuery(async () => new Set((await db.trails.toArray()).filter((t) => t.packIds.length).map((t) => t.id)), [])
  const [q, setQ] = useState('')
  const found = useNameSearch(q)

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
    // 0. Inside Trailz's built-in trail map: instant, no trail server needed (Refresh still asks one).
    const built = force ? null : await builtInTrails(b).catch(() => null)
    if (ac.signal.aborted) return
    if (built) {
      await show(built.sort((x, y) => rank(y) - rank(x)), b)
      setSavedAt(null)
      setBuiltAt((await loadIndex())?.at ?? null)
      setStatus('idle')
      if (!built.length) setMsg('No mapped trails here yet. Try moving or zooming out the map.')
      return
    }
    setBuiltAt(null)
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
    const src = filter === 'saved' ? (starred ?? []).filter((t) => !groupFilter || t.groups?.includes(groupFilter)) : trails
    const inView = bounds && filter !== 'saved' ? src.filter((t) => intersects(t.bbox, bounds)) : src
    return filter === 'all' || filter === 'saved' || filter === 'near' ? inView : inView.filter((t) => t.kind === filter)
  }, [trails, filter, bounds, starred, groupFilter])

  const selected = trails.find((t) => t.id === selectedId) ?? starred?.find((t) => t.id === selectedId)
  const [fromPhoto, setFromPhoto] = useState(false)
  const planning = usePlan().active
  if (planning) return <PlanPanel onSaved={() => setFilter('saved')} />
  if (selected) return <TrailDetail trail={selected} saved={!!savedIds?.has(selected.id)} onBack={() => setMap({ selectedId: null })} onDownload={onDownload} onStart={onStart} />

  function openTrail(t: Trail) {
    if (!getMap().trails.some((x) => x.id === t.id)) setMap({ trails: [...getMap().trails, t] })
    setMap({ selectedId: t.id })
    fitBBox(t.bbox)
  }
  function openPlace(p: PlaceHit) {
    const m = leaflet()
    setQ('')
    // Once the map has moved there, look for trails around it.
    m?.once('moveend', () => setTimeout(() => void search(), 50))
    goToPlace(p)
    if (!m) void search()
  }

  const searchBox = (
    <form className="name-search" role="search" onSubmit={(e) => { e.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}>
      <Search size={17} aria-hidden="true" />
      <input type="search" enterKeyHint="search" placeholder="Search trails, towns or peaks" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trails or places by name" autoCorrect="off" />
      {q && <button type="button" className="icon-btn sm" onClick={() => setQ('')} aria-label="Clear search"><X size={16} /></button>}
    </form>
  )

  if (q.trim()) {
    const list = found.trails
    const nq = q.trim().toLowerCase()
    const placeFirst = found.places.length > 0 && found.places[0].name.toLowerCase().startsWith(nq) && !list.some((t) => t.name.toLowerCase().startsWith(nq))
    const placesBlock = (
      found.places.length > 0 && <>
          <h3 className="section-h">Places</h3>
          <ul className="place-list">
            {found.places.map((p) => (
              <li key={p.id}>
                <button className="place-row" onClick={() => openPlace(p)}>
                  <span className="place-ico"><MapPin size={17} /></span>
                  <span className="grow"><b>{p.name}</b><span className="muted tiny">{p.sub}</span></span>
                  <span className="muted tiny">Trails here</span>
                </button>
              </li>
            ))}
          </ul>
        </>
    )
    return (
      <div className="tab-body">
        {searchBox}
        {placeFirst && placesBlock}
        {list.length > 0 && <h3 className="section-h">Trails</h3>}
        <ul className="trail-list">
          {list.map((t) => <TrailCard key={t.id} t={t} saved={!!savedIds?.has(t.id)} onClick={() => openTrail(t)} />)}
        </ul>
        {!placeFirst && placesBlock}
        {found.busy && <p className="note small"><span className="spin" /> Searching all trails{found.trails.length ? ' for more' : ''}…</p>}
        {!found.busy && !list.length && !found.places.length && found.done && (
          <p className="note">{found.err || `Nothing called “${q.trim()}” yet. Try fewer words, or a nearby town or peak.`}</p>
        )}
        {found.err && (list.length > 0 || found.places.length > 0) && <p className="note small">{found.err}</p>}
        <p className="credit">Trails and places from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.</p>
      </div>
    )
  }

  return (
    <div className="tab-body">
      {searchBox}
      <div className="row gap">
        <button className={`btn primary grow ${moved ? 'pulse' : ''}`} onClick={() => search()} disabled={status === 'loading'}>
          {status === 'loading' ? <span className="spin" /> : <Search size={18} strokeWidth={2.4} />} {status === 'loading' ? 'Sniffing out trails…' : moved ? 'Search this area' : 'Find trails on the map'}
        </button>
        <button className="btn" onClick={() => { setMap({ selectedId: null }); setPlanActive(true) }} title="Draw your own route on the map"><PenLine size={17} /> Plan</button>
      </div>
      <div className="import-row">
      <button className="link-btn" onClick={() => setFromPhoto(true)}><ImageUp size={15} aria-hidden="true" /> Trail from a picture</button>
      {fromPhoto && <FromPhoto onClose={() => setFromPhoto(false)} />}
      <label className="link-btn gpx-import">
        <FileUp size={15} aria-hidden="true" /> Import a GPX file
        <input type="file" hidden onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const t = await importGpxFile(f)
            setStatus('idle')
            setMsg('')
            openTrail(t)
          } catch (err) {
            setStatus('error')
            setMsg((err as Error).message)
          }
        }} />
      </label>
      </div>
      {builtAt && !savedAt && status !== 'loading' && !moved && filter !== 'near' && (
        <p className="tiny muted saved-at">
          From Trailz's built-in trail map, updated {new Date(builtAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}.{' '}
          <button className="link-btn" onClick={() => search(true)}>Check for newer trails</button>
        </p>
      )}
      {savedAt && status !== 'loading' && !moved && (
        <p className="tiny muted saved-at">
          Trails saved {agoText(savedAt)}, so they load instantly.{' '}
          <button className="link-btn" onClick={() => search(true)}>Refresh</button>
        </p>
      )}
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
            {f.id === 'saved' && <Star size={13} strokeWidth={2.5} />}{f.label}
          </button>
        ))}
      </div>
      {filter === 'saved' && !!allGroups?.length && (
        <div className="chips group-chips" role="group" aria-label="Groups">
          <button className={`chip ${!groupFilter ? 'on' : ''}`} onClick={() => setGroupFilter(null)}>All saved</button>
          {allGroups.map((g) => (
            <button key={g.id} className={`chip ${groupFilter === g.id ? 'on' : ''}`} onClick={() => setGroupFilter(g.id)}>
              {g.name} <span className="chip-n">{(starred ?? []).filter((t) => t.groups?.includes(g.id)).length}</span>
            </button>
          ))}
        </div>
      )}
      {filter === 'near' && <NearMe saved={savedIds} onOpen={(t) => { if (!trails.some((x) => x.id === t.id)) setMap({ trails: [...trails, t] }); setMap({ selectedId: t.id }); fitBBox(t.bbox) }} />}
      {msg && filter !== 'near' && <p className={`note ${status === 'error' ? 'error' : ''}`}>{msg}</p>}
      {filter !== 'near' && <ul className="trail-list">
        {shown.map((t) => (
          <TrailCard key={t.id} t={t} saved={!!savedIds?.has(t.id)} onClick={() => {
            if (filter === 'saved' && !trails.some((x) => x.id === t.id)) setMap({ trails: [...trails, t] })
            setMap({ selectedId: t.id })
            fitBBox(t.bbox)
          }} />
        ))}
      </ul>}
      {!shown.length && status === 'idle' && !msg && filter !== 'all' && filter !== 'near' && <p className="note">Nothing in this filter on the map right now.</p>}
      <p className="credit">Trails from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors. Always check conditions and carry a paper map in the mountains.</p>
    </div>
  )
}

const pick = (t?: Trail) => (t ? { profile: t.profile, ascent: t.ascent, descent: t.descent, starred: t.starred, groups: t.groups, packIds: t.packIds } : {})

function TrailCard({ t, saved, onClick, away }: { t: Trail; saved: boolean; onClick: () => void; away?: string }) {
  const d = difficulty(t.tags)
  const est = estimateHours(t)
  const trip = tripOf(t)
  return (
    <li>
      <button className="trail-card" onClick={onClick}>
        <span className="thumb-tile"><RouteThumb lines={t.lines} color={KIND_COLOR[t.kind]} /></span>
        <span className="grow">
          <span className="trail-name">{t.name}</span>
          <span className="trail-meta">{away && <b className="away">{away} · </b>}{fmtKm(trip.km)}{trip.shape === 'out-back' ? ' return' : ''} · ~{fmtDuration(est.walk)} · {KIND_LABEL[t.kind]}</span>
          <span className="trail-tags sm">
            <span className={`shape ${trip.shape}`}>{SHAPE_LABEL[trip.shape]}</span>
            {d && <span className={`diff d${d.level}`}>{d.label}</span>}
          </span>
        </span>
        {t.starred && <span className="badge star" title="Saved"><Star size={14} fill="currentColor" /></span>}
        {saved && <span className="badge" title="Available offline"><CloudDownload size={14} /></span>}
      </button>
    </li>
  )
}

function TrailDetail({ trail, saved, onBack, onDownload, onStart }: { trail: Trail; saved: boolean; onBack: () => void; onDownload: () => void; onStart: (t: Trail) => void }) {
  const [t, setT] = useState(trail)
  const [profileErr, setProfileErr] = useState(false)
  const area = useTrailArea(trail)
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
  const [saveOpen, setSaveOpen] = useState(false)
  const groupNames = useLiveQuery(async () => {
    const all = await db.groups.toArray()
    return all.filter((g) => t.groups?.includes(g.id)).map((g) => g.name)
  }, [t.groups])
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
      <div className="detail-bar"><button className="link-btn back" onClick={onBack}><ChevronLeft size={18} /> All trails</button></div>
      <div className="row between gap" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="trail-title">{t.name}</h2>
          <div className="trail-tags">
            <span className={`shape ${trip.shape}`}>{SHAPE_LABEL[trip.shape]}</span>
            {d && <span className={`diff d${d.level}`}>{d.label}</span>}
            <span className="kind-tag">{isMyRoute(t) ? 'Your route' : t.tags.source === 'gpx' ? 'Imported GPX' : KIND_LABEL[t.kind]}</span>
          </div>
          {t.tags['trailz:named'] === 'guessed' && <p className="muted tiny guessed-name">No name on the map, so it's named after where it goes.</p>}
        </div>
        <button className={`icon-btn ${t.starred ? 'on' : ''}`} onClick={() => setSaveOpen(true)} aria-label={t.starred ? 'Saved: change groups' : 'Save trail'} title={t.starred ? 'Saved' : 'Save trail'}><Star size={22} fill={t.starred ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="stats">
        <div><b>{fmtKm(trip.km)}</b><span>{trip.shape === 'out-back' ? 'return' : 'loop'}</span></div>
        <div><b>{trip.climb != null ? `${Math.round(trip.climb)} m` : '–'}</b><span>climb</span></div>
        <div><b>~{fmtDuration(est.walk)}</b><span>walking</span></div>
        <div><b>~{fmtDuration(est.run)}</b><span>running</span></div>
      </div>
      {t.starred && groupNames && groupNames.length > 0 && (
        <div className="chips in-groups">{groupNames.map((n) => <button key={n} className="chip small-chip" onClick={() => setSaveOpen(true)}><Star size={12} fill="currentColor" /> {n}</button>)}</div>
      )}
      {saveOpen && <SaveSheet trail={t} onClose={() => setSaveOpen(false)} onSaved={(n) => setT(n)} />}
      {trip.shape === 'out-back' && <p className="small muted out-back-note"><ArrowLeftRight size={15} /> Out and back: {fmtKm(t.distanceKm)} each way{t.ascent != null ? `, ${t.ascent} m up on the way out` : ''}. Times are for the full return.</p>}
      <button className="btn primary block" onClick={() => onStart(t)}><Play size={17} fill="currentColor" /> Start this trail</button>
      <TrailPhotos trail={t} />
      {t.profile ? <Profile data={t.profile} /> : <p className="note small">{profileErr ? 'Elevation profile needs a connection.' : navigator.onLine === false ? 'Elevation profile needs a connection.' : 'Loading elevation…'}</p>}
      {desc && <p>{desc}</p>}
      {info.length > 0 && (
        <dl className="info">
          {info.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      <div className="row gap wrap">
        <button className="btn" onClick={() => { fitBBox(padBBox(t.bbox, 3), 14); onDownload() }}><CloudDownload size={17} /> {saved ? 'Save more of this area' : 'Save for offline'}</button>
        <a className="btn" href={`https://www.google.com/maps/dir/?api=1&destination=${start[0]},${start[1]}`} target="_blank" rel="noreferrer"><Car size={17} /> Drive to start</a>
        {!isMyRoute(t) && t.tags.source !== 'gpx' && <a className="btn" href={allTrailsUrl(t, area)} target="_blank" rel="noreferrer"><Mountain size={16} /> Find on AllTrails</a>}
        {t.tags.website && <a className="btn" href={t.tags.website} target="_blank" rel="noreferrer"><Globe size={16} /> Website</a>}
        <a className="btn subtle" href={`https://www.openstreetmap.org/${t.id.startsWith('r') ? 'relation/' + t.id.slice(1) : 'way/' + t.id.slice(1).split('-')[0]}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Fix on OSM</a>
      </div>
      {saved && <p className="note good small"><ShieldCheck size={16} /> Map and trail saved on this device: works without signal.</p>}
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

/** Name search: trails on this phone straight away, then all trails in the country and matching places. */
function useNameSearch(q: string) {
  const [r, setR] = useState<{ trails: Trail[]; places: PlaceHit[]; busy: boolean; done: boolean; err: string }>({ trails: [], places: [], busy: false, done: false, err: '' })
  useEffect(() => {
    const text = q.trim()
    if (!text) { setR({ trails: [], places: [], busy: false, done: false, err: '' }); return }
    const ac = new AbortController()
    let local: Trail[] = []
    const merge = (a: Trail[], b: Trail[]) => [...new Map([...a, ...b].map((t) => [t.id, t])).values()]
    const here = (() => { const b = getMap().bounds; return b ? bboxCenter(b) : savedViewCenter() })()
    let fromMap = 0
    void Promise.all([localTrailsNamed(text), searchIndex(text, here).then(trailsFor)]).then(([l, idx]) => {
      if (ac.signal.aborted) return
      local = merge(l, idx)
      fromMap = idx.length
      setR((x) => ({ ...x, trails: local, done: false, err: '' }))
    })
    const t = setTimeout(async () => {
      if (text.length < 3) { setR((x) => ({ ...x, busy: false, done: true })); return }
      if (navigator.onLine === false) { setR((x) => ({ ...x, busy: false, done: true, err: 'Offline: showing trails already on your phone.' })); return }
      setR((x) => ({ ...x, busy: true }))
      const b = getMap().bounds
      const center = b ? bboxCenter(b) : savedViewCenter()
      // The built-in map already searched the whole region: only ask the slow trail servers when it found nothing.
      const idx = await loadIndex()
      const covered = !!idx && center[0] >= idx.region[0] && center[0] <= idx.region[2] && center[1] >= idx.region[1] && center[1] <= idx.region[3]
      const [trails, places] = await Promise.allSettled([covered && fromMap > 0 ? Promise.resolve([]) : trailsNamed(text, center, ac.signal), placesNamed(text, center, ac.signal)])
      if (ac.signal.aborted) return
      const remote = trails.status === 'fulfilled' ? trails.value : []
      setR({
        trails: merge(local, remote),
        places: places.status === 'fulfilled' ? places.value : [],
        busy: false,
        done: true,
        err: trails.status === 'rejected' && !local.length ? 'The trail servers are busy, so only some results are showing. Try again in a minute.' : '',
      })
    }, 700)
    return () => { clearTimeout(t); ac.abort() }
  }, [q])
  return r
}

const savedViewCenter = (): [number, number] => {
  const c = leaflet()?.getCenter()
  return c ? [c.lat, c.lng] : [-29.035, 29.37]
}

const rank = (t: Trail) => (t.kind === 'path' ? 0 : 100) + (t.tags.name ? 20 : t.tags['trailz:named'] === 'guessed' ? 10 : 0) + Math.min(t.distanceKm, 40)

const NEAR_KEY = 'trailz.nearMinutes'

/** Trails within a 30-minute (default) or 1-hour drive of where you are, wherever the map is. */
function NearMe({ saved, onOpen }: { saved?: Set<string>; onOpen: (t: Trail) => void }) {
  const [minutes, setMinutes] = useState<number>(() => { try { return Number(localStorage.getItem(NEAR_KEY)) || 30 } catch { return 30 } })
  const [list, setList] = useState<{ t: Trail; km: number }[] | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    setList(null)
    setErr('')
    ;(async () => {
      let me = getMap().me
      if (!me) {
        try {
          const p = await new Promise<GeolocationPosition>((ok, no) => navigator.geolocation.getCurrentPosition(ok, no, { enableHighAccuracy: false, maximumAge: 300000, timeout: 15000 }))
          me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }
        } catch {
          if (alive) setErr('Turn on location for Trailz to see trails near you.')
          return
        }
      }
      if (!(await loadIndex())) { if (alive) setErr('Near me needs the built-in trail map, which this version doesn\'t have.'); return }
      const near = await trailsNear([me.lat, me.lng], minutes)
      const full = await trailsFor(near.map((x) => x.e))
      const km = new Map(near.map((x) => [x.e[0], x.km]))
      if (alive) setList(full.map((t) => ({ t, km: km.get(t.id) ?? 0 })))
    })()
    return () => { alive = false }
  }, [minutes])
  const pickMin = (m: number) => { setMinutes(m); try { localStorage.setItem(NEAR_KEY, String(m)) } catch { /* ignore */ } }
  return (
    <>
      <div className="near-seg" role="group" aria-label="Driving time">
        {[30, 60].map((m) => <button key={m} className={minutes === m ? 'on' : ''} aria-pressed={minutes === m} onClick={() => pickMin(m)}>{m === 60 ? '1 hour' : '30 min'} drive</button>)}
      </div>
      {err && <p className="note">{err}</p>}
      {!err && !list && <p className="note small"><span className="spin" /> Finding trails near you…</p>}
      {list && !list.length && <p className="note">No mapped trails within a {minutes === 60 ? '1-hour' : '30-minute'} drive.{minutes === 30 ? ' Try 1 hour.' : ''}</p>}
      {list && list.length > 0 && (
        <ul className="trail-list">
          {list.map(({ t, km }) => (
            <TrailCard key={t.id} t={t} saved={!!saved?.has(t.id)} away={`~${Math.max(5, Math.round(driveMinutes(km) / 5) * 5)} min drive`} onClick={() => onOpen(t)} />
          ))}
        </ul>
      )}
    </>
  )
}
