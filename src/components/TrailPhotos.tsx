import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Images, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Trail } from '../db'
import { fmtKm } from '../geo'
import { trailPhotos, type TrailPhoto } from '../photos'
import './trail-photos.css'

/** Google Images search for the trail, e.g. "Blue Grotto Trail Magaliesberg hike". */
export function googleImagesUrl(t: Trail) {
  const area = t.tags['is_in'] || t.tags['addr:city'] || t.tags['operator'] || ''
  const hikey = /\b(trail|hike|walk|route|path|pad|roete)\b/i.test(t.name) ? '' : ' hike'
  const q = `${t.name}${area ? ` ${area}` : ''}${hikey}`.replace(/\s+/g, ' ').trim()
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`
}

/** A swipeable strip of photos taken along and around a trail, with a full-screen viewer. */
export default function TrailPhotos({ trail }: { trail: Trail }) {
  const [photos, setPhotos] = useState<TrailPhoto[] | null>(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<number | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    setPhotos(null)
    setErr('')
    trailPhotos(trail, ac.signal)
      .then((p) => !ac.signal.aborted && setPhotos(p))
      .catch(() => !ac.signal.aborted && setErr(navigator.onLine === false ? 'Photos need a connection.' : 'Could not load photos right now.'))
    return () => ac.abort()
  }, [trail.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="tp">
      <div className="row between">
        <h3 className="section-h"><Images size={15} /> Photos along the way</h3>
        {photos && photos.length > 0 && <span className="muted tiny">{photos.length}</span>}
      </div>
      <a className="btn small tp-google" href={googleImagesUrl(trail)} target="_blank" rel="noreferrer"><Search size={15} /> See photos on Google Images <ExternalLink size={13} /></a>
      {!photos && !err && (
        <div className="tp-strip" aria-busy="true">{[0, 1, 2].map((i) => <span key={i} className="tp-thumb tp-skel" />)}</div>
      )}
      {err && <p className="note small">{err}</p>}
      {photos && !photos.length && <p className="note small tp-empty"><ImageOff size={16} /> No open-licence photos here yet. Try Google Images above.</p>}
      {photos && photos.length > 0 && (
        <div className="tp-strip">
          {(all ? photos : photos.slice(0, 5)).map((p, i) => (
            <button key={p.id} className="tp-thumb" onClick={() => setOpen(i)} aria-label={`Open photo: ${p.title}`}>
              <img src={p.thumb} alt={p.title} loading="lazy" onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = 'none')} />
            </button>
          ))}
        </div>
      )}
      {photos && photos.length > 5 && !all && <button className="btn small subtle tp-more" onClick={() => setAll(true)}>Show all {photos.length} photos</button>}
      {photos && photos.length > 0 && <p className="muted tiny">Openly licensed photos from <a href="https://commons.wikimedia.org" target="_blank" rel="noreferrer">Wikimedia Commons</a> and <a href="https://openverse.org" target="_blank" rel="noreferrer">Openverse</a> (incl. Flickr), taken near this trail or of places on it. Tap one for credit and licence.</p>}
      {open !== null && photos && <Viewer photos={photos} start={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function Viewer({ photos, start, onClose }: { photos: TrailPhoto[]; start: number; onClose: () => void }) {
  const track = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(start)

  useEffect(() => {
    const el = track.current
    if (el) el.scrollTo({ left: start * el.clientWidth, behavior: 'instant' as ScrollBehavior })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    document.addEventListener('keydown', onKey)
    document.documentElement.classList.add('modal-open')
    return () => { document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('modal-open') }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function go(d: number) {
    const el = track.current
    if (!el) return
    el.scrollTo({ left: Math.round(el.scrollLeft / el.clientWidth + d) * el.clientWidth, behavior: 'smooth' })
  }
  const p = photos[i]

  return (
    <div className="tp-viewer" role="dialog" aria-modal="true" aria-label="Trail photos">
      <div className="tp-top">
        <span className="tp-count">{i + 1} / {photos.length}</span>
        <button className="tp-x" onClick={onClose} aria-label="Close"><X size={22} /></button>
      </div>
      <div ref={track} className="tp-track" onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}>
        {photos.map((ph, j) => (
          <figure key={ph.id} className="tp-slide">
            {Math.abs(j - i) <= 2 && <img src={ph.full} alt={ph.title} />}
          </figure>
        ))}
      </div>
      {i > 0 && <button className="tp-nav prev" onClick={() => go(-1)} aria-label="Previous photo"><ChevronLeft size={26} /></button>}
      {i < photos.length - 1 && <button className="tp-nav next" onClick={() => go(1)} aria-label="Next photo"><ChevronRight size={26} /></button>}
      <div className="tp-cap">
        <b>{p.title}</b>
        <span>{p.about ? `Photo of ${p.about}` : p.km < 0.05 ? 'On the trail' : `${fmtKm(p.km)} from the trail`} · {p.author} · {p.licence}</span>
        <a href={p.page} target="_blank" rel="noreferrer">Source <ExternalLink size={12} /></a>
      </div>
    </div>
  )
}
