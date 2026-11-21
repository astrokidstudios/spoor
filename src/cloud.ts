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
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'follows' }, changed)
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

// ---------- Followers, profiles and past walks ----------

export interface Follower extends Profile { followed_at: string }

export async function followers(): Promise<Follower[]> {
  const id = myId()
  if (!id) return []
  const { data } = await supabase.from('follows').select('created_at, profiles!follows_follower_fkey(id, username, display_name)').eq('followee', id).order('created_at', { ascending: false })
  return ((data ?? []) as unknown as { created_at: string; profiles: Profile | null }[]).filter((r) => r.profiles).map((r) => ({ ...r.profiles!, followed_at: r.created_at }))
}

const SEEN_KEY = 'trailz.followersSeen'
export const followersSeenAt = () => readJSON<string>(SEEN_KEY, '')
export function markFollowersSeen() { writeJSON(SEEN_KEY, new Date().toISOString()); changed() }

/** People who followed me since I last looked, kept fresh (drives the badge and the "followed you" cards). */
export function useNewFollowers() {
  const { session } = useAccount()
  const [list, setList] = useState<Follower[]>([])
  useEffect(() => {
    let alive = true
    const load = () => {
      followers().then((f) => {
        if (!alive) return
        const seen = followersSeenAt()
        setList(f.filter((x) => !seen || Date.parse(x.followed_at) > Date.parse(seen)))
      }).catch(() => {})
    }
    load()
    changeListeners.add(load)
    return () => { alive = false; changeListeners.delete(load) }
  }, [session?.user.id])
  return session ? list : []
}

export interface PublicProfile extends Profile { followers: number; following: number; iFollow: boolean; followsMe: boolean }

export async function getProfile(userId: string): Promise<PublicProfile | null> {
  const me = myId()
  const [{ data: p }, a, b, c, d] = await Promise.all([
    supabase.from('profiles').select('id, username, display_name').eq('id', userId).maybeSingle(),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('followee', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', me ?? '').eq('followee', userId),
    supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower', userId).eq('followee', me ?? ''),
  ])
  if (!p) return null
  return { ...(p as Profile), followers: a.count ?? 0, following: b.count ?? 0, iFollow: (c.count ?? 0) > 0, followsMe: (d.count ?? 0) > 0 }
}

/** Their group walk happening now, if I'm allowed to see it (I follow them, or I'm invited). */
export async function liveHikeOf(userId: string): Promise<Hike | null> {
  const since = new Date(Date.now() - LIVE_HOURS * 3600000).toISOString()
  const { data } = await supabase.from('hikes').select('id, host, join_url, trail_name, started_at').eq('host', userId).is('ended_at', null).gt('started_at', since).order('started_at', { ascending: false }).limit(1)
  return (data?.[0] as Hike | undefined) ?? null
}

export interface SharedWalk { id: string; name: string; trail_name: string; activity: 'walk' | 'hike' | 'run'; distance_km: number; active_s: number; ascent_m: number; started_at: string }

/** Finished walks someone has shared with followers (only a summary: no route, so home stays private). */
export async function walksOf(userId: string): Promise<SharedWalk[]> {
  const { data } = await supabase.from('shared_walks').select('id, name, trail_name, activity, distance_km, active_s, ascent_m, started_at').eq('user_id', userId).order('started_at', { ascending: false }).limit(30)
  return (data ?? []) as SharedWalk[]
}

/** After finishing a walk: share its summary with followers. Quietly does nothing when signed out or offline. */
export async function shareFinishedWalk(w: { id: string; name: string; trailName?: string; activity: 'walk' | 'hike' | 'run'; distanceKm: number; activeMs: number; ascent: number; startedAt: number; endedAt?: number }) {
  if (!myId() || !getSettings().shareWalks) return
  if (w.distanceKm < 0.2) return // skip accidental taps
  await supabase.from('shared_walks').upsert({
    id: w.id, name: w.name, trail_name: w.trailName ?? '', activity: w.activity,
    distance_km: Math.round(w.distanceKm * 100) / 100, active_s: Math.round(w.activeMs / 1000), ascent_m: Math.round(w.ascent),
    started_at: new Date(w.startedAt).toISOString(), ended_at: w.endedAt ? new Date(w.endedAt).toISOString() : null,
  }).then(() => {}, () => {})
}

export async function unshareWalk(id: string) {
  if (!myId()) return
  await supabase.from('shared_walks').delete().eq('id', id).then(() => {}, () => {})
}
