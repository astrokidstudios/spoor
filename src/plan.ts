import { useSyncExternalStore } from 'react'
import { db, type LatLng, type Trail } from './db'
import { bboxOf, haversineKm, lineKm } from './geo'
import { getMap } from './mapbus'

/**
 * Plot your own route by tapping points on the map.
 * With "magnetic" on, each leg follows real paths: online via BRouter (free, OpenStreetMap-based),
 * offline via the trails Spoor already has on the map or saved. With it off, legs are straight lines.
 */

export type PlanMode = 'walk' | 'bike'
export interface Leg { line: LatLng[]; snapped: boolean; via?: 'online' | 'offline' }
export interface PlanState {
  active: boolean
  magnetic: boolean
  mode: PlanMode
  points: LatLng[]
  legs: Leg[]
  busy: number
  note: string
  /** Walk it there and back: the line is the way out; the return is the same path reversed. */
  outBack: boolean
}

let state: PlanState = { active: false, magnetic: true, mode: 'walk', points: [], legs: [], busy: 0, note: '', outBack: false }
const listeners = new Set<() => void>()
function set(patch: Partial<PlanState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const usePlan = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
export const getPlan = () => state

export const setPlanActive = (active: boolean) => set({ active })
export const setMagnetic = (magnetic: boolean) => set({ magnetic })
export const setPlanMode = (mode: PlanMode) => set({ mode })
export const clearPlan = () => set({ points: [], legs: [], note: '', outBack: false })

/** The whole route as one line. */
export function planLine(s: PlanState = state): LatLng[] {
  if (!s.legs.length) return [...s.points]
  const out: LatLng[] = []
  s.legs.forEach((l, i) => out.push(...(i ? l.line.slice(1) : l.line)))
  return out
}
/** One-way length of what's drawn. */
export const planKm = (s: PlanState = state) => s.legs.reduce((d, l) => d + lineKm(l.line), 0)
/** The whole outing, counting the walk back for out-and-back routes. */
export const planTripKm = (s: PlanState = state) => planKm(s) * (s.outBack ? 2 : 1)

let seq = 0
/** Add a point and work out the leg to it. Legs are filled in as they arrive, in order. */
export async function addPoint(p: LatLng) {
  const points = [...state.points, p]
  if (points.length === 1) return set({ points, note: '', outBack: false })
  const from = points[points.length - 2]
  const idx = points.length - 2
  const legs = [...state.legs]
  legs[idx] = { line: [from, p], snapped: false }
  const my = ++seq
  set({ points, legs, busy: state.busy + 1, outBack: false })
  const leg = await routeLeg(from, p, state.magnetic, state.mode)
  const cur = state
  // Ignore if the point was undone or the route cleared meanwhile.
  if (cur.points[idx] === from && cur.points[idx + 1] === p) {
    const next = [...cur.legs]
    next[idx] = leg
    set({ legs: next, note: noteFor(leg, cur.magnetic) })
  }
  set({ busy: Math.max(0, state.busy - 1) })
  return my
}

function noteFor(leg: Leg, magnetic: boolean) {
  if (!magnetic) return ''
  if (leg.via === 'offline') return 'No signal: snapped to trails Spoor already has.'
  if (!leg.snapped) return 'No path found here, so this part is a straight line.'
  return ''
}

export function undoPoint() {
  const points = state.points.slice(0, -1)
  set({ points, legs: state.legs.slice(0, Math.max(0, points.length - 1)), note: '', outBack: false })
}

/** Finish at the start (loop), or mark it as there and back along the same path. */
export async function finishRoute(how: 'back' | 'loop') {
  const pts = state.points
  if (pts.length < 2) return
  if (how === 'back') return set({ outBack: !state.outBack })
  return addPoint(pts[0])
}

// ---------- Routing ----------

export async function routeLeg(a: LatLng, b: LatLng, magnetic: boolean, mode: PlanMode): Promise<Leg> {
  if (!magnetic) return { line: [a, b], snapped: false }
  if (navigator.onLine !== false) {
    try {
      return { line: await brouter(a, b, mode), snapped: true, via: 'online' }
    } catch { /* fall back to trails we have */ }
  }
  const local = await localRoute(a, b).catch(() => null)
  if (local) return { line: local, snapped: true, via: 'offline' }
  return { line: [a, b], snapped: false }
}

/** BRouter: free routing on OpenStreetMap paths. Hiking profile prefers footpaths; trekking suits bikes. */
async function brouter(a: LatLng, b: LatLng, mode: PlanMode): Promise<LatLng[]> {
  const profile = mode === 'bike' ? 'trekking' : 'hiking-mountain'
  const url = `https://brouter.de/brouter?lonlats=${a[1].toFixed(6)},${a[0].toFixed(6)}|${b[1].toFixed(6)},${b[0].toFixed(6)}&profile=${profile}&alternativeidx=0&format=geojson`
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`route ${res.status}`)
    const data = (await res.json()) as { features?: { geometry?: { coordinates?: number[][] } }[] }
    const coords = data.features?.[0]?.geometry?.coordinates
    if (!coords || coords.length < 2) throw new Error('no route')
    const line: LatLng[] = coords.map((c) => [c[1], c[0]])
    // Join the route to where you actually tapped.
    return [a, ...line, b]
  } finally {
    clearTimeout(t)
  }
}

