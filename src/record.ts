import { useSyncExternalStore } from 'react'
import { db, uid, type Activity, type LatLng, type Photo, type Trail, type Walk, type WalkPoint } from './db'
import { haversineKm, samplePoints } from './geo'
import { setMap } from './mapbus'
import { shapeOf } from './trails'
import { getSettings } from './settings'
import { BG, isNative } from './share'

/** Recording walks: GPS track, time (pauses not counted), distance, climb, calories, photos and progress along a trail. */

interface RecState {
  walk: Walk | null
  /** Live progress along the followed trail. */
  progress: TrailProgress | null
  gpsError: string
  /** Set briefly when you pass each whole kilometre, for a little cheer. */
  cheer: number | null
}
export interface TrailProgress { doneKm: number; leftKm: number; pct: number; offTrailM: number | null }

let state: RecState = { walk: null, progress: null, gpsError: '', cheer: null }
const listeners = new Set<() => void>()
function set(patch: Partial<RecState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const getRec = () => state
export const useRec = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

export const ACTIVITY_LABEL: Record<Activity, string> = { walk: 'Walk', hike: 'Hike', run: 'Run' }

export function elapsedMs(w: Walk, now = Date.now()) {
  return w.activeMs + (w.status === 'recording' && w.resumedAt ? now - w.resumedAt : 0)
}

/** Calories for one stretch, from the ACSM walking/running equations (oxygen cost of moving at a speed up a slope). */
export function stretchCalories(km: number, ms: number, climbM: number, weightKg: number) {
  if (ms <= 0 || km <= 0) return 0
  const min = ms / 60000
  const mPerMin = Math.min((km * 1000) / min, 400) // ignore GPS jumps
  const grade = Math.max(-0.3, Math.min(0.4, climbM / (km * 1000)))
  // Going downhill still costs effort, so don't let a slope push the cost below flat walking.
  const g = Math.max(grade, 0)
  const vo2 = mPerMin > 134 ? 0.2 * mPerMin + 0.9 * mPerMin * g + 3.5 : 0.1 * mPerMin + 1.8 * mPerMin * g + 3.5
  return (vo2 * weightKg * min * 5) / 1000
}

// ---- Trail progress ----
// The trail is cut into points about every 25 m. A point counts as passed once you've been within 40 m of it.
// This works for loops, out-and-back routes and trails mapped in pieces, whatever direction you walk.
let trailSamples: { p: LatLng; km: number }[] = []
let trailFor: string | null = null
const NEAR_KM = 0.04

async function loadTrail(w: Walk) {
  if (!w.trailId) { trailSamples = []; trailFor = null; return }
  if (trailFor === w.trailId) return
  const t = await db.trails.get(w.trailId)
  trailSamples = t ? samplePoints(t.lines, Math.min(2000, Math.max(20, Math.round(t.distanceKm * 40)))) : []
  trailFor = w.trailId
}

function nearestIdx(me: LatLng) {
  let best = Infinity, idx = 0
  trailSamples.forEach((s, i) => { const d = haversineKm(me, s.p); if (d < best) { best = d; idx = i } })
  return { idx, km: best }
}

/**
 * Progress along the followed trail. On an out-and-back the whole outing is twice the trail: first the way out
 * (points passed), then once nearly all of it is passed, the way back (how far you still are from where you started).
 */
function progressFor(w: Walk, me?: LatLng): TrailProgress | null {
  if (!w.trailId || !trailSamples.length) return null
  const n = trailSamples.length
  const visited = (w.visited ?? []).length
  const oneWay = w.trailKm ?? trailSamples[n - 1].km
  const near = me ? nearestIdx(me) : null
  const off = near ? near.km * 1000 : null
  let doneKm = (visited / n) * oneWay
  let total = oneWay
  if (w.trailShape === 'out-back') {
    total = oneWay * 2
    if (visited / n >= 0.9 && near && w.startIdx != null) {
      const scale = oneWay / Math.max(0.001, trailSamples[n - 1].km)
      const fromStart = Math.abs(trailSamples[near.idx].km - trailSamples[w.startIdx].km) * scale
      doneKm = oneWay + Math.max(0, oneWay - fromStart)
    }
  }
  doneKm = Math.min(total, doneKm)
  return { doneKm, leftKm: Math.max(0, total - doneKm), pct: Math.round((doneKm / total) * 100), offTrailM: off }
}

function markVisited(w: Walk, me: LatLng) {
  if (!trailSamples.length) return
  if (w.startIdx == null) w.startIdx = nearestIdx(me).idx
  const v = new Set(w.visited ?? [])
  const before = v.size
  trailSamples.forEach((s, i) => { if (haversineKm(me, s.p) <= NEAR_KM) v.add(i) })
  if (v.size !== before) w.visited = [...v]
}

// ---- GPS ----
let watchId: number | null = null
let nativeWatcher: string | null = null
let lock: WakeLockSentinel | null = null
let lastSave = 0
let altRef: number | null = null

async function keepAwake() {
  try {
    if (state.walk?.status === 'recording' && document.visibilityState === 'visible' && 'wakeLock' in navigator && !lock) {
      lock = await navigator.wakeLock.request('screen')
      lock.addEventListener('release', () => { lock = null })
    }
  } catch { /* not supported */ }
}

function startGps() {
  stopGps()
  if (isNative) {
    BG.addWatcher(
      { backgroundTitle: 'Trailz is recording', backgroundMessage: 'Recording your route, distance and climb.', requestPermissions: true, stale: false, distanceFilter: 5 },
      (loc, err) => {
        if (err) { set({ gpsError: err.code === 'NOT_AUTHORIZED' ? 'Allow Trailz to use your location "Always" so it keeps recording with the screen locked.' : 'GPS problem: ' + err.message }); return }
        if (loc) onFix({ t: loc.time ?? Date.now(), lat: loc.latitude, lng: loc.longitude, alt: loc.altitude ?? null, acc: loc.accuracy })
      },
    ).then((id) => { nativeWatcher = id }).catch(() => {})
  } else if ('geolocation' in navigator) {
    watchId = navigator.geolocation.watchPosition(
      (p) => onFix({ t: p.timestamp || Date.now(), lat: p.coords.latitude, lng: p.coords.longitude, alt: p.coords.altitude, acc: p.coords.accuracy }),
      (e) => set({ gpsError: e.code === 1 ? 'Location permission is off for Trailz.' : 'Waiting for GPS…' }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 60000 },
    )
    void keepAwake()
  } else {
    set({ gpsError: 'Location is not available on this device.' })
  }
}

function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  if (nativeWatcher) void BG.removeWatcher({ id: nativeWatcher }).catch(() => {})
  nativeWatcher = null
  void lock?.release().catch(() => {})
  lock = null
}

