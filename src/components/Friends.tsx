import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Footprints, LogOut, Search, UserMinus, UserPlus, UserRound, X } from 'lucide-react'
import Modal from './Modal'
import {
  cleanUsername, dismissHikeInvite, follow, followerCount, followers, following, getProfile, liveHikeOf, markFollowersSeen, openJoinLink,
  searchPeople, signIn, signOut, signUp, unfollow, updateDisplayName, useAccount, useLiveHikes, useNewFollowers, walksOf,
  type Follower, type Hike, type Profile, type PublicProfile, type SharedWalk,
} from '../cloud'
import { setSettings, useSettings } from '../settings'
import { fmtKm } from '../geo'
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
  const fresh = useNewFollowers()
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`icon-btn account-btn ${session ? 'in' : ''} ${fresh.length ? 'has-news' : ''}`} onClick={() => setOpen(true)} aria-label={session ? 'Your account' : 'Sign in'} title={profile ? `@${profile.username}` : 'Sign in'}>
        {session ? <span className="me-dot">{initials(profile?.display_name || profile?.username || '?')}</span> : <UserRound size={21} strokeWidth={2} />}
        {fresh.length > 0 && <span className="news-badge" aria-label={`${fresh.length} new follower${fresh.length === 1 ? '' : 's'}`}>{fresh.length}</span>}
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

/** Hikes you can join right now (from people you follow, or invites), and people who just followed you. */
export function LiveNow({ compact }: { compact?: boolean }) {
  const hikes = useLiveHikes()
  const fresh = useNewFollowers()
  const [open, setOpen] = useState<string | null>(null)
  if (!hikes.length && !fresh.length) return null
  return (
    <section className={`live-now ${compact ? 'compact' : ''}`} aria-label="Live hikes and new followers">
      {hikes.map((h) => <LiveHike key={h.id} h={h} onOpen={() => setOpen(h.host)} />)}
      {fresh.length > 0 && <NewFollowers list={fresh} onOpen={setOpen} />}
      {open && <PersonSheet userId={open} onClose={() => setOpen(null)} />}
    </section>
  )
}

function LiveHike({ h, onOpen }: { h: Hike; onOpen: () => void }) {
  const who = h.hostProfile?.display_name || `@${h.hostProfile?.username ?? 'someone'}`
  return (
    <div className={`live-hike ${h.invited ? 'invited' : ''}`}>
      <button className="live-ico" onClick={onOpen} aria-label={`Open ${who}'s profile`}><Footprints size={18} /><span className="dot" /></button>
      <button className="grow live-text" onClick={onOpen}>
        <b>{h.invited ? `${who} invited you` : `${who} is hiking`}</b>
        <span className="muted small">{h.trail_name || 'A trail'} · {ago(h.started_at)}</span>
      </button>
      {h.invited && <button className="icon-btn small" aria-label="Dismiss" onClick={() => void dismissHikeInvite(h.id)}><X size={16} /></button>}
      <button className="btn primary small" onClick={() => openJoinLink(h.join_url)}>Join</button>
    </div>
  )
}

