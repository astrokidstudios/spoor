import { useSyncExternalStore } from 'react'
import { db, type LatLng, type Trail, type TrailKind } from './db'
import { bboxOf, lineKm } from './geo'
import { setMap } from './mapbus'
import { getSettings, PUBLIC_URL, readJSON, writeJSON } from './settings'
import { announceHike, endMyHike, myId } from './cloud'

/**
 * Group walks: everyone on one walk follows the same trail and sees each other's position and progress.
 * The invite link carries the trail itself (a simplified line), so friends need no search or account.
 * While you walk, the app posts your position and progress to the group's private ntfy.sh topic,
 * and reads everyone else's from it. Same free service as live sharing.
 */

export interface GroupSession {
  topic: string
  trailId: string
  trailName: string
  me: string // member id
  host: boolean
  startedAt: number
  server: string
}

export interface Member {
  id: string
  name: string
  lat: number
  lng: number
  acc: number
  t: number
  pct: number | null
  doneKm: number | null
  walkedKm: number
  status: 'recording' | 'paused' | 'done' | 'left'
  me: boolean
}

interface State { session: GroupSession | null; members: Member[]; error: string }

const KEY = 'spoor.group'
let state: State = { session: readJSON<GroupSession | null>(KEY, null), members: [], error: '' }
const listeners = new Set<() => void>()
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  writeJSON(KEY, state.session)
  listeners.forEach((l) => l())
  setMap({ group: state.session ? state.members : null })
}
export const getGroup = () => state
export const useGroup = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

const rand = (n: number) => {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')
}

// ---- Trail in the link: Google's polyline encoding, shrunk to at most ~300 points ----
function encode(line: LatLng[]) {
  let out = '', pLat = 0, pLng = 0
  const enc = (v: number) => {
    v = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5 }
    return s + String.fromCharCode(v + 63)
  }
  for (const [la, ln] of line) {
    const a = Math.round(la * 1e5), b = Math.round(ln * 1e5)
    out += enc(a - pLat) + enc(b - pLng)
    pLat = a; pLng = b
  }
  return out
}
function decode(s: string): LatLng[] {
  const pts: LatLng[] = []
  let i = 0, lat = 0, lng = 0
  const next = () => {
    let r = 0, sh = 0, b
    do { b = s.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5 } while (b >= 0x20 && i <= s.length)
    return r & 1 ? ~(r >> 1) : r >> 1
  }
  while (i < s.length) { lat += next(); lng += next(); pts.push([lat / 1e5, lng / 1e5]) }
  return pts
}
function thin(lines: LatLng[][], max = 300): LatLng[][] {
  const total = lines.reduce((n, l) => n + l.length, 0)
  const step = Math.max(1, Math.ceil(total / max))
  return lines.filter((l) => l.length > 1).map((l) => l.filter((_, i) => i % step === 0 || i === l.length - 1))
}
const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

interface Packed { i: string; n: string; k: TrailKind; d: number; l: string[]; h?: string; a?: number; ds?: number; rt?: string }

export function inviteLink(s: GroupSession, t: Trail) {
  const p: Packed = { i: t.id, n: t.name, k: t.kind, d: Math.round(t.distanceKm * 100) / 100, l: thin(t.lines).map(encode), h: getSettings().myName.trim() || undefined, a: t.ascent, ds: t.descent, rt: t.tags.roundtrip }
  const q = new URLSearchParams({ t: b64url(JSON.stringify(p)) })
  if (s.server !== 'https://ntfy.sh') q.set('s', s.server)
  return `${PUBLIC_URL}#/join/${s.topic}?${q}`
}

export interface Invite { topic: string; server: string; trail: Trail; hostName?: string }

