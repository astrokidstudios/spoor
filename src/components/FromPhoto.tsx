import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Flag, ImageUp, MapPin, PenLine, Route, X } from 'lucide-react'
import { findPlaces, fitPicture, imageSize, readFacts, readText, visitOrder, type FoundPlace, type PictureFacts } from '../fromphoto'
import { getMap, leaflet, setMap } from '../mapbus'
import { addPoint, clearPlan, planThrough, setMagnetic, setPlanActive, setPlanMeta, setPlanMode } from '../plan'
import type { LatLng } from '../db'

type Step = 'pick' | 'reading' | 'finding' | 'choose' | 'error'

/** Campsites, huts, car parks and trailheads are where walks usually start. */
const startish = (p: FoundPlace) => /campsite|hut|trailhead|parking|car park/i.test(p.sub) ? 1 : 0

/**
 * Rebuild a trail from a picture: the names on it line the picture up with the map, then you trace
 * the route over it (each tap snaps to real paths). Or join up named places along the paths.
 */
export default function FromPhoto({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick')
  const [err, setErr] = useState('')
  const [facts, setFacts] = useState<PictureFacts | null>(null)
  const [places, setPlaces] = useState<FoundPlace[]>([])
  const [startId, setStartId] = useState<string>('')
  const [name, setName] = useState('')
  const [loop, setLoop] = useState(true)
  const [extra, setExtra] = useState('')
  const [pic, setPic] = useState<{ file: File; w: number; h: number } | null>(null)
  const ac = useRef<AbortController | null>(null)

  useEffect(() => {
    document.documentElement.classList.add('modal-open')
    return () => { document.documentElement.classList.remove('modal-open'); ac.current?.abort() }
  }, [])

  const near = (): LatLng => {
    const me = getMap().me
    if (me) return [me.lat, me.lng]
    const c = leaflet()?.getCenter()
    return c ? [c.lat, c.lng] : [-29.035, 29.37]
  }

  async function read(f: File) {
    ac.current?.abort()
    const a = (ac.current = new AbortController())
    setErr('')
    setStep('reading')
    try {
      const size = await imageSize(f).catch(() => ({ w: 1000, h: 2000 }))
      setPic({ file: f, ...size })
      const lines = await readText(f)
      if (a.signal.aborted) return
      const fx = readFacts(lines)
      setFacts(fx)
      setName(fx.title)
      setLoop(/loop|circuit|circular/i.test(fx.title) || !fx.title)
      setStep('finding')
      // Names are for lining up and choosing the start, not stops: nothing is ticked to begin with.
      const found = (await findPlaces(fx, near(), a.signal)).map((p) => ({ ...p, on: false }))
      if (a.signal.aborted) return
      setPlaces(found)
      const start = [...found].sort((x, y) => startish(y) - startish(x))[0]
      setStartId(start && startish(start) ? start.id : '')
      setStep('choose')
    } catch (e) {
      if (a.signal.aborted) return
      setErr((e as Error).message || "Couldn't read that picture.")
      setStep('error')
    }
  }

  async function addName() {
    const q = extra.trim()
    if (!q) return
    setExtra('')
    const fx: PictureFacts = { title: '', km: null, climb: null, names: [{ text: q, x: 0.5, y: 0.5 }] }
    const [p] = await findPlaces(fx, near()).catch(() => [])
    if (p && !places.some((x) => x.id === p.id)) setPlaces([...places, { ...p, on: true }])
    else if (!p) setErr(`Couldn't find a place called “${q}” nearby.`)
  }

  const start = places.find((p) => p.id === startId) ?? null
  const corners = pic ? fitPicture(places, pic.w, pic.h) : null

  /** Lay the picture over the map and start a route at the start; you tap the rest. */
  async function trace() {
    if (!pic || !corners) return
    const url = URL.createObjectURL(pic.file)
    onClose()
    clearPlan()
    setPlanMode('walk')
    setMagnetic(true)
    setMap({ selectedId: null, pin: null, overlay: { url, corners, shown: true } })
    setPlanActive(true)
    setPlanMeta(name, facts?.km ?? null)
    leaflet()?.fitBounds(corners, { padding: [10, 10] })
    if (start) await addPoint(start.at)
  }

  async function build() {
    const chosen = places.filter((p) => p.on && p.id !== startId).map((p) => p.at)
    const pts = start ? [start.at, ...visitOrder(chosen)] : visitOrder(chosen)
    onClose()
    setMap({ selectedId: null, pin: null })
    await planThrough(pts, loop, name, facts?.km ?? null)
  }

  const move = (i: number, d: -1 | 1) => setPlaces((ps) => {
    const out = [...ps]
    const j = i + d
    if (j < 0 || j >= out.length) return ps
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
  const stops = places.filter((p) => p.on && p.id !== startId).length + (start ? 1 : 0)

  return createPortal(
    <div className="fullsheet-back" role="dialog" aria-modal="true" aria-label="Rebuild a trail from a picture">
      <div className="fullsheet from-photo">
        <div className="fullsheet-head">
          <ImageUp size={20} aria-hidden="true" />
          <h3 className="grow">Trail from a picture</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <div className="fullsheet-body">
          {(step === 'pick' || step === 'error') && (
            <>
              <p className="muted">Pick a screenshot of a trail map. Trailz reads the place names on it, lines it up with the map, and lays it over the map so you can trace the route. Each tap snaps to the real path.</p>
              <label className="btn primary from-photo-pick">
                <ImageUp size={18} /> Choose a picture
                <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void read(f) }} />
              </label>
              {err && <p className="note error">{err}</p>}
            </>
          )}
          {(step === 'reading' || step === 'finding') && (
            <p className="note"><span className="spin" /> {step === 'reading' ? 'Reading the picture…' : 'Finding the places on it…'}</p>
          )}
          {step === 'choose' && facts && (
            <>
              <label className="field">
                <span className="small muted">Name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="My route" aria-label="Route name" />
              </label>
              {facts.km != null && <p className="small muted">The picture says <b>{facts.km} km</b>{facts.climb ? <> and <b>{facts.climb} m</b> up</> : null}. You'll see how close yours gets.</p>}
              {corners
                ? <p className="note small">Lined up with the map using {places.length} places on the picture.</p>
                : <p className="note small">Couldn't line this picture up with the map (it needs at least two places Trailz can find). You can still join up places below.</p>}
              <p className="small"><b>Where does it start?</b> <span className="muted">(often a campsite or car park, or a round marker on the line)</span></p>
              {!places.length && <p className="note">No places found on that picture. Add their names below.</p>}
              <ul className="from-photo-list">
                {places.map((p, i) => (
                  <li key={p.id} className={p.on || p.id === startId ? 'on' : ''}>
                    <button className={`from-photo-start ${p.id === startId ? 'is' : ''}`} aria-pressed={p.id === startId} aria-label={`Start at ${p.name}`} title="Start here" onClick={() => setStartId(p.id === startId ? '' : p.id)}>
                      <Flag size={15} />
                    </button>
                    <MapPin size={16} aria-hidden="true" />
                    <span className="grow one-line"><b>{p.name}</b><span className="muted tiny">{p.id === startId ? 'Start' : p.sub}</span></span>
                    <button className="from-photo-check" aria-pressed={p.on} aria-label={`${p.on ? 'Not a stop' : 'A stop on the route'}: ${p.name}`} title="A stop on the route" onClick={() => setPlaces((ps) => ps.map((x) => (x.id === p.id ? { ...x, on: !x.on } : x)))}>
                      {p.on ? <Check size={16} /> : null}
                    </button>
                    <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>↑</button>
                    <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === places.length - 1} aria-label={`Move ${p.name} down`}>↓</button>
                  </li>
                ))}
              </ul>
              <p className="tiny muted">Flag: where it starts. Tick: places the route actually goes to (only needed for “Join up places”).</p>
              <div className="row gap">
                <input className="input grow" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addName()} placeholder="Add a place it passes" aria-label="Add a place" enterKeyHint="done" />
                <button className="btn" onClick={() => void addName()} disabled={!extra.trim()}>Add</button>
              </div>
              {err && <p className="note error">{err}</p>}
              <div className="seg" role="group" aria-label="Route shape">
                <button className={loop ? 'on' : ''} onClick={() => setLoop(true)}>Loop back to start</button>
                <button className={!loop ? 'on' : ''} onClick={() => setLoop(false)}>One way</button>
              </div>
            </>
          )}
        </div>
        {step === 'choose' && (
          <div className="fullsheet-foot from-photo-foot">
            <button className="btn subtle" disabled={stops < 2} onClick={() => void build()}><Route size={17} /> Join up places</button>
            <button className="btn primary grow" disabled={!corners} onClick={() => void trace()}><PenLine size={17} /> Trace over the picture</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
