import { useState } from 'react'
import { Check, Link2, LogOut, Share2, Users } from 'lucide-react'
import { db, type Walk } from '../db'
import { fmtKm } from '../geo'
import { getGroup, inviteLink, leaveGroup, memberColor, startGroup, useGroup, type Member } from '../group'
import { flyTo } from '../mapbus'

const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

/** Group walk panel on the recording screen: invite friends, see who's where and how far along. */
export default function GroupCard({ walk }: { walk: Walk }) {
  const { session, members, error } = useGroup()
  const [copied, setCopied] = useState(false)
  if (!walk.trailId) return null

  async function invite() {
    let s = getGroup().session
    const t = await db.trails.get(walk.trailId!)
    if (!t) return
    if (!s) s = startGroup(t)
    const url = inviteLink(s, t)
    const text = `Walk ${t.name} with me on Trailz. Tap to join and we'll see each other on the map.`
    try {
      if (navigator.share) { await navigator.share({ title: 'Join my walk', text, url }); return }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
    }
    try { await navigator.clipboard.writeText(url) } catch { prompt('Copy this link and send it to your friends:', url) }
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  if (!session) {
    return (
      <button className="btn block group-start" onClick={() => void invite()}>
        <Users size={18} /> Walk together: invite friends
      </button>
    )
  }

  const mine = members.find((m) => m.me)
  const myKm = mine ? (mine.doneKm ?? mine.walkedKm) : (walk.distanceKm)
  const others = members.filter((m) => !m.me)
  return (
    <div className="group-card">
      <div className="row between">
        <b className="row gap-s"><Users size={17} /> Group walk</b>
        <span className="muted small">{members.length || 1} {members.length === 1 || !members.length ? 'person' : 'people'}</span>
      </div>
      {!others.length && <p className="muted small">Nobody else yet. Send the link to your friends; they'll pop up here and on the map when they start.</p>}
      <ul className="members">
        {members.map((m) => <MemberRow key={m.id} m={m} myKm={myKm} />)}
      </ul>
      {error && <p className="note small">{error}</p>}
      <div className="row gap">
        <button className="btn" onClick={() => void invite()}>{copied ? <><Check size={16} /> Link copied</> : <>{'share' in navigator ? <Share2 size={16} /> : <Link2 size={16} />} Invite</>}</button>
        <button className="btn subtle" onClick={() => void leaveGroup()}><LogOut size={16} /> Leave group</button>
      </div>
    </div>
  )
}

function MemberRow({ m, myKm }: { m: Member; myKm: number }) {
  const km = m.doneKm ?? m.walkedKm
  const diff = km - myKm
  const stale = Date.now() - m.t > 3 * 60000
  const status = m.status === 'done' ? 'Finished' : m.status === 'left' ? 'Left the group' : m.status === 'paused' ? 'Paused' : stale ? `Last seen ${ago(m.t)}` : 'Walking'
  const rel = m.me ? 'You' : Math.abs(diff) < 0.05 ? 'With you' : `${fmtKm(Math.abs(diff))} ${diff > 0 ? 'ahead' : 'behind'}`
  return (
    <li className={`member ${stale || m.status === 'left' ? 'stale' : ''}`} onClick={() => flyTo([m.lat, m.lng], 15)}>
      <span className="avatar" style={{ background: memberColor(m.id) }}>{m.name.slice(0, 1).toUpperCase()}</span>
      <div className="member-main">
        <div className="row between small"><b>{m.me ? `${m.name} (you)` : m.name}</b><span className="muted">{m.me ? status : rel}</span></div>
        {m.pct != null && <div className="bar thin"><span style={{ width: `${m.pct}%`, background: memberColor(m.id) }} /></div>}
        <div className="row between tiny muted"><span>{m.pct != null ? `${m.pct}% · ${fmtKm(km)}` : fmtKm(m.walkedKm) + ' walked'}</span><span>{m.me ? '' : status}</span></div>
      </div>
    </li>
  )
}
