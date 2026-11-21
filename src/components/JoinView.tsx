import { useState } from 'react'
import { Users } from 'lucide-react'
import { fmtDuration, fmtKm } from '../geo'
import { joinGroup, type Invite } from '../group'
import { getRec, startWalk } from '../record'
import { setSettings, useSettings } from '../settings'
import { estimateHours, KIND_LABEL, SHAPE_LABEL, tripOf } from '../trails'
import RouteThumb from './RouteThumb'
import { KIND_COLOR } from './MapView'

/** Opened from a friend's group walk link: shows the trail and joins you to the walk. */
export default function JoinView({ invite }: { invite: Invite }) {
  const settings = useSettings()
  const [name, setName] = useState(settings.myName)
  const [busy, setBusy] = useState(false)
  const t = invite.trail
  const trip = tripOf(t)
  const est = estimateHours(t)
  const already = getRec().walk

  async function join() {
    if (!name.trim()) return
    setBusy(true)
    setSettings({ myName: name.trim() })
    const trail = await joinGroup(invite)
    if (!getRec().walk) await startWalk({ activity: trail.kind === 'running' ? 'run' : 'hike', trail })
    try { sessionStorage.setItem('spoor.tab', 'record') } catch { /* ignore */ }
    history.replaceState(null, '', location.pathname + location.search)
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  }

  return (
    <div className="join">
      <div className="brand"><img src="./favicon.svg" alt="" width="30" height="30" /> <span>trailz</span></div>
      <h1 className="trail-title"><Users size={22} /> {invite.hostName ? `${invite.hostName} invited you on a walk` : 'You’re invited on a walk'}</h1>
      <div className="join-hero">
        <RouteThumb lines={t.lines} color={KIND_COLOR[t.kind]} size={96} />
        <div>
          <h2>{t.name}</h2>
          <p className="muted small">{SHAPE_LABEL[trip.shape]} · {KIND_LABEL[t.kind]}</p>
          <p className="small">{fmtKm(trip.km)} · ~{fmtDuration(est.walk)}</p>
        </div>
      </div>
      <p className="small">Join and you'll all follow this trail together. Everyone's position and how far along they are shows on the map, updating every 30 seconds while you walk.</p>
      <label className="small">Your name (so the others know who you are)
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" maxLength={30} />
      </label>
      {already && <p className="note small">You're already recording "{already.name}". Joining adds you to the group on that walk.</p>}
      <button className="btn primary block" disabled={!name.trim() || busy} onClick={() => void join()}><Users size={18} /> {busy ? 'Joining…' : 'Join the walk'}</button>
      <p className="muted tiny">Keep Trailz open while you walk so your friends can see you (the iPhone app keeps going with the screen locked). Your position is only shared with people who have this link, and stops when you finish.</p>
    </div>
  )
}
