import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ImageUp, MapPin, Route, X } from 'lucide-react'
import { findPlaces, readFacts, readText, visitOrder, type FoundPlace, type PictureFacts } from '../fromphoto'
import { getMap, leaflet, setMap } from '../mapbus'
import { planThrough } from '../plan'
import type { LatLng } from '../db'

type Step = 'pick' | 'reading' | 'finding' | 'choose' | 'error'

/**
 * Rebuild a trail from a picture: read the place names and length off it, find those places,
 * and join them up along real paths with the route planner.
 */
export default function FromPhoto({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick')
  const [err, setErr] = useState('')
  const [facts, setFacts] = useState<PictureFacts | null>(null)
  const [places, setPlaces] = useState<FoundPlace[]>([])
  const [name, setName] = useState('')
  const [loop, setLoop] = useState(true)
  const [extra, setExtra] = useState('')
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
      const lines = await readText(f)
      if (a.signal.aborted) return
      const fx = readFacts(lines)
      setFacts(fx)
      setName(fx.title)
      setLoop(/loop|circuit|circular/i.test(fx.title) || !fx.title)
      setStep('finding')
      const found = await findPlaces(fx, near(), a.signal)
      if (a.signal.aborted) return
      setPlaces(found)
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
    if (p && !places.some((x) => x.id === p.id)) setPlaces([...places, p])
    else if (!p) setErr(`Couldn't find a place called “${q}” nearby.`)
  }

  async function build() {
    const chosen = places.filter((p) => p.on)
    const pts = visitOrder(chosen.map((p) => p.at))
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
  const chosen = places.filter((p) => p.on).length

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
              <p className="muted">Pick a screenshot or photo of a trail map. Trailz reads the place names and distance on it, finds those places, and lays the route along real paths.</p>
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
              {facts.km != null && <p className="small muted">The picture says <b>{facts.km} km</b>{facts.climb ? <> and <b>{facts.climb} m</b> up</> : null}. You'll see how close the rebuilt route gets.</p>}
              <p className="small"><b>Places on the route</b> <span className="muted">(untick any it doesn't go through, and put them in walking order)</span></p>
              {!places.length && <p className="note">No places found on that picture. Add their names below.</p>}
              <ul className="from-photo-list">
                {places.map((p, i) => (
                  <li key={p.id} className={p.on ? 'on' : ''}>
                    <button className="from-photo-check" aria-pressed={p.on} aria-label={`${p.on ? 'Leave out' : 'Include'} ${p.name}`} onClick={() => setPlaces((ps) => ps.map((x) => (x.id === p.id ? { ...x, on: !x.on } : x)))}>
                      {p.on ? <Check size={16} /> : null}
                    </button>
                    <MapPin size={16} aria-hidden="true" />
                    <span className="grow one-line"><b>{p.name}</b><span className="muted tiny">{p.sub}</span></span>
                    <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${p.name} up`}>↑</button>
                    <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === places.length - 1} aria-label={`Move ${p.name} down`}>↓</button>
                  </li>
                ))}
              </ul>
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
          <div className="fullsheet-foot">
            <button className="btn subtle" onClick={() => setStep('pick')}>Another picture</button>
            <button className="btn primary grow" disabled={chosen < 2} onClick={() => void build()}><Route size={17} /> Build route</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
