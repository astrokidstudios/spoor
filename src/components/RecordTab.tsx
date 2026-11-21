import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Activity, type LatLng, type Walk } from '../db'
import { bboxOf, fmtKm, padBBox } from '../geo'
import { fitBBox, getMap, setMap, useMapState } from '../mapbus'
import { ACTIVITY_LABEL, addPhotos, deleteWalk, elapsedMs, finishWalk, pauseWalk, renameWalk, resumeWalk, startWalk, useRec } from '../record'
import { useSettings } from '../settings'
import { tripOf } from '../trails'

export default function RecordTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { walk } = useRec()
  const [viewId, setViewId] = useState<string | null>(null)
  const walks = useLiveQuery(() => db.walks.where('status').equals('done').reverse().sortBy('startedAt'), [])
  const viewed = walks?.find((w) => w.id === viewId)

  useEffect(() => () => setMap({ track: null }), [])

  if (walk) return <ActiveWalk walk={walk} />
  if (viewed) return <WalkDetail walk={viewed} onBack={() => setViewId(null)} />
  return (
    <div className="tab-body">
      <StartCard onOpenSettings={onOpenSettings} />
      <h3 className="section-h">Your walks</h3>
      {!walks?.length && <p className="note">Walks you record show up here, with the route, stats and photos. They're kept on this device.</p>}
      <ul className="walk-list">
        {walks?.map((w) => (
          <li key={w.id}>
            <button className="trail-card" onClick={() => setViewId(w.id)}>
              <span className="walk-icon">{w.activity === 'run' ? '🏃' : w.activity === 'hike' ? '🥾' : '🚶'}</span>
              <span className="grow">
                <span className="trail-name">{w.name}</span>
                <span className="trail-meta">{new Date(w.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · {fmtKm(w.distanceKm)} · {fmtClock(w.activeMs)} · {Math.round(w.calories)} kcal</span>
              </span>
              <PhotoCount walkId={w.id} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StartCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [activity, setActivity] = useState<Activity>('hike')
  const { trails, selectedId } = useMapState()
  const settings = useSettings()
  const sel = trails.find((t) => t.id === selectedId)
  const [follow, setFollow] = useState(true)
  return (
    <div className="card record-start">
      <div className="chips">
        {(['walk', 'hike', 'run'] as Activity[]).map((a) => (
          <button key={a} className={`chip ${activity === a ? 'on' : ''}`} onClick={() => setActivity(a)}>{ACTIVITY_LABEL[a]}</button>
        ))}
      </div>
      {sel ? (
        <label className="row gap small follow-opt">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          <span>Follow <b>{sel.name}</b> ({fmtKm(tripOf(sel).km)}{tripOf(sel).shape === 'out-back' ? ' there and back' : ' loop'}) and show my progress</span>
        </label>
      ) : (
        <p className="muted small">To see your progress along a trail, open it in Trails and tap <b>▶ Start this trail</b>.</p>
      )}
      <button className="btn primary block big-start" onClick={() => void startWalk({ activity, trail: sel && follow ? sel : null })}>▶ Start {ACTIVITY_LABEL[activity].toLowerCase()}</button>
      <p className="muted tiny">
        Calories use your weight ({settings.weightKg} kg). <button className="link-btn" onClick={onOpenSettings}>Change</button>
      </p>
    </div>
  )
}

function useTick(on: boolean) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setN((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [on])
}

function useTrackOnMap(walk: Walk, follow: boolean) {
  const photos = useLiveQuery(() => db.photos.where('walkId').equals(walk.id).toArray(), [walk.id])
  const guide = useLiveQuery(async () => (walk.trailId ? (await db.trails.get(walk.trailId))?.lines : undefined), [walk.trailId])
  useEffect(() => {
    setMap({
      track: {
        lines: linesOf(walk),
        photos: (photos ?? []).filter((p) => p.lat != null).map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng! })),
        guide,
      },
      ...(follow ? {} : { selectedId: null }),
    })
  }, [walk, photos, guide, follow])
  return photos
}

function ActiveWalk({ walk }: { walk: Walk }) {
  const { progress, gpsError } = useRec()
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [added, setAdded] = useState('')
  const recording = walk.status === 'recording'
  useTick(recording)
  const photos = useTrackOnMap(walk, true)
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current) return
    fitted.current = true
    if (walk.trailId) void db.trails.get(walk.trailId).then((t) => t && fitBBox(padBBox(t.bbox, 0.3)))
    else setMap({ follow: true })
  }, [walk.trailId])

  const ms = elapsedMs(walk)
  const hours = ms / 3600000
  const pace = walk.distanceKm > 0.05 ? ms / 60000 / walk.distanceKm : 0
  const off = progress?.offTrailM ?? null

  async function onPhotos(files: FileList | null, camera: boolean) {
    if (!files?.length) return
    const n = await addPhotos(walk.id, files, camera)
    setAdded(n ? `${n} photo${n > 1 ? 's' : ''} added` : '')
    setTimeout(() => setAdded(''), 3000)
  }

  return (
    <div className="tab-body">
      <div className="row between">
        <div>
          <h2 className="trail-title">{walk.name}</h2>
          <p className={`small ${recording ? 'rec-on' : 'muted'}`}>{recording ? '● Recording' : '❚❚ Paused'}{walk.trailName ? ` · following ${walk.trailName}` : ''}</p>
        </div>
      </div>
      <div className="rec-time">{fmtClock(ms, true)}</div>
      <div className="stats">
        <div><b>{fmtKm(walk.distanceKm)}</b><span>distance</span></div>
        <div><b>{Math.round(walk.ascent)} m</b><span>climb</span></div>
        <div><b>{Math.round(walk.calories)}</b><span>kcal</span></div>
        <div><b>{walk.activity === 'run' ? (pace ? fmtPace(pace) : '–') : hours > 0.01 && walk.distanceKm > 0.05 ? `${(walk.distanceKm / hours).toFixed(1)}` : '–'}</b><span>{walk.activity === 'run' ? 'min/km' : 'km/h'}</span></div>
      </div>
      {progress && (
        <div className="trail-progress">
          <div className="row between small"><b>{fmtKm(progress.doneKm)} done</b><span>{fmtKm(progress.leftKm)} to go{walk.trailShape === 'out-back' ? ' (there and back)' : ''}</span></div>
          <div className="bar"><span style={{ width: `${progress.pct}%` }} /></div>
          {off != null && (off > 60
            ? <p className="note error small">⚠ You're about {off >= 1000 ? fmtKm(off / 1000) : `${Math.round(off / 10) * 10} m`} off the trail. Check the map.</p>
            : <p className="small good">✓ On the trail</p>)}
        </div>
      )}
      {gpsError && <p className="note small">{gpsError}</p>}
      {!walk.points.length && !gpsError && recording && <p className="muted small">Waiting for a GPS fix…</p>}
      <div className="rec-controls">
        {recording
          ? <button className="btn block" onClick={() => void pauseWalk()}>❚❚ Pause</button>
          : <button className="btn primary block" onClick={() => void resumeWalk()}>▶ Resume</button>}
        <PhotoButtons onFiles={onPhotos} />
        <button className={`btn block ${confirmEnd ? 'danger' : ''}`} onClick={async () => {
          if (!confirmEnd) { setConfirmEnd(true); setTimeout(() => setConfirmEnd(false), 4000); return }
          const done = await finishWalk()
          if (done) setMap({ follow: false })
        }}>{confirmEnd ? 'Tap again to finish' : '■ Finish'}</button>
      </div>
      {added && <p className="small good">{added}</p>}
      <PhotoStrip photos={photos ?? []} />
      <p className="muted tiny">Keep Spoor open while you walk{' '}
        {'standalone' in navigator || matchMedia('(display-mode: standalone)').matches ? '' : '(or use the iPhone app) '}
        so it keeps recording. Time doesn't count while paused.</p>
    </div>
  )
}