/** Handle one GPS fix. Exported for tests. */
export function onFix(f: Omit<WalkPoint, 'seg'>) {
  const w = state.walk
  if (!w || w.status !== 'recording') return
  setMap({ me: { lat: f.lat, lng: f.lng, acc: f.acc } })
  if (state.gpsError) set({ gpsError: '' })
  if (f.acc > 60) return // too rough to use
  const seg = segOf(w)
  const last = w.points[w.points.length - 1]
  const p: WalkPoint = { ...f, seg }
  const here: LatLng = [f.lat, f.lng]
  if (last && last.seg === seg) {
    const km = haversineKm([last.lat, last.lng], here)
    const sec = Math.max(1, (f.t - last.t) / 1000)
    if (km * 1000 < Math.max(4, f.acc / 3)) return // standing still / GPS wobble
    if ((km * 1000) / sec > 12) return // faster than 43 km/h: a GPS jump
    let climb = 0
    if (f.alt != null) {
      // GPS height is noisy, so only count changes of 4 m or more.
      if (altRef == null) altRef = f.alt
      const d = f.alt - altRef
      if (Math.abs(d) >= 4) {
        if (d > 0) w.ascent += d
        else w.descent -= d
        climb = d
        altRef = f.alt
      }
    }
    const before = Math.floor(w.distanceKm)
    w.distanceKm += km
    if (Math.floor(w.distanceKm) > before) {
      const n = Math.floor(w.distanceKm)
      setTimeout(() => set({ cheer: n }), 0)
      setTimeout(() => { if (state.cheer === n) set({ cheer: null }) }, 3500)
    }
    w.calories += stretchCalories(km, f.t - last.t, climb, w.weightKg)
  } else if (f.alt != null) {
    altRef = f.alt
  }
  w.points.push(p)
  needsNewSeg = false
  markVisited(w, here)
  set({ walk: { ...w }, progress: progressFor(w, here) })
  if (Date.now() - lastSave > 5000) void save()
}

const segOf = (w: Walk) => w.points.length ? (w.points[w.points.length - 1].seg + (needsNewSeg ? 1 : 0)) : 0
let needsNewSeg = false

async function save() {
  lastSave = Date.now()
  if (state.walk) await db.walks.put(state.walk)
}

