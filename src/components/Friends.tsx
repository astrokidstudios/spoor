import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Footprints, LogOut, Search, UserMinus, UserPlus, UserRound, X } from 'lucide-react'
import Modal from './Modal'
import {
  cleanUsername, dismissHikeInvite, follow, followerCount, following, openJoinLink, searchPeople, signIn, signOut, signUp,
  unfollow, updateDisplayName, useAccount, useLiveHikes, type Hike, type Profile,
} from '../cloud'
import { initials } from '../contacts'
import './friends.css'

function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(<Modal label={label} onClose={onClose} className="settings"><div className="modal-body">{children}</div></Modal>, document.body)
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just started' : m < 60 ? `started ${m} min ago` : `started ${Math.round(m / 60)} h ago`
}

/** Header button: your initials when signed in, a person icon when not. */
export function AccountButton() {
  const { profile, session } = useAccount()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`icon-btn account-btn ${session ? 'in' : ''}`} onClick={() => setOpen(true)} aria-label={session ? 'Your account' : 'Sign in'} title={profile ? `@${profile.username}` : 'Sign in'}>
        {session ? <span className="me-dot">{initials(profile?.display_name || profile?.username || '?')}</span> : <UserRound size={21} strokeWidth={2} />}
      </button>
      {open && <AccountModal onClose={() => setOpen(false)} />}
    </>
  )
}