function WalkDetail({ walk, onBack }: { walk: Walk; onBack: () => void }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const [name, setName] = useState(walk.name)
  const photos = useTrackOnMap(walk, false)
  useEffect(() => {
    const pts = walk.points.map((p) => [p.lat, p.lng] as LatLng)
    if (pts.length) fitBBox(padBBox(bboxOf([pts]), 0.2))
  }, [walk.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const hours = walk.activeMs / 3600000
  const pace = walk.distanceKm > 0.05 ? walk.activeMs / 60000 / walk.distanceKm : 0
  return (
    <div className="tab-body">
      <button className="link-btn" onClick={onBack}>‹ All walks</button>
      <input className="input title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== walk.name && void renameWalk(walk.id, name.trim())} aria-label="Walk name" />
      <p className="muted small">{ACTIVITY_LABEL[walk.activity]} · {new Date(walk.startedAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{walk.trailName ? ` · ${walk.trailName}` : ''}</p>
      <div className="stats">
        <div><b>{fmtKm(walk.distanceKm)}</b><span>distance</span></div>
        <div><b>{fmtClock(walk.activeMs)}</b><span>time</span></div>
        <div><b>{Math.round(walk.ascent)} m</b><span>climb</span></div>
        <div><b>{Math.round(walk.calories)}</b><span>kcal</span></div>
      </div>
      <p className="muted small">
        {pace ? `Average ${fmtPace(pace)} min/km (${(walk.distanceKm / Math.max(hours, 0.001)).toFixed(1)} km/h)` : ''}
        {walk.descent ? ` · ${Math.round(walk.descent)} m down` : ''}
        
      </p>
      <PhotoButtons onFiles={async (f, cam) => { if (f?.length) await addPhotos(walk.id, f, cam) }} />
      <PhotoStrip photos={photos ?? []} big />
      <button className={`btn ${confirmDel ? 'danger' : 'subtle'}`} onClick={async () => {
        if (!confirmDel) { setConfirmDel(true); setTimeout(() => setConfirmDel(false), 4000); return }
        await deleteWalk(walk.id)
        setMap({ track: null })
        onBack()
      }}>{confirmDel ? 'Tap again to delete this walk' : 'Delete walk'}</button>
    </div>
  )
}

function PhotoButtons({ onFiles }: { onFiles: (f: FileList | null, camera: boolean) => void }) {
  const cam = useRef<HTMLInputElement>(null)
  const lib = useRef<HTMLInputElement>(null)
  return (
    <div className="row gap photo-btns">
      <button className="btn grow" onClick={() => cam.current?.click()}>📷 Take photo</button>
      <button className="btn grow" onClick={() => lib.current?.click()}>🖼 Add from photos</button>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files, true); e.target.value = '' }} />
      <input ref={lib} type="file" accept="image/*" multiple hidden aria-label="Add photos" onChange={(e) => { onFiles(e.target.files, false); e.target.value = '' }} />
    </div>
  )
}

function PhotoStrip({ photos, big }: { photos: { id: string; blob: Blob; lat?: number; lng?: number }[]; big?: boolean }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    const next: Record<string, string> = {}
    for (const p of photos) next[p.id] = URL.createObjectURL(p.blob)
    setUrls(next)
    return () => Object.values(next).forEach((u) => URL.revokeObjectURL(u))
  }, [photos])
  if (!photos.length) return null
  const cur = photos.find((p) => p.id === open)
  return (
    <>
      <div className={`photo-strip ${big ? 'big' : ''}`}>
        {photos.map((p) => urls[p.id] && (
          <button key={p.id} className="photo-thumb" onClick={() => setOpen(p.id)}><img src={urls[p.id]} alt="Walk photo" /></button>
        ))}
      </div>
      {cur && urls[cur.id] && (
        <div className="modal-back" onClick={() => setOpen(null)}>
          <div className="photo-view" onClick={(e) => e.stopPropagation()}>
            <button className="modal-x" onClick={() => setOpen(null)} aria-label="Close">×</button>
            <img src={urls[cur.id]} alt="Walk photo" />
            {cur.lat != null && <button className="btn small" onClick={() => { setOpen(null); setMap({ follow: false }); getMap(); fitBBox(padBBox([cur.lat!, cur.lng!, cur.lat!, cur.lng!], 0.15), 16) }}>Show on map</button>}
          </div>
        </div>
      )}
    </>
  )
}

function PhotoCount({ walkId }: { walkId: string }) {
  const n = useLiveQuery(() => db.photos.where('walkId').equals(walkId).count(), [walkId])
  return n ? <span className="badge" title={`${n} photos`}>📷 {n}</span> : null
}

function linesOf(w: Walk): LatLng[][] {
  const out: LatLng[][] = []
  let seg = -1
  for (const p of w.points) {
    if (p.seg !== seg) { out.push([]); seg = p.seg }
    out[out.length - 1].push([p.lat, p.lng])
  }
  return out
}

export function fmtClock(ms: number, seconds = false) {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (seconds) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

const fmtPace = (minPerKm: number) => `${Math.floor(minPerKm)}:${String(Math.round((minPerKm % 1) * 60)).padStart(2, '0')}`
