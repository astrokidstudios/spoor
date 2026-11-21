import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { appleMapsUrl, coordsText, googleMapsUrl, plusCode, whereText, type Where } from '../where'

/** Where someone is, in forms anyone can use: nearest trail, GPS, Plus Code, altitude, and map buttons. */
export default function WhereBlock({ w, label, big, sms }: { w: Where; label?: string; big?: boolean; sms?: boolean }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(whereText(w))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked */ }
  }
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
  const details = [w.acc ? `±${Math.round(w.acc)} m` : '', w.alt != null ? `altitude ${Math.round(w.alt)} m` : ''].filter(Boolean).join(' · ')
  return (
    <div className="where">
      {w.near && <p className="where-near">{w.near}</p>}
      {w.words && <a className={`w3w ${big ? 'big' : ''}`} href={`https://what3words.com/${w.words}`} target="_blank" rel="noreferrer">///{w.words}</a>}
      <p className={`coords ${big ? 'big' : ''}`}>{coordsText(w)}</p>
      <p className="small">
        <span className="muted">Plus code</span> <b className="pluscode">{plusCode(w.lat, w.lng)}</b>
        {details && <span className="muted"> · {details}</span>}
      </p>
      <div className="row gap wrap">
        <a className="btn small" href={googleMapsUrl(w)} target="_blank" rel="noreferrer">Google Maps directions</a>
        <a className="btn small" href={appleMapsUrl(w, label)} target="_blank" rel="noreferrer">Apple Maps</a>
        <button className="btn small" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy coordinates</>}</button>
        {sms && <a className="btn small" href={`sms:${isIOS ? '&' : '?'}body=${encodeURIComponent(whereText(w))}`}>Text my location</a>}
      </div>
    </div>
  )
}
