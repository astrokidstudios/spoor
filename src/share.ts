import { useSyncExternalStore } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import { getSettings, PUBLIC_URL, readJSON, writeJSON } from './settings'
import { nearestTrail, plusCode } from './where'

/**
 * Live location sharing.
 * Every few minutes we read the GPS, add a Plus Code and the nearest trail (all free and offline;
 * a what3words address too if you have set your own key),
 * and post it to a private, unguessable ntfy.sh topic. Your contact opens a link to Spoor's
 * follow page, which reads that topic. No accounts or server of our own are needed.
 */

export interface ShareSession {
  topic: string
  contactName: string
  contactPhone: string
  startedAt: number
  everyMin: number
}

export interface Ping {
  t: number // time of the GPS fix
  lat: number
  lng: number
  acc: number
  alt?: number | null
  near?: string
  words?: string
  sent: boolean
  error?: string
}

interface State {
  session: ShareSession | null
  pings: Ping[]
  busy: boolean
  lastError: string
  wakeLock: boolean
}

const KEY = 'spoor.share'
let state: State = { session: readJSON<ShareSession | null>(KEY, null), pings: readJSON<Ping[]>(KEY + '.pings', []), busy: false, lastError: '', wakeLock: false }
const listeners = new Set<() => void>()
function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  writeJSON(KEY, state.session)
  writeJSON(KEY + '.pings', state.pings.slice(-50))
  listeners.forEach((l) => l())
}
export const useShare = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