function NewFollowers({ list, onOpen }: { list: Follower[]; onOpen: (id: string) => void }) {
  const [busy, setBusy] = useState('')
  const [mine, setMine] = useState<Set<string>>(new Set())
  useEffect(() => { following().then((f) => setMine(new Set(f.map((p) => p.id)))).catch(() => {}) }, [list.length])
  const names = list.slice(0, 2).map((p) => p.display_name || `@${p.username}`).join(' and ') + (list.length > 2 ? ` and ${list.length - 2} more` : '')
  return (
    <div className="new-followers">
      <div className="row between">
        <b className="row gap-s"><UserPlus size={16} /> {names} followed you</b>
        <button className="icon-btn small" aria-label="Dismiss" onClick={markFollowersSeen}><X size={16} /></button>
      </div>
      <ul className="people">
        {list.map((p) => (
          <li key={p.id}>
            <div className="person">
              <button className="person-pick" onClick={() => onOpen(p.id)}>
                <span className="avatar" aria-hidden>{initials(p.display_name || p.username)}</span>
                <span className="grow"><span className="person-name">{p.display_name || p.username}</span><span className="person-sub">@{p.username} · {agoShort(p.followed_at)}</span></span>
              </button>
              {mine.has(p.id)
                ? <span className="pill follow-pill"><Check size={13} /> Friends</span>
                : <button className="btn small primary follow-btn" disabled={busy === p.id} onClick={async () => { setBusy(p.id); try { await follow(p.id); setMine((s) => new Set(s).add(p.id)) } finally { setBusy('') } }}><UserPlus size={15} /> Follow back</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

const agoShort = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}

/** Friends card for the Share tab: new followers, find people, who you follow and who follows you. */
export function FriendsCard() {
  const { session, profile } = useAccount()
  const settings = useSettings()
  const [list, setList] = useState<Profile[] | null>(null)
  const [fans, setFans] = useState<Follower[]>([])
  const [view, setView] = useState<'following' | 'followers'>('following')
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Profile[]>([])
  const [auth, setAuth] = useState(false)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const reload = () => {
    following().then(setList).catch(() => setList([]))
    followers().then(setFans).catch(() => setFans([]))
  }
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

  const shown: Profile[] = view === 'following' ? (list ?? []) : fans
  return (
    <section className="card friends">
      <div className="row between"><h3>Friends</h3><button className="link-btn muted small" onClick={() => session && setOpen(session.user.id)}>You’re @{profile?.username}</button></div>
      <LiveNow />
      <label className="search-people">
        <Search size={16} aria-hidden="true" />
        <input className="input" placeholder="Find people by username" autoCapitalize="none" autoCorrect="off" value={q} onChange={(e) => setQ(cleanUsername(e.target.value))} />
      </label>
      {q.length >= 2 && (
        <ul className="people">
          {results.length === 0 && <li className="muted small pad">Nobody called @{q} yet.</li>}
          {results.map((p) => <PersonRow key={p.id} p={p} on={followingIds.has(p.id)} onToggle={() => void toggle(p)} onOpen={() => setOpen(p.id)} />)}
        </ul>
      )}
      {err && <p className="note error">{err}</p>}
      {!q && <>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === 'following'} className={view === 'following' ? 'on' : ''} onClick={() => setView('following')}>Following {list ? `(${list.length})` : ''}</button>
          <button role="tab" aria-selected={view === 'followers'} className={view === 'followers' ? 'on' : ''} onClick={() => { setView('followers'); markFollowersSeen() }}>Followers ({fans.length})</button>
        </div>
        {shown.length > 0
          ? <ul className="people">{shown.map((p) => <PersonRow key={p.id} p={p} on={followingIds.has(p.id)} onToggle={() => void toggle(p)} onOpen={() => setOpen(p.id)} back={view === 'followers'} />)}</ul>
          : <p className="muted small">{view === 'following' ? 'Not following anyone yet. Search for a friend’s username above.' : 'No followers yet. Tell friends your username: @' + (profile?.username ?? '')}</p>}
      </>}
      <label className="toggle-row small">
        <input type="checkbox" checked={settings.shareWalks} onChange={(e) => setSettings({ shareWalks: e.target.checked })} />
        <span>Show my finished walks to followers <span className="muted">(distance, time and trail; never your route or start point)</span></span>
      </label>
      {open && <PersonSheet userId={open} onClose={() => { setOpen(null); reload() }} />}
    </section>
  )
}

function PersonRow({ p, on, onToggle, onOpen, back }: { p: Profile; on: boolean; onToggle: () => void; onOpen: () => void; back?: boolean }) {
  return (
    <li>
      <div className="person">
        <button className="person-pick" onClick={onOpen}>
          <span className="avatar" aria-hidden>{initials(p.display_name || p.username)}</span>
          <span className="grow"><span className="person-name">{p.display_name || p.username}</span><span className="person-sub">@{p.username}</span></span>
        </button>
        <button className={`btn small follow-btn ${on ? '' : 'primary'}`} onClick={onToggle}>{on ? <><UserMinus size={15} /> Following</> : <><UserPlus size={15} /> {back ? 'Follow back' : 'Follow'}</>}</button>
      </div>
    </li>
  )
}

const ACT = { walk: 'Walk', hike: 'Hike', run: 'Run' } as const
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min` }

/** Someone's profile: follow, their walk happening now (Join), and their past walks. */
export function PersonSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { session } = useAccount()
  const isMe = session?.user.id === userId
  const [p, setP] = useState<PublicProfile | null | undefined>(undefined)
  const [live, setLive] = useState<Hike | null>(null)
  const [walks, setWalks] = useState<SharedWalk[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => {
    getProfile(userId).then(setP).catch(() => setP(null))
    liveHikeOf(userId).then(setLive).catch(() => setLive(null))
    walksOf(userId).then(setWalks).catch(() => setWalks([]))
  }
  useEffect(load, [userId]) // eslint-disable-line react-hooks/exhaustive-deps

  const name = p?.display_name || p?.username || ''
  const totalKm = (walks ?? []).reduce((n, w) => n + w.distance_km, 0)
  return (
    <Sheet label={name ? `${name}'s profile` : 'Profile'} onClose={onClose}>
      {p === undefined && <p className="muted">Loading…</p>}
      {p === null && <p className="muted">Couldn’t load this profile. Check your connection.</p>}
      {p && <>
        <div className="profile-head">
          <span className="me-dot big">{initials(name)}</span>
          <div className="grow">
            <h2>{name}</h2>
            <div className="muted small">@{p.username}{p.followsMe && !isMe ? ' · follows you' : ''}</div>
          </div>
        </div>
        <div className="profile-stats">
          <div><b>{p.followers}</b><span>followers</span></div>
          <div><b>{p.following}</b><span>following</span></div>
          <div><b>{walks ? walks.length : '…'}</b><span>walks</span></div>
          <div><b>{walks ? fmtKm(totalKm) : '…'}</b><span>total</span></div>
        </div>
        {!isMe && (
          <button className={`btn block ${p.iFollow ? '' : 'primary'}`} disabled={busy} onClick={async () => {
            setBusy(true)
            try { if (p.iFollow) await unfollow(p.id); else await follow(p.id); load() } finally { setBusy(false) }
          }}>{p.iFollow ? <><UserMinus size={16} /> Following</> : <><UserPlus size={16} /> {p.followsMe ? 'Follow back' : 'Follow'}</>}</button>
        )}

        {live && (
          <div className="live-hike invited">
            <span className="live-ico"><Footprints size={18} /><span className="dot" /></span>
            <div className="grow"><b>Walking now</b><div className="muted small">{live.trail_name || 'A trail'} · {ago(live.started_at)}</div></div>
            {!isMe && <button className="btn primary small" onClick={() => { onClose(); openJoinLink(live.join_url) }}>Join</button>}
          </div>
        )}

        <h3 className="section-h">Past walks</h3>
        {walks === null && <p className="muted small">Loading…</p>}
        {walks && walks.length === 0 && (
          <p className="muted small">{isMe ? 'Finish a walk while signed in and it shows here for your followers.' : p.iFollow ? 'No shared walks yet.' : `Follow ${name} to see their walks.`}</p>
        )}
        {walks && walks.length > 0 && (
          <ul className="walk-list">
            {walks.map((w) => (
              <li key={w.id}>
                <span className="walk-ico"><Footprints size={16} /></span>
                <div className="grow">
                  <b>{w.trail_name || w.name || ACT[w.activity]}</b>
                  <div className="muted small">{new Date(w.started_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {ACT[w.activity]}</div>
                </div>
                <div className="walk-nums small"><b>{fmtKm(w.distance_km)}</b><span className="muted">{hm(w.active_s)}{w.ascent_m ? ` · ↑${w.ascent_m} m` : ''}</span></div>
              </li>
            ))}
          </ul>
        )}
      </>}
    </Sheet>
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
