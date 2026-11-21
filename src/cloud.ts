/**
 * Accounts, following and live hikes. One Supabase project is shared with Meander, so one login works in both apps.
 * Positions on a hike still go over the group walk's ntfy topic (see group.ts). The database only says
 * "this person has started a hike, here is the join link", so followers and invited friends can find and join it.
 */
import { createClient, type Session } from '@supabase/supabase-js'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { getSettings, readJSON, setSettings, writeJSON } from './settings'

const SUPABASE_URL = 'https://solcjhgfwgwwodziwnvl.supabase.co'
const SUPABASE_KEY = 'sb_publishable_ev-20oQthnlsWGIq_pMtDQ_u75dF4E4'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'trailz.auth' },
})

export interface Profile { id: string; username: string; display_name: string }

// ---------- Session + profile ----------

interface AuthState { session: Session | null; profile: Profile | null; ready: boolean }
let auth: AuthState = { session: null, profile: null, ready: false }
const listeners = new Set<() => void>()
function setAuth(p: Partial<AuthState>) { auth = { ...auth, ...p }; listeners.forEach((l) => l()) }
export const useAccount = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => auth)
export const myId = () => auth.session?.user.id ?? null

async function loadProfile(s: Session | null) {
  if (!s) return setAuth({ session: null, profile: null, ready: true })
  const { data } = await supabase.from('profiles').select('id, username, display_name').eq('id', s.user.id).maybeSingle()
  setAuth({ session: s, profile: data ?? null, ready: true })
  // Your account name is the name friends see on a group walk, unless you've set one.
  if (data?.display_name && !getSettings().myName.trim()) setSettings({ myName: data.display_name })
  startWatching()
}

supabase.auth.getSession().then(({ data }) => loadProfile(data.session))
supabase.auth.onAuthStateChange((event, s) => {
  if (event === 'SIGNED_OUT') { stopWatching(); setAuth({ session: null, profile: null, ready: true }); return }
  if (s?.user.id !== auth.session?.user.id) void loadProfile(s)
  else setAuth({ session: s })
})

const USERNAME_RE = /^[a-z0-9_.]{3,20}$/
export const cleanUsername = (s: string) => s.trim().toLowerCase().replace(/^@/, '')

function friendly(m: string) {
  if (/invalid login/i.test(m)) return 'That email and password don’t match.'
  if (/email not confirmed/i.test(m)) return 'Check your email and tap the confirm link first.'
  if (/already registered/i.test(m)) return 'There’s already an account with that email. Sign in instead.'
  if (/password/i.test(m) && /6/.test(m)) return 'Passwords need at least 6 characters.'
  if (/rate limit/i.test(m)) return 'Too many tries. Wait a minute and try again.'
  if (/fetch|network/i.test(m)) return 'No connection. Try again when you have signal.'
  return m
}

export async function signUp(email: string, password: string, username: string, displayName: string) {
  const u = cleanUsername(username)
  if (!USERNAME_RE.test(u)) throw new Error('Usernames are 3 to 20 letters, numbers, dots or underscores.')
  const { data: free } = await supabase.rpc('username_available', { name: u })
  if (!free) throw new Error(`@${u} is taken. Try another one.`)
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { username: u, display_name: displayName.trim() } } })
  if (error) throw new Error(friendly(error.message))
  return { needsConfirm: !data.session }
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
  if (error) throw new Error(friendly(error.message))
}

export const signOut = () => supabase.auth.signOut()

export async function updateDisplayName(name: string) {
  const id = myId()
  if (!id) return
  await supabase.from('profiles').update({ display_name: name.trim() }).eq('id', id)
  await loadProfile(auth.session)
}

// ---------- People and following ----------

export async function searchPeople(q: string): Promise<Profile[]> {
  const u = cleanUsername(q).replace(/[%_]/g, '')
  if (u.length < 2) return []
  const { data } = await supabase.from('profiles').select('id, username, display_name').ilike('username', `${u}%`).neq('id', myId() ?? '').limit(10)
  return (data ?? []) as Profile[]
}

export async function following(): Promise<Profile[]> {
  const id = myId()
  if (!id) return []
  const { data } = await supabase.from('follows').select('profiles!follows_followee_fkey(id, username, display_name)').eq('follower', id)
  return ((data ?? []) as unknown as { profiles: Profile | null }[]).map((r) => r.profiles).filter((p): p is Profile => !!p).sort((a, b) => a.username.localeCompare(b.username))
}

export async function followerCount(): Promise<number> {
  const id = myId()
  if (!id) return 0
  const { count } = await supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee', id)
  return count ?? 0
}

