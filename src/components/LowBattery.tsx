import { createPortal } from 'react-dom'
import { BatteryLow, Copy, MapPin, MessageCircle, Share2, X } from 'lucide-react'
import { useState } from 'react'
import { closeLowBatteryPrompt, useLowBatteryPrompt, whatsappShareUrl } from '../battery'
import { dismissBatteryAlert, useBatteryAlerts, type BatteryAlert } from '../cloud'

/** Pops up when your phone hits 15% on a walk: one tap to send the ready-written WhatsApp message. */
export function LowBatterySheet() {
  const p = useLowBatteryPrompt()
  const [copied, setCopied] = useState(false)
  if (!p) return null
  return createPortal(
    <div className="modal-back sheet-back" onClick={closeLowBatteryPrompt}>
      <div className="modal sheet low-batt-sheet" role="dialog" aria-modal="true" aria-label="Low battery" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="row gap-s"><span className="low-batt-ico"><BatteryLow size={22} /></span><h3>Battery at {Math.round(p.level * 100)}%</h3></div>
          <button className="icon-btn" onClick={closeLowBatteryPrompt} aria-label="Close"><X size={20} /></button>
        </div>
        <p className="small">Your followers on Trailz have been told{p.text.includes('Live location') ? ', and so has whoever has your live location link' : ''}. Send this to family or friends too:</p>
        <pre className="low-batt-msg">{p.text}</pre>
        <a className="btn primary block share-wa" href={whatsappShareUrl(p.text)} target="_blank" rel="noreferrer" onClick={() => setTimeout(closeLowBatteryPrompt, 500)}><MessageCircle size={18} /> Send on WhatsApp</a>
        <div className="row gap">
          {'share' in navigator && <button className="btn grow" onClick={() => navigator.share({ text: p.text }).catch(() => {})}><Share2 size={16} /> Other app</button>}
          <button className="btn grow" onClick={() => navigator.clipboard.writeText(p.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) }).catch(() => {})}><Copy size={16} /> {copied ? 'Copied' : 'Copy'}</button>
        </div>
        <p className="muted tiny">Tip: turn on Low Power Mode and dim the screen. Trailz keeps recording your walk.</p>
      </div>
    </div>,
    document.body,
  )
}

const agoText = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}

/** Cards for people you follow whose phone is nearly flat on a walk. */
export function BatteryAlerts() {
  const list = useBatteryAlerts()
  if (!list.length) return null
  return <>{list.map((a) => <BatteryAlertCard key={a.id} a={a} />)}</>
}

function BatteryAlertCard({ a }: { a: BatteryAlert }) {
  const who = a.profile?.display_name || `@${a.profile?.username ?? 'someone'}`
  return (
    <div className="batt-alert" role="status">
      <span className="low-batt-ico"><BatteryLow size={18} /></span>
      <div className="grow">
        <b>{who}'s phone is on {a.level}%</b>
        <span className="muted small">{a.trail_name ? `${a.trail_name} · ` : ''}{agoText(a.created_at)}. They may go quiet soon.</span>
        <span className="row gap wrap batt-links">
          {a.lat != null && a.lng != null && <a className="btn small" href={`https://maps.google.com/?q=${a.lat},${a.lng}`} target="_blank" rel="noreferrer"><MapPin size={14} /> Last position</a>}
          {a.follow_url && <a className="btn small" href={a.follow_url} target="_blank" rel="noreferrer">Live location</a>}
        </span>
      </div>
      <button className="icon-btn small" aria-label="Dismiss" onClick={() => dismissBatteryAlert(a.id)}><X size={16} /></button>
    </div>
  )
}