// ---- Controls ----
export async function startWalk(opts: { activity: Activity; trail?: Trail | null }) {
  if (state.walk) return state.walk
  const now = Date.now()
  const t = opts.trail
  const kind = t?.kind === 'running' ? 'run' : opts.activity
  const date = new Date(now).toLocaleDateString(undefined, { weekday: 'long' })
  const w: Walk = {
    id: uid(), name: t ? t.name : `${date} ${ACTIVITY_LABEL[kind].toLowerCase()}`, activity: kind, status: 'recording', startedAt: now, activeMs: 0, resumedAt: now,
    points: [], distanceKm: 0, ascent: 0, descent: 0, calories: 0, weightKg: getSettings().weightKg || 75,
    ...(t ? { trailId: t.id, trailName: t.name, trailKm: t.distanceKm, trailShape: shapeOf(t), visited: [] } : {}),
  }
  if (t && !(await db.trails.get(t.id))) await db.trails.put({ ...t, packIds: t.packIds ?? [] })
  altRef = null
  needsNewSeg = false
  set({ walk: w, progress: null, gpsError: '' })
  await db.walks.put(w)
  await loadTrail(w)
  set({ progress: progressFor(w) })
  startGps()
  return w
}

export async function pauseWalk() {
  const w = state.walk
  if (!w || w.status !== 'recording') return
  stopGps()
  const now = Date.now()
  const next: Walk = { ...w, status: 'paused', activeMs: elapsedMs(w, now), resumedAt: undefined }
  needsNewSeg = true
  set({ walk: next })
  await db.walks.put(next)
}

export async function resumeWalk() {
  const w = state.walk
  if (!w || w.status !== 'paused') return
  const next: Walk = { ...w, status: 'recording', resumedAt: Date.now() }
  set({ walk: next })
  await db.walks.put(next)
  startGps()
}

export async function finishWalk() {
  const w = state.walk
  if (!w) return null
  stopGps()
  const now = Date.now()
  const done: Walk = { ...w, status: 'done', activeMs: elapsedMs(w, now), resumedAt: undefined, endedAt: now }
  await db.walks.put(done)
  set({ walk: null, progress: null, gpsError: '' })
  return done
}

/** Carry on recording after the app was closed or reloaded. Time while the app was closed still counts unless paused. */
export async function resumeRecording() {
  if (state.walk) return
  const w = await db.walks.where('status').anyOf('recording', 'paused').last()
  if (!w) return
  needsNewSeg = true // don't draw a straight line across the gap
  set({ walk: w })
  await loadTrail(w)
  const last = w.points[w.points.length - 1]
  set({ progress: progressFor(w, last ? [last.lat, last.lng] : undefined) })
  if (w.status === 'recording') startGps()
}

export async function deleteWalk(id: string) {
  await db.transaction('rw', db.walks, db.photos, async () => {
    await db.photos.where('walkId').equals(id).delete()
    await db.walks.delete(id)
  })
}

export async function renameWalk(id: string, name: string) {
  await db.walks.update(id, { name })
  if (state.walk?.id === id) set({ walk: { ...state.walk, name } })
}

// ---- Photos ----
/** Shrink a photo to at most 1600 px so a day's photos don't fill the phone. */
async function shrink(file: Blob): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.round(bmp.width * scale)
    c.height = Math.round(bmp.height * scale)
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close()
    return await new Promise<Blob>((ok) => c.toBlob((b) => ok(b ?? file), 'image/jpeg', 0.82))
  } catch {
    return file
  }
}

/** Where was I when this was taken? Use the recorded point closest in time, or the latest point. */
function placeAt(w: Walk, t: number): { lat?: number; lng?: number } {
  if (!w.points.length) return {}
  const inside = t >= w.startedAt - 60000 && t <= (w.endedAt ?? Date.now()) + 60000
  let best = w.points[w.points.length - 1]
  if (inside) for (const p of w.points) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p
  return { lat: best.lat, lng: best.lng }
}

export async function addPhotos(walkId: string, files: FileList | File[], fromCamera: boolean) {
  const w = state.walk?.id === walkId ? state.walk : await db.walks.get(walkId)
  if (!w) return 0
  let n = 0
  for (const f of Array.from(files)) {
    if (!f.type.startsWith('image/')) continue
    const at = fromCamera ? Date.now() : f.lastModified || Date.now()
    const photo: Photo = { id: uid(), walkId, at, blob: await shrink(f), ...placeAt(w, fromCamera ? Date.now() : at) }
    await db.photos.put(photo)
    n++
  }
  return n
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void keepAwake()
    else if (state.walk) void save()
  })
}

// Automated tests feed in a walk without waiting for real GPS.
try {
  if (typeof window !== 'undefined' && localStorage.getItem('spoor.test') === '1') (window as unknown as { __spoorFix: typeof onFix }).__spoorFix = onFix
} catch { /* storage blocked */ }