export async function follow(userId: string) {
  const { error } = await supabase.from('follows').insert({ follower: myId(), followee: userId })
  if (error && !/duplicate/i.test(error.message)) throw new Error(friendly(error.message))
  changed()
}

export async function unfollow(userId: string) {
  await supabase.from('follows').delete().eq('follower', myId() ?? '').eq('followee', userId)
  changed()
}

// ---------- Live hikes ----------

export interface Hike { id: string; host: string; join_url: string; trail_name: string; started_at: string; hostProfile?: Profile; invited?: boolean }

const HIKE_KEY = 'trailz.myHike'
interface MyHike { id: string; topic: string }
let myHike: MyHike | null = readJSON<MyHike | null>(HIKE_KEY, null)

/** Tell followers you've started a group walk, so they can find and join it. Safe to call again. */
export async function announceHike(topic: string, joinUrl: string, trailName: string): Promise<string | null> {
  if (!myId()) return null
  if (myHike?.topic === topic) return myHike.id
  const { data, error } = await supabase.from('hikes').insert({ topic, join_url: joinUrl, trail_name: trailName }).select('id').single()
  if (error || !data) return null
  myHike = { id: data.id, topic }
  writeJSON(HIKE_KEY, myHike)
  return data.id
}

export async function inviteToHike(userIds: string[]) {
  if (!myHike || !userIds.length) return
  const { error } = await supabase.from('hike_invites').upsert(userIds.map((u) => ({ hike_id: myHike!.id, invitee: u })), { onConflict: 'hike_id,invitee', ignoreDuplicates: true })
  if (error) throw new Error(friendly(error.message))
}

export async function invitedToMyHike(): Promise<string[]> {
  if (!myHike) return []
  const { data } = await supabase.from('hike_invites').select('invitee').eq('hike_id', myHike.id)
  return (data ?? []).map((r) => r.invitee as string)
}

/** Your walk is over: it disappears from friends' "Live now". */
export async function endMyHike(topic?: string) {
  if (!myHike || (topic && myHike.topic !== topic)) return
  const id = myHike.id
  myHike = null
  writeJSON(HIKE_KEY, null)
  await supabase.from('hikes').update({ ended_at: new Date().toISOString() }).eq('id', id).then(() => {}, () => {})
  changed()
}

const LIVE_HOURS = 14

/** Hikes happening now that I can join: from people I follow, or ones I've been invited to. */
export async function liveHikes(): Promise<Hike[]> {
  const id = myId()
  if (!id) return []
  const since = new Date(Date.now() - LIVE_HOURS * 3600000).toISOString()
  const [{ data: hikes }, { data: inv }] = await Promise.all([
    supabase.from('hikes').select('id, host, join_url, trail_name, started_at, profiles!hikes_host_fkey(id, username, display_name)').is('ended_at', null).gt('started_at', since).neq('host', id).order('started_at', { ascending: false }),
    supabase.from('hike_invites').select('hike_id').eq('invitee', id),
  ])
  const invited = new Set((inv ?? []).map((r) => r.hike_id as string))
  return ((hikes ?? []) as unknown as (Hike & { profiles: Profile | null })[]).map((h) => ({ ...h, hostProfile: h.profiles ?? undefined, invited: invited.has(h.id) }))
}

export async function dismissHikeInvite(hikeId: string) {
  await supabase.from('hike_invites').delete().eq('hike_id', hikeId).eq('invitee', myId() ?? '')
  changed()
}

// ---------- Watching for new hikes and invites ----------

const changeListeners = new Set<() => void>()
function changed() { changeListeners.forEach((f) => f()) }
let channel: ReturnType<typeof supabase.channel> | null = null
let poll: number | undefined

function startWatching() {
  stopWatching()
  channel = supabase.channel('trailz-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hikes' }, changed)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'hike_invites' }, changed)
    .subscribe()
  poll = window.setInterval(changed, 60000)
  changed()
}
function stopWatching() {
  if (channel) void supabase.removeChannel(channel)
  channel = null
  window.clearInterval(poll)
}

/** Live hikes I can join, kept fresh. */
export function useLiveHikes() {
  const { session } = useAccount()
  const [list, setList] = useState<Hike[]>([])
  useEffect(() => {
    let alive = true
    const load = () => { liveHikes().then((h) => alive && setList(h)).catch(() => {}) }
    load()
    changeListeners.add(load)
    window.addEventListener('focus', load)
    return () => { alive = false; changeListeners.delete(load); window.removeEventListener('focus', load) }
  }, [session?.user.id])
  return session ? list : []
}

/** Opens a join link inside the app (it's this app's own #/join/... page). */
export function openJoinLink(url: string) {
  const i = url.indexOf('#')
  location.hash = i >= 0 ? url.slice(i) : url
}
