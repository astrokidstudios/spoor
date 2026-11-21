import { useEffect, useState } from 'react'
import { myNumbers, numbersFor, placeFor, saveMyNumbers, type Num } from '../emergency'
import { getMap } from '../mapbus'
import { SNAKEBITE_FIRST_AID } from '../safety'
import { getPosition, toWords } from '../share'

const tel = (n: string) => `tel:${n.replace(/[^\d+]/g, '')}`
const pretty = (n: string) =>
  n.length === 10 && /^08[0-9]{2}/.test(n) && /^08(00|6[01])/.test(n) ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}` : n.length === 10 && n.startsWith('0') ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n

export default function SosSheet({ onClose }: { onClose: () => void }) {
  const [place, setPlace] = useState<{ place: string; nums: Num[] } | null>(null)
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number; words?: string } | null>(null)
  const [posErr, setPosErr] = useState('')
  const [mine, setMine] = useState<Num[]>(myNumbers())
  const [adding, setAdding] = useState<Num>({ label: '', number: '' })

  useEffect(() => {
    const me = getMap().me
    const c = getMap().bounds
    const p: [number, number] | null = me ? [me.lat, me.lng] : c ? [(c[0] + c[2]) / 2, (c[1] + c[3]) / 2] : null
    placeFor(p).then((pl) => setPlace(numbersFor(pl.country, pl.region)))
    getPosition()
      .then(async (g) => {
        const fix = { lat: g.coords.latitude, lng: g.coords.longitude, acc: g.coords.accuracy }
        setPos(fix)
        placeFor([fix.lat, fix.lng]).then((pl) => setPlace(numbersFor(pl.country, pl.region)))
        const words = await toWords(fix.lat, fix.lng).catch(() => undefined)
        if (words) setPos({ ...fix, words })
      })
      .catch((e) => setPosErr((e as Error).message))
  }, [])

  function add() {
    if (!adding.number.trim()) return
    const next = [...mine, { label: adding.label.trim() || 'My number', number: adding.number.trim() }]
    setMine(next)
    saveMyNumbers(next)
    setAdding({ label: '', number: '' })
  }
  function remove(i: number) {
    const next = mine.filter((_, j) => j !== i)
    setMine(next)
    saveMyNumbers(next)
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label="Emergency" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-body">
          <h2>Emergency</h2>
          <p className="muted small">{place ? `Numbers for ${place.place}. Tap to call; these work without data.` : 'Finding the right numbers…'}</p>
          <ul className="sos-list">
            {place?.nums.map((n) => (
              <li key={n.number}><a href={tel(n.number)}><b>{pretty(n.number)}</b><span>{n.label}</span></a></li>
            ))}
            {mine.map((n, i) => (
              <li key={'m' + i} className="row gap">
                <a className="grow" href={tel(n.number)}><b>{pretty(n.number)}</b><span>{n.label}</span></a>
                <button className="link-btn small" onClick={() => remove(i)} aria-label={`Remove ${n.label}`}>Remove</button>
              </li>
            ))}
          </ul>
          <div className="sos-where">
            <b>Tell them where you are</b>
            {pos ? (
              <>
                {pos.words && <span className="w3w">///{pos.words}</span>}
                <span>{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)} <span className="muted small">(±{Math.round(pos.acc)} m)</span></span>
                {!pos.words && navigator.onLine !== false && <a className="small" href={`https://map.what3words.com/${pos.lat},${pos.lng}`} target="_blank" rel="noreferrer">Show my 3 words</a>}
              </>
            ) : (
              <span className="muted small">{posErr || 'Getting your GPS position…'}</span>
            )}
          </div>
          <details>
            <summary className="small"><b>Snakebite first aid</b></summary>
            <p className="small">{SNAKEBITE_FIRST_AID}</p>
          </details>
          <details>
            <summary className="small">Add your own number (lodge, park office, a friend nearby)</summary>
            <div className="row gap wrap" style={{ marginTop: 8 }}>
              <input className="input grow" placeholder="Who, e.g. Monk's Cowl office" value={adding.label} onChange={(e) => setAdding({ ...adding, label: e.target.value })} />
              <input className="input grow" placeholder="Number" inputMode="tel" value={adding.number} onChange={(e) => setAdding({ ...adding, number: e.target.value })} />
              <button className="btn small" onClick={add}>Add</button>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