/**
 * Offline snapping: build a little path network from the trails we have and find the shortest way along it.
 * Path ends within ~20 m of each other count as joined.
 */
export async function localRoute(a: LatLng, b: LatLng): Promise<LatLng[] | null> {
  const pad = 0.03
  const s = Math.min(a[0], b[0]) - pad, n = Math.max(a[0], b[0]) + pad
  const w = Math.min(a[1], b[1]) - pad, e = Math.max(a[1], b[1]) + pad
  const inBox = (t: Trail) => !(t.bbox[2] < s || t.bbox[0] > n || t.bbox[3] < w || t.bbox[1] > e)
  const trails = new Map<string, Trail>()
  getMap().trails.filter(inBox).forEach((t) => trails.set(t.id, t))
  ;(await db.trails.filter(inBox).toArray()).forEach((t) => trails.set(t.id, t))
  if (!trails.size) return null

  // Nodes: points snapped to a ~20 m grid so touching paths share nodes.
  const cell = 0.0002
  const key = (p: LatLng) => `${Math.round(p[0] / cell)},${Math.round(p[1] / cell)}`
  const pos = new Map<string, LatLng>()
  const adj = new Map<string, Map<string, number>>()
  const link = (k1: string, k2: string, d: number) => {
    if (k1 === k2) return
    if (!adj.has(k1)) adj.set(k1, new Map())
    if (!adj.has(k2)) adj.set(k2, new Map())
    const m = adj.get(k1)!
    if (!m.has(k2) || m.get(k2)! > d) { m.set(k2, d); adj.get(k2)!.set(k1, d) }
  }
  for (const t of trails.values()) for (const line of t.lines) {
    let prev: string | null = null
    let prevP: LatLng | null = null
    for (const p of line) {
      const k = key(p)
      if (!pos.has(k)) pos.set(k, p)
      if (prev && prevP) link(prev, k, haversineKm(prevP, p))
      prev = k
      prevP = p
    }
  }
  const nearest = (p: LatLng) => {
    let best: string | null = null, bd = Infinity
    for (const [k, q] of pos) {
      const d = haversineKm(p, q)
      if (d < bd) { bd = d; best = k }
    }
    return bd <= 0.3 ? best : null
  }
  const start = nearest(a), goal = nearest(b)
  if (!start || !goal) return null
  if (start === goal) return [a, pos.get(start)!, b]

  // Dijkstra with a simple binary heap.
  const dist = new Map<string, number>([[start, 0]])
  const from = new Map<string, string>()
  const heap: [number, string][] = [[0, start]]
  const push = (x: [number, string]) => {
    heap.push(x)
    let i = heap.length - 1
    while (i > 0) { const pI = (i - 1) >> 1; if (heap[pI][0] <= heap[i][0]) break; [heap[pI], heap[i]] = [heap[i], heap[pI]]; i = pI }
  }
  const pop = () => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  while (heap.length) {
    const [d, k] = pop()
    if (k === goal) break
    if (d > (dist.get(k) ?? Infinity)) continue
    for (const [k2, w2] of adj.get(k) ?? []) {
      const nd = d + w2
      if (nd < (dist.get(k2) ?? Infinity)) { dist.set(k2, nd); from.set(k2, k); push([nd, k2]) }
    }
  }
  if (!dist.has(goal)) return null
  const path: LatLng[] = []
  for (let k: string | undefined = goal; k; k = from.get(k)) path.push(pos.get(k)!)
  return [a, ...path.reverse(), b]
}

// ---------- Saving ----------

/** Save the plotted route as one of your trails (starred, so it's kept and shows under ★ Saved). */
export async function savePlan(name: string): Promise<Trail | null> {
  const line = planLine()
  if (line.length < 2) return null
  const pts = state.points
  const loop = !state.outBack && pts.length > 2 && haversineKm(pts[0], pts[pts.length - 1]) < 0.15
  const trail: Trail = {
    id: `u${Date.now().toString(36)}`,
    name: name.trim() || 'My route',
    kind: 'hiking',
    distanceKm: lineKm(line),
    lines: [line],
    bbox: bboxOf([line]),
    tags: { source: 'spoor-plan', ...(loop ? { roundtrip: 'yes' } : state.outBack ? { roundtrip: 'no' } : {}), ...(state.mode === 'bike' ? { route: 'bicycle' } : {}) },
    packIds: [],
    starred: true,
    fetchedAt: Date.now(),
  }
  await db.trails.put(trail)
  return trail
}

export const isMyRoute = (t: Trail) => t.tags.source === 'spoor-plan'