const randomTopic = () => {
  const a = new Uint8Array(16)
  crypto.getRandomValues(a)
  return 'spoor-' + [...a].map((b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('')
}

export function followLink(s: ShareSession) {
  const name = getSettings().myName.trim()
  const server = getSettings().ntfyServer.replace(/\/$/, '')
  const params = new URLSearchParams()
  if (name) params.set('n', name)
  if (server !== 'https://ntfy.sh') params.set('s', server)
  const q = params.toString()
  return `${PUBLIC_URL}#/follow/${s.topic}${q ? '?' + q : ''}`
}

/** In the native iPhone/Android app, a background location watcher keeps sharing alive with the screen locked. */
export const isNative = Capacitor.isNativePlatform()
const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
let nativeWatcher: string | null = null
let nativeFix: { t: number; lat: number; lng: number; acc: number; alt: number | null } | null = null

export function getPosition(): Promise<GeolocationPosition> {
  if (nativeFix && Date.now() - nativeFix.t < 120000) {
    const f = nativeFix
    return Promise.resolve({ timestamp: f.t, coords: { latitude: f.lat, longitude: f.lng, accuracy: f.acc, altitude: f.alt } } as GeolocationPosition)
  }
  return new Promise((ok, fail) => {
    if (!('geolocation' in navigator)) return fail(new Error('Location is not available on this device.'))
    navigator.geolocation.getCurrentPosition(ok, (e) => fail(new Error(e.code === 1 ? 'Location permission is off for Spoor.' : 'Could not get a GPS fix.')), {
      enableHighAccuracy: true, timeout: 25000, maximumAge: 60000,
    })
  })
}

export async function toWords(lat: number, lng: number): Promise<string | undefined> {
  const key = getSettings().w3wKey.trim()
  if (!key) return undefined
  const res = await fetch(`https://api.what3words.com/v3/convert-to-3wa?coordinates=${lat},${lng}&language=en&key=${encodeURIComponent(key)}`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.words) throw new Error(data?.error?.message || `what3words error ${res.status}`)
  return data.words as string
}

/** The update message. parseUpdate() reads it back on the follow page, so keep the line formats stable. */
export function formatMessage(p: Ping) {
  const lines = []
  if (p.words) lines.push(`///${p.words}`)
  lines.push(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)} (±${Math.round(p.acc)} m)`)
  lines.push(`Plus code ${plusCode(p.lat, p.lng)}`)
  if (p.alt != null) lines.push(`Altitude ${Math.round(p.alt)} m`)
  if (p.near) lines.push(`Where: ${p.near}`)
  lines.push(`Fix ${new Date(p.t).toISOString()}`)
  return lines.join('\n')
}

async function publish(s: ShareSession, p: Ping, title?: string) {
  const server = getSettings().ntfyServer.replace(/\/$/, '')
  const name = getSettings().myName.trim() || 'Your hiker'
  const res = await fetch(server + '/', {
    method: 'POST',
    body: JSON.stringify({
      topic: s.topic,
      title: title ?? `${name} – ${p.words ? '///' + p.words : p.near ?? 'location update'}`,
      message: formatMessage(p),
      tags: ['round_pushpin'],
      click: followLink(s),
    }),
  })
  if (!res.ok) throw new Error(`Could not send (${res.status})`)
}

/** Take a GPS fix and send it. With no signal it fails quietly and the timer tries again 30 s later. */
export async function sendNow() {
  const s = state.session
  if (!s || state.busy) return
  set({ busy: true })
  let ping: Ping | null = null
  try {
    const pos = await getPosition()
    ping = { t: pos.timestamp || Date.now(), lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, alt: pos.coords.altitude, sent: false }
    ping.near = await nearestTrail(ping.lat, ping.lng).catch(() => undefined)
    try {
      ping.words = await toWords(ping.lat, ping.lng)
    } catch (e) {
      ping.error = `what3words: ${(e as Error).message}`
    }
    await publish(s, ping)
    ping.sent = true
    set({ lastError: ping.error ?? '' })
  } catch (e) {
    const msg = navigator.onLine === false ? 'No signal. Will retry on the next update.' : (e as Error).message
    if (ping) ping.error = msg
    set({ lastError: msg })
  } finally {
    set({ busy: false, pings: ping ? [...state.pings, ping] : state.pings })
  }
}

let timer: ReturnType<typeof setInterval> | null = null
let watchId: number | null = null
let lock: WakeLockSentinel | null = null

async function keepAwake() {
  try {
    if (state.session && document.visibilityState === 'visible' && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen')
      lock.addEventListener('release', () => { lock = null; set({ wakeLock: false }) })
      set({ wakeLock: true })
    }
  } catch { /* not supported or refused */ }
}

function due() {
  const s = state.session
  if (!s) return false
  const last = [...state.pings].reverse().find((p) => p.sent)
  return !last || Date.now() - last.t >= s.everyMin * 60000 - 15000
}

function tick() {
  if (due()) void sendNow()
}

/** Resume an active share after the app is reopened. */
export function resumeSharing() {
  if (!state.session || timer) return
  timer = setInterval(tick, 30000)
  if (isNative) {
    // Each location update wakes the app, even in the background, and sends when an update is due.
    BG.addWatcher(
      {
        backgroundTitle: 'Spoor is sharing your location',
        backgroundMessage: `Sending your location to ${state.session.contactName} every ${state.session.everyMin} minutes.`,
        requestPermissions: true,
        stale: false,
        distanceFilter: 5,
      },
      (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') set({ lastError: 'Allow Spoor to use your location "Always" in Settings so it can share with the screen locked.' })
          return
        }
        if (loc) {
          nativeFix = { t: loc.time ?? Date.now(), lat: loc.latitude, lng: loc.longitude, acc: loc.accuracy, alt: loc.altitude }
          tick()
        }
      },
    ).then((id) => { nativeWatcher = id }).catch(() => {})
  } else {
    // Keeping a GPS watch running gives faster, more accurate fixes and helps the app stay active.
    if ('geolocation' in navigator) watchId = navigator.geolocation.watchPosition(() => {}, () => {}, { enableHighAccuracy: true, maximumAge: 60000 })
    void keepAwake()
  }
  tick()
}

export async function startSharing(contactName: string, contactPhone: string) {
  const session: ShareSession = { topic: randomTopic(), contactName, contactPhone, startedAt: Date.now(), everyMin: getSettings().shareEveryMin || 5 }
  set({ session, pings: [], lastError: '' })
  resumeSharing()
  return session
}

export async function stopSharing() {
  const s = state.session
  if (timer) clearInterval(timer)
  timer = null
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  if (nativeWatcher) await BG.removeWatcher({ id: nativeWatcher }).catch(() => {})
  nativeWatcher = null
  nativeFix = null
  await lock?.release().catch(() => {})
  lock = null
  if (s) {
    const last = [...state.pings].reverse().find((p) => p.sent)
    if (last) await publish(s, { ...last, t: Date.now() }, `${getSettings().myName.trim() || 'Your hiker'} stopped sharing`).catch(() => {})
  }
  set({ session: null, wakeLock: false })
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session) {
      void keepAwake()
      tick()
    }
  })
  window.addEventListener('online', () => state.session && tick())
}

// ---------- Following (the contact's side) ----------

export interface Update { t: number; sentAt: number; lat: number; lng: number; acc: number; alt?: number; near?: string; words?: string; title: string; stopped: boolean }

export function parseUpdate(m: { time: number; title?: string; message?: string }): Update | null {
  const msg = m.message ?? ''
  const c = msg.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)(?:\s*\(±(\d+)\s*m\))?/)
  if (!c) return null
  const w = msg.match(/\/\/\/([^\s/]+\.[^\s/]+\.[^\s/]+)/)
  const f = msg.match(/Fix (\d{4}-\d\d-\d\dT[\d:.]+Z)/)
  const alt = msg.match(/^Altitude (-?\d+) m$/m)
  const near = msg.match(/^Where: (.+)$/m)
  const title = m.title ?? ''
  return {
    t: f ? Date.parse(f[1]) : m.time * 1000,
    sentAt: m.time * 1000,
    lat: parseFloat(c[1]), lng: parseFloat(c[2]), acc: c[3] ? parseInt(c[3]) : 0,
    alt: alt ? parseInt(alt[1]) : undefined, near: near?.[1],
    words: w?.[1], title, stopped: /stopped sharing/i.test(title),
  }
}

export async function fetchUpdates(topic: string, server = 'https://ntfy.sh'): Promise<Update[]> {
  const res = await fetch(`${server.replace(/\/$/, '')}/${encodeURIComponent(topic)}/json?poll=1&since=24h`)
  if (!res.ok) throw new Error(`Could not load updates (${res.status})`)
  const text = await res.text()
  return text.split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l) } catch { return null }
  }).filter((m) => m && m.event === 'message').map(parseUpdate).filter((u): u is Update => !!u)
}