export function AccountModal({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const { session } = useAccount()
  return session ? <ProfileSheet onClose={onClose} /> : <AuthSheet onClose={onClose} reason={reason} />
}

function AuthSheet({ onClose, reason }: { onClose: () => void; reason?: string }) {
  const [mode, setMode] = useState<'up' | 'in'>('up')
  const [f, setF] = useState({ name: '', username: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [sent, setSent] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  async function submit() {
    setErr('')
    setBusy(true)
    try {
      if (mode === 'up') {
        if (!f.name.trim()) throw new Error('Add your name so friends know it’s you.')
        const { needsConfirm } = await signUp(f.email, f.password, f.username, f.name)
        if (needsConfirm) { setSent(true); return }
      } else await signIn(f.email, f.password)
      onClose()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (sent) return (
    <Sheet label="Check your email" onClose={onClose}>
      <h2>Check your email</h2>
      <p>We sent a confirm link to <b>{f.email}</b>. Tap it, then come back and sign in.</p>
      <button className="btn primary block" onClick={() => { setSent(false); setMode('in') }}>I’ve confirmed it</button>
    </Sheet>
  )

  return (
    <Sheet label={mode === 'up' ? 'Create your account' : 'Sign in'} onClose={onClose}>
      <h2>{mode === 'up' ? 'Create your account' : 'Sign in'}</h2>
      <p className="muted small">{reason ?? 'With an account, friends can follow you and join your hikes, and you can invite them to yours. The same account works in Meander.'}</p>
      <form className="auth-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {mode === 'up' && <>
          <label className="field"><span>Your name</span><input className="input" autoComplete="name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Josh" /></label>
          <label className="field"><span>Username</span><div className="at-input"><b>@</b><input className="input" autoCapitalize="none" autoCorrect="off" maxLength={20} value={f.username} onChange={(e) => set('username', e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="josh" /></div></label>
        </>}
        <label className="field"><span>Email</span><input className="input" type="email" autoComplete="email" autoCapitalize="none" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="field"><span>Password</span><input className="input" type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={f.password} onChange={(e) => set('password', e.target.value)} placeholder={mode === 'up' ? 'At least 6 characters' : ''} /></label>
        {err && <p className="note error" role="alert">{err}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'One sec…' : mode === 'up' ? 'Create account' : 'Sign in'}</button>
        <button type="button" className="btn subtle block" onClick={() => { setMode(mode === 'up' ? 'in' : 'up'); setErr('') }}>{mode === 'up' ? 'I already have an account' : 'New here? Create an account'}</button>
      </form>
    </Sheet>
  )
}

function ProfileSheet({ onClose }: { onClose: () => void }) {
  const { profile, session } = useAccount()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [followers, setFollowers] = useState<number | null>(null)
  useEffect(() => { followerCount().then(setFollowers) }, [])
  return (
    <Sheet label="Your account" onClose={() => { if (name !== profile?.display_name) void updateDisplayName(name); onClose() }}>
      <div className="profile-head">
        <span className="me-dot big">{initials(name || profile?.username || '?')}</span>
        <div>
          <h2>@{profile?.username ?? '…'}</h2>
          <div className="muted small">{session?.user.email}{followers !== null && ` · ${followers} follower${followers === 1 ? '' : 's'}`}</div>
        </div>
      </div>
      <label className="field"><span>Your name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <p className="muted small">Friends find you by <b>@{profile?.username}</b>. When you start a group walk, people who follow you see it under Live now and can join.</p>
      <button className="btn subtle block" onClick={async () => { await signOut(); onClose() }}><LogOut size={16} /> Sign out</button>
    </Sheet>
  )
}

/** Hikes you can join right now: from people you follow, and ones you've been invited to. */
export function LiveNow({ compact }: { compact?: boolean }) {
  const hikes = useLiveHikes()
  if (!hikes.length) return null
  return (
    <section className={`live-now ${compact ? 'compact' : ''}`} aria-label="Live hikes">
      {hikes.map((h) => <LiveHike key={h.id} h={h} />)}
    </section>
  )
}

function LiveHike({ h }: { h: Hike }) {
  const who = h.hostProfile?.display_name || `@${h.hostProfile?.username ?? 'someone'}`
  return (
    <div className={`live-hike ${h.invited ? 'invited' : ''}`}>
      <span className="live-ico"><Footprints size={18} /><span className="dot" /></span>
      <div className="grow">
        <b>{h.invited ? `${who} invited you` : `${who} is hiking`}</b>
        <div className="muted small">{h.trail_name || 'A trail'} · {ago(h.started_at)}</div>
      </div>
      {h.invited && <button className="icon-btn small" aria-label="Dismiss" onClick={() => void dismissHikeInvite(h.id)}><X size={16} /></button>}
      <button className="btn primary small" onClick={() => openJoinLink(h.join_url)}>Join</button>
    </div>
  )
}

/** Friends card for the People tab: who you follow, find people by username. */
export function FriendsCard() {
  const { session, profile } = useAccount()
  const [list, setList] = useState<Profile[] | null>(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [auth, setAuth] = useState(false)
  const [err, setErr] = useState('')

  const reload = () => { following().then(setList).catch(() => setList([])) }
  useEffect(() => { if (session) reload() }, [session?.user.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!session) return
    const t = setTimeout(() => { searchPeople(q).then(setResults).catch(() => setResults([])) }, 250)
    return () => clearTimeout(t)
  }, [q, session])

  if (!session) {
    return (
      <section className="card friends">
        <h3>Hike with friends</h3>
        <p className="muted small">Make a free account to follow friends by username, see when they start a hike, join them, and invite them to yours.</p>
        <button className="btn primary" onClick={() => setAuth(true)}><UserPlus size={17} /> Create account or sign in</button>
        {auth && <AccountModal onClose={() => setAuth(false)} />}
      </section>
    )
  }

  const followingIds = new Set((list ?? []).map((p) => p.id))
  async function toggle(p: Profile) {
    setErr('')
    try {
      if (followingIds.has(p.id)) await unfollow(p.id)
      else await follow(p.id)
      reload()
    } catch (e) { setErr((e as Error).message) }
  }

  return (
    <section className="card friends">
      <div className="row between"><h3>Friends</h3><span className="muted small">You’re @{profile?.username}</span></div>
      <LiveNow />
      <label className="search-people">
        <Search size={16} aria-hidden="true" />
        <input className="input" placeholder="Find people by username" autoCapitalize="none" autoCorrect="off" value={q} onChange={(e) => setQ(cleanUsername(e.target.value))} />
      </label>
      {q.length >= 2 && (
        <ul className="people">
          {results.length === 0 && <li className="muted small pad">Nobody called @{q} yet.</li>}
          {results.map((p) => <PersonRow key={p.id} p={p} on={followingIds.has(p.id)} onToggle={() => void toggle(p)} />)}
        </ul>
      )}
      {err && <p className="note error">{err}</p>}
      {list && list.length > 0 && !q && <>
        <span className="muted small">Following</span>
        <ul className="people">{list.map((p) => <PersonRow key={p.id} p={p} on onToggle={() => void toggle(p)} />)}</ul>
      </>}
      {list && list.length === 0 && !q && <p className="muted small">Not following anyone yet. Search for a friend’s username above.</p>}
    </section>
  )
}

function PersonRow({ p, on, onToggle }: { p: Profile; on: boolean; onToggle: () => void }) {
  return (
    <li>
      <div className="person">
        <div className="person-pick">
          <span className="avatar" aria-hidden>{initials(p.display_name || p.username)}</span>
          <span className="grow"><span className="person-name">{p.display_name || p.username}</span><span className="person-sub">@{p.username}</span></span>
        </div>
        <button className={`btn small follow-btn ${on ? '' : 'primary'}`} onClick={onToggle}>{on ? <><UserMinus size={15} /> Following</> : <><UserPlus size={15} /> Follow</>}</button>
      </div>
    </li>
  )
}

/** Pick people you follow to invite to the hike you've started. */
export function InviteFollowers({ already, onInvite, onClose }: { already: string[]; onInvite: (ids: string[]) => Promise<void>; onClose: () => void }) {
  const [list, setList] = useState<Profile[] | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { following().then(setList).catch(() => setList([])) }, [])
  const flip = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  return (
    <Sheet label="Invite friends to this hike" onClose={onClose}>
      <h2>Invite friends</h2>
      <p className="muted small">They get a Join card in Trailz, and the hike also shows for everyone who follows you.</p>
      {list === null && <p className="muted">Loading…</p>}
      {list && !list.length && <p className="muted small">Follow friends in the People tab first, or send the link instead.</p>}
      <ul className="people tall">
        {(list ?? []).map((p) => {
          const done = already.includes(p.id)
          const on = done || picked.has(p.id)
          return (
            <li key={p.id}>
              <div className={`person ${on ? 'on' : ''}`}>
                <button className="person-pick" disabled={done} onClick={() => flip(p.id)} aria-pressed={on}>
                  <span className="avatar" aria-hidden>{initials(p.display_name || p.username)}</span>
                  <span className="grow"><span className="person-name">{p.display_name || p.username}</span><span className="person-sub">{done ? 'Invited' : `@${p.username}`}</span></span>
                  {on && <Check className="person-tick" size={18} />}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {err && <p className="note error">{err}</p>}
      <button className="btn primary block" disabled={!picked.size || busy} onClick={async () => {
        setBusy(true); setErr('')
        try { await onInvite([...picked]); onClose() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
      }}>{busy ? 'Inviting…' : picked.size ? `Invite ${picked.size}` : 'Pick people to invite'}</button>
    </Sheet>
  )
}
