import { Check, Copy, MapPin, MessageCircle, MessageSquare, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db'
import { followLink, isNative, sendNow, startSharing, stopSharing, useShare } from '../share'
import { setSettings, useSettings } from '../settings'
import WhereBlock from './WhereBlock'

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export default function ShareTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const share = useShare()
  const settings = useSettings()
  const contacts = useLiveQuery(() => db.contacts.toArray(), [])
  const [contactId, setContactId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!contactId && contacts?.length) setContactId(contacts[0].id)
  }, [contacts, contactId])

  if (share.session) return <Sharing onOpenSettings={onOpenSettings} />

  async function start() {
    let c = contacts?.find((x) => x.id === contactId)
    if (contactId === 'new' || !c) {
      if (!newName.trim()) return
      c = { id: uid(), name: newName.trim(), phone: newPhone.replace(/[^\d+]/g, '') }
      await db.contacts.add(c)
    }
    await startSharing(c.name, c.phone)
  }
  const adding = contactId === 'new' || !contacts?.length

  return (
    <div className="tab-body">
      <section className="card">
        <h3>Share where you are</h3>
        <p className="muted small">
          Your contact gets a private link. It shows your GPS position, a Plus Code, the nearest trail and a map, updated every {settings.shareEveryMin} minutes. They don't need an app or account.
        </p>
        <label className="field">
          <span>Your name (shown to them)</span>
          <input className="input" value={settings.myName} placeholder="e.g. Josh" onChange={(e) => setSettings({ myName: e.target.value })} />
        </label>
        <label className="field">
          <span>Share with</span>
          <select className="input" value={adding ? 'new' : contactId} onChange={(e) => setContactId(e.target.value)}>
            {contacts?.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` (${c.phone})` : ''}</option>)}
            <option value="new">+ New contact</option>
          </select>
        </label>
        {adding && (
          <div className="row gap wrap">
            <input className="input grow" placeholder="Their name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <input className="input grow" placeholder="Mobile, e.g. +27 82 123 4567" inputMode="tel" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          </div>
        )}
        <button className="btn primary block" onClick={start} disabled={adding && !newName.trim()}><MapPin size={17} /> Start sharing</button>
      </section>
      <Limits />
      {contacts && contacts.length > 0 && (
        <details className="muted small">
          <summary>Manage contacts</summary>
          <ul className="plain">
            {contacts.map((c) => (
              <li key={c.id} className="row between">
                <span>{c.name} {c.phone}</span>
                <button className="link-btn" onClick={() => db.contacts.delete(c.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Limits() {
  return (
    <p className="muted tiny">
      {isNative
        ? 'Trailz keeps sharing with the screen locked or while you use other apps. Choose "Always" when it asks for location access.'
        : isIOS
        ? 'iPhone: updates only go out while Trailz is open on screen (Apple pauses web apps in the background). Trailz keeps the screen awake while sharing; turn the brightness down to save battery. If the screen locks, the next update goes out as soon as you reopen Trailz.'
        : 'Updates go out while Trailz is open. On phones, keep it on screen; Trailz keeps the screen awake while sharing.'}
      {' '}Updates only send when you have signal; with no signal Trailz keeps trying.
    </p>
  )
}

function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`
}

function Sharing({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { session, pings, busy, lastError, wakeLock } = useShare()
  const settings = useSettings()
  const [copied, setCopied] = useState(false)
  if (!session) return null
  const link = followLink(session)
  const last = [...pings].reverse().find((p) => p.sent)
  const latest = pings[pings.length - 1]
  const nextIn = last ? Math.max(0, Math.round((last.t + session.everyMin * 60000 - Date.now()) / 60000)) : 0
  const text = `Hi, it's ${settings.myName || 'me'}. I'm sharing my live location with you on Trailz while I'm out hiking. It updates every ${session.everyMin} minutes: ${link}`
  const phone = session.contactPhone.replace(/^0/, '+27').replace(/[^\d+]/g, '')

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }

  return (
    <div className="tab-body">
      <section className="card live">
        <div className="row between">
          <span className="live-dot">Sharing with {session.contactName}</span>
          <span className="muted tiny">since {new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        {latest ? (
          <WhereBlock w={latest} label={settings.myName || 'Me'} />
        ) : (
          <p className="coords muted">Getting your first fix…</p>
        )}
        <p className="small">
          {last ? <>Last sent {ago(last.t)} · next in {nextIn ? `${nextIn} min` : 'a moment'}</> : busy ? 'Sending…' : 'Waiting to send the first update'}
          {wakeLock && <span className="muted"> · screen kept awake</span>}
        </p>
        {lastError && <p className="tiny error">{lastError} {lastError.startsWith('what3words') && <button className="link-btn" onClick={onOpenSettings}>Check key</button>}</p>}
        <div className="row gap wrap">
          <button className="btn small" onClick={() => sendNow()} disabled={busy}>{busy ? <span className="spin" /> : <Send size={15} />} Send now</button>
          <button className="btn small danger" onClick={() => stopSharing()}>Stop sharing</button>
        </div>
      </section>

      <section className="card">
        <h3>Send {session.contactName} the link</h3>
        <p className="muted small">They open it once; it keeps updating by itself.</p>
        <div className="row gap wrap">
          {phone && <a className="btn small" href={`https://wa.me/${phone.replace('+', '')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
          <a className="btn small" href={`sms:${phone}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`}><MessageSquare size={15} /> SMS</a>
          {'share' in navigator && <button className="btn small" onClick={() => navigator.share({ title: 'Follow my hike', text, url: link }).catch(() => {})}>Share…</button>}
          <button className="btn small" onClick={copy}>{copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}</button>
        </div>
        <input className="input tiny-input" readOnly value={link} onFocus={(e) => e.target.select()} />
        <p className="muted tiny">Want phone alerts too? They can install the free ntfy app and subscribe to <code>{session.topic}</code>.</p>
      </section>

      {pings.length > 0 && (
        <section>
          <h3 className="section-title">Updates</h3>
          <ul className="ping-list">
            {[...pings].reverse().slice(0, 12).map((p, i) => (
              <li key={i}>
                <span>{new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="grow">{p.near ?? (p.words ? `///${p.words}` : `${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}`)}</span>
                <span className={p.sent ? 'good' : 'error'}>{p.sent ? <><Check size={13} /> sent</> : <><X size={13} /> not sent</>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Limits />
    </div>
  )
}