export function parseInvite(hash: string): Invite | null {
  const m = hash.match(/^#\/join\/([\w-]+)\?(.*)$/)
  if (!m) return null
  try {
    const q = new URLSearchParams(m[2])
    const p = JSON.parse(unb64url(q.get('t') ?? '')) as Packed
    const lines = p.l.map(decode).filter((l) => l.length > 1)
    if (!lines.length) return null
    const trail: Trail = {
      id: p.i, name: p.n, kind: p.k, distanceKm: p.d || lines.reduce((n, l) => n + lineKm(l), 0),
      lines, bbox: bboxOf(lines), tags: { name: p.n, ...(p.rt ? { roundtrip: p.rt } : {}) }, packIds: [], fetchedAt: Date.now(),
      ...(p.a != null ? { ascent: p.a, descent: p.ds } : {}),
    }
    return { topic: m[1], server: q.get('s') ?? 'https://ntfy.sh', trail, hostName: p.h }
  } catch {
    return null
  }
}

// ---- Starting, joining and leaving ----
export function startGroup(t: Trail): GroupSession {
  const s: GroupSession = { topic: 'trailz-g-' + rand(14), trailId: t.id, trailName: t.name, me: rand(8), host: true, startedAt: Date.now(), server: getSettings().ntfyServer.replace(/\/$/, '') || 'https://ntfy.sh' }
  set({ session: s, members: [], error: '' })
  startPolling()
  return s
}

/**
 * Starting a walk on a trail while signed in: open a group for it straight away and list it under
 * "Live now" for followers, so they can see you're out and join. Skipped if you joined someone else's walk.
 */
export async function goLiveForFollowers(t: Trail) {
  if (!myId() || !getSettings().liveToFollowers || state.session) return
  const s = startGroup(t)
  await announceHike(s.topic, inviteLink(s, t), t.name)
}

export async function joinGroup(inv: Invite): Promise<Trail> {
  const have = await db.trails.get(inv.trail.id)
  const trail = have ?? inv.trail
  if (!have) await db.trails.put(trail)
  set({ session: { topic: inv.topic, trailId: trail.id, trailName: trail.name, me: rand(8), host: false, startedAt: Date.now(), server: inv.server }, members: [], error: '' })
  startPolling()
  return trail
}

export async function leaveGroup() {
  const s = state.session
  if (!s) return
  stopPolling()
  if (s.host) void endMyHike(s.topic)
  if (last) await post(s, { ...last, st: 'left' }).catch(() => {})
  last = null
  set({ session: null, members: [] })
}

/** After finishing your walk: stop following the group (your 'finished' update has already gone out). */
export function endGroup() {
  const s = state.session
  if (s?.host) void endMyHike(s.topic)
  stopPolling()
  last = null
  set({ session: null, members: [] })
}

// ---- Sending my position ----
interface Msg { v: 1; m: string; n: string; la: number; ln: number; a: number; t: number; p: number | null; d: number | null; w: number; st: Member['status'] }
let last: Msg | null = null
let lastSent = 0
const SEND_MS = 30000

async function post(s: GroupSession, msg: Msg) {
  const res = await fetch(s.server + '/', {
    method: 'POST',
    body: JSON.stringify({ topic: s.topic, title: `${msg.n} · group walk`, message: JSON.stringify(msg), tags: ['footprints'] }),
  })
  if (!res.ok) throw new Error(`Could not send (${res.status})`)
}

/** Called by the recorder on each GPS fix and on pause/finish. Sends at most every 30 s unless the status changed. */
export function reportPosition(r: { lat: number; lng: number; acc: number; pct: number | null; doneKm: number | null; walkedKm: number; status: Member['status'] }) {
  const s = state.session
  if (!s) return
  const msg: Msg = { v: 1, m: s.me, n: getSettings().myName.trim() || 'Walker', la: +r.lat.toFixed(5), ln: +r.lng.toFixed(5), a: Math.round(r.acc), t: Date.now(), p: r.pct, d: r.doneKm != null ? +r.doneKm.toFixed(2) : null, w: +r.walkedKm.toFixed(2), st: r.status }
  const changed = last?.st !== msg.st
  last = msg
  mergeMine(msg)
  if (!changed && Date.now() - lastSent < SEND_MS) return
  lastSent = Date.now()
  void post(s, msg).then(() => state.error && set({ error: '' })).catch(() => set({ error: navigator.onLine === false ? 'No signal: your friends will see you again when you are back in range.' : 'Could not reach the group. Trying again soon.' }))
}

// ---- Reading everyone's position ----
const toMember = (m: Msg, me: string): Member => ({ id: m.m, name: m.n, lat: m.la, lng: m.ln, acc: m.a, t: m.t, pct: m.p, doneKm: m.d, walkedKm: m.w, status: m.st, me: m.m === me })

function mergeMine(m: Msg) {
  const s = state.session
  if (!s) return
  const others = state.members.filter((x) => x.id !== m.m)
  set({ members: sortMembers([...others, toMember(m, s.me)]) })
}
const sortMembers = (ms: Member[]) => ms.sort((a, b) => (b.doneKm ?? b.walkedKm) - (a.doneKm ?? a.walkedKm))

export async function refresh() {
  const s = state.session
  if (!s) return
  try {
    const res = await fetch(`${s.server}/${encodeURIComponent(s.topic)}/json?poll=1&since=24h`)
    if (!res.ok) throw new Error(String(res.status))
    const latest = new Map<string, Msg>()
    for (const line of (await res.text()).split('\n')) {
      try {
        const e = JSON.parse(line)
        if (e.event !== 'message') continue
        const m = JSON.parse(e.message) as Msg
        if (m?.v !== 1 || !m.m) continue
        const prev = latest.get(m.m)
        if (!prev || m.t >= prev.t) latest.set(m.m, m)
      } catch { /* not ours */ }
    }
    if (last) latest.set(last.m, last)
    if (state.session?.topic !== s.topic) return
    set({ members: sortMembers([...latest.values()].map((m) => toMember(m, s.me))), error: '' })
  } catch {
    if (navigator.onLine === false) set({ error: 'No signal: showing where everyone was last seen.' })
  }
}

let poll: ReturnType<typeof setInterval> | null = null
function startPolling() {
  stopPolling()
  void refresh()
  poll = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 15000)
}
function stopPolling() {
  if (poll) clearInterval(poll)
  poll = null
}

/** Pick an open group back up after the app is reopened. */
export function resumeGroup() {
  if (state.session && !poll) startPolling()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state.session) void refresh() })
}

const COLORS = ['#e5484d', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#ca8a04']
export function memberColor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]
}
