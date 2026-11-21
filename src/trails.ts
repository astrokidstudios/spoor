import type { BBox, LatLng, Trail, TrailKind } from './db'
import { db, uid } from './db'
import { bboxOf, bboxSizeKm, haversineKm, intersects, lineKm, padBBox, samplePoints } from './geo'

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

/** Biggest area we search in one go (km across), so Overpass answers quickly. */
export const MAX_SEARCH_KM = 45

interface OsmGeomPoint { lat: number; lon: number }
interface OsmElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  geometry?: OsmGeomPoint[]
  members?: { type: string; role: string; geometry?: OsmGeomPoint[] }[]
}

function query(b: BBox) {
  const bb = b.map((v) => v.toFixed(5)).join(',')
  return `[out:json][timeout:25];
(
  relation["type"="route"]["route"~"^(hiking|foot|walking|running|fitness_trail)$"](${bb});
  way["highway"~"^(path|footway|bridleway|track)$"]["name"](${bb});
  way["highway"~"^(path|footway|track)$"]["sac_scale"](${bb});
);
out tags geom;`
}

/**
 * The public trail servers are often busy. Ask the first mirror; if it hasn't answered within a few
 * seconds, ask the next one too, and take whichever answers first. Go round once more if all fail.
 */
const HEDGE_MS = 8000
const MIRROR_LIMIT_MS = 30000

async function overpass(q: string, signal?: AbortSignal, onRetry?: (msg: string) => void) {
  let lastErr: unknown
  for (let round = 0; round < 2; round++) {
    if (signal?.aborted) throw new Error('cancelled')
    const controllers: AbortController[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    const stopAll = () => controllers.forEach((c) => c.abort())
    signal?.addEventListener('abort', stopAll)
    try {
      return await new Promise<{ elements: OsmElement[] }>((resolve, reject) => {
        let failed = 0
        let started = 0
        const start = (i: number) => {
          if (i >= OVERPASS.length || started > i || signal?.aborted) return
          started = i + 1
          if (i > 0) onRetry?.('Trail server is slow, asking another one too…')
          const ac = new AbortController()
          controllers.push(ac)
          timers.push(setTimeout(() => ac.abort(), MIRROR_LIMIT_MS))
          timers.push(setTimeout(() => start(i + 1), HEDGE_MS))
          fetch(OVERPASS[i], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ac.signal })
            .then(async (res) => {
              if (!res.ok) throw new Error(`Trail server busy (${res.status})`)
              resolve((await res.json()) as { elements: OsmElement[] })
            })
            .catch((e) => {
              lastErr = e
              failed++
              // A busy server answers fast with an error: move straight on to the next one.
              start(i + 1)
              if (failed >= OVERPASS.length || signal?.aborted) reject(e)
            })
        }
        start(0)
      })
    } catch (e) {
      if (signal?.aborted) throw e
      onRetry?.('Trail servers are busy, trying again…')
    } finally {
      timers.forEach(clearTimeout)
      stopAll()
      signal?.removeEventListener('abort', stopAll)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw lastErr instanceof Error ? lastErr : new Error('Could not reach the trail server')
}

const toLine = (g: OsmGeomPoint[]): LatLng[] => g.map((p) => [p.lat, p.lon])

function kindOf(tags: Record<string, string>): TrailKind {
  const r = tags.route
  if (r === 'running' || r === 'fitness_trail') return 'running'
  if (r === 'hiking') return 'hiking'
  if (r === 'foot' || r === 'walking') return 'walking'
  return 'path'
}

/** Turn raw OpenStreetMap data into trails: whole routes, plus named paths stitched together by name. */
export function parseTrails(elements: OsmElement[]): Trail[] {
  const now = Date.now()
  const out: Trail[] = []
  const routeNames = new Set<string>()
  for (const el of elements) {
    if (el.type !== 'relation') continue
    const tags = el.tags ?? {}
    const lines = (el.members ?? []).filter((m) => m.type === 'way' && m.geometry?.length).map((m) => toLine(m.geometry!))
    if (!lines.length) continue
    const name = tags.name || tags.ref || tags['name:en'] || 'Unnamed route'
    routeNames.add(name.toLowerCase())
    const distanceKm = tags.distance && !isNaN(parseFloat(tags.distance)) ? parseFloat(tags.distance) : lines.reduce((s, l) => s + lineKm(l), 0)
    out.push({ id: `r${el.id}`, name, kind: kindOf(tags), distanceKm, lines, bbox: bboxOf(lines), tags, packIds: [], fetchedAt: now })
  }
  // Paths: group by name (unnamed mountain paths are grouped per difficulty and joined if they touch).
  const groups = new Map<string, { tags: Record<string, string>; lines: LatLng[][]; ids: number[] }>()
  for (const el of elements) {
    if (el.type !== 'way' || !el.geometry?.length) continue
    const tags = el.tags ?? {}
    const name = tags.name || ''
    if (name && routeNames.has(name.toLowerCase())) continue
    const key = name ? `n:${name.toLowerCase()}` : `s:${tags.sac_scale ?? tags.highway}`
    const g = groups.get(key) ?? { tags: {}, lines: [], ids: [] }
    g.tags = { ...tags, ...g.tags }
    g.lines.push(toLine(el.geometry))
    g.ids.push(el.id)
    groups.set(key, g)
  }
  for (const [key, g] of groups) {
    // Split same-named paths that are far apart (two different "Contour Path"s).
    for (const lines of clusters(g.lines)) {
      const distanceKm = lines.reduce((s, l) => s + lineKm(l), 0)
      const named = key.startsWith('n:')
      if (distanceKm < (named ? 0.3 : 0.8)) continue
      const name = g.tags.name || `${difficulty(g.tags)?.label ?? 'Mountain'} path`
      const bbox = bboxOf(lines)
      out.push({ id: `w${g.ids[0]}-${bbox[0].toFixed(3)}`, name, kind: 'path', distanceKm, lines, bbox, tags: g.tags, packIds: [], fetchedAt: now })
    }
  }
  return out.sort((a, b) => rankScore(b) - rankScore(a))
}

function clusters(lines: LatLng[][]): LatLng[][][] {
  const groups: LatLng[][][] = []
  for (const l of lines) {
    const near = groups.find((g) => g.some((m) => endsNear(m, l)))
    if (near) near.push(l)
    else groups.push([l])
  }
  return groups
}
const endsNear = (a: LatLng[], b: LatLng[]) => {
  const ea = [a[0], a[a.length - 1]], eb = [b[0], b[b.length - 1]]
  return ea.some((p) => eb.some((q) => haversineKm(p, q) < 0.5))
}

const rankScore = (t: Trail) => (t.kind === 'path' ? 0 : 100) + (t.tags.name ? 20 : 0) + Math.min(t.distanceKm, 40)

export interface Difficulty { label: string; level: 1 | 2 | 3 | 4; speedKmh: number }
export function difficulty(tags: Record<string, string>): Difficulty | null {
  switch (tags.sac_scale) {
    case 'hiking': return { label: 'Easy', level: 1, speedKmh: 4 }
    case 'mountain_hiking': return { label: 'Moderate', level: 2, speedKmh: 3.2 }
    case 'demanding_mountain_hiking': return { label: 'Hard', level: 3, speedKmh: 2.5 }
    case 'alpine_hiking':
    case 'demanding_alpine_hiking':
    case 'difficult_alpine_hiking': return { label: 'Expert', level: 4, speedKmh: 1.8 }
  }
  return null
}

export type Shape = 'loop' | 'out-back'
export const SHAPE_LABEL: Record<Shape, string> = { loop: 'Loop', 'out-back': 'Out & back' }

/**
 * Loop or out and back? Use the mapper's roundtrip tag if there is one. Otherwise look at the loose ends of the
 * whether the route, joined end to end, finishes within 300 m of where it starts.
 */
export function shapeOf(t: Pick<Trail, 'lines' | 'tags'> & { name?: string }): Shape {
  if (t.tags.roundtrip === 'yes') return 'loop'
  if (t.tags.roundtrip === 'no') return 'out-back'
  if (/\b(loop|circuit|circular|round)\b/i.test(t.name ?? t.tags.name ?? '')) return 'loop'
  // Chain the mapped pieces end to end (always joining the nearest loose end), then compare where the chain starts and ends.
  const rest = t.lines.filter((l) => l.length > 1).map((l) => [...l])
  if (!rest.length) return 'out-back'
  let chain = rest.shift()!
  while (rest.length) {
    const tail = chain[chain.length - 1]
    let best = 0, flip = false, d = Infinity
    rest.forEach((l, i) => {
      const a = haversineKm(tail, l[0]), b = haversineKm(tail, l[l.length - 1])
      if (a < d) { d = a; best = i; flip = false }
      if (b < d) { d = b; best = i; flip = true }
    })
    const next = rest.splice(best, 1)[0]
    chain = chain.concat(flip ? next.reverse() : next)
  }
  return haversineKm(chain[0], chain[chain.length - 1]) <= 0.3 ? 'loop' : 'out-back'
}

/** The whole outing: an out-and-back trail is walked twice, so the distance doubles and you climb both ways. */
export function tripOf(t: Trail) {
  const shape = shapeOf(t)
  const back = shape === 'out-back'
  const km = back ? t.distanceKm * 2 : t.distanceKm
  const climb = back && t.ascent != null ? t.ascent + (t.descent ?? t.ascent) : t.ascent
  return { shape, km, climb, oneWayKm: t.distanceKm }
}

/** Rough moving times for the whole outing. Naismith's rule adds 1 hour per 600 m of climbing when we know it. */
export function estimateHours(t: Trail) {
  const d = difficulty(t.tags)
  const trip = tripOf(t)
  const climb = trip.climb ?? 0
  const walk = trip.km / (d?.speedKmh ?? 4.5) + climb / 600
  const run = trip.km / ((d?.level ?? 1) >= 3 ? 6 : 8.5) + climb / 1200
  return { walk, run }
}

export const KIND_LABEL: Record<TrailKind, string> = { hiking: 'Hiking route', walking: 'Walking route', running: 'Running route', path: 'Trail' }

export async function fetchTrails(b: BBox, signal?: AbortSignal, onRetry?: (msg: string) => void) {
  const { w, h } = bboxSizeKm(b)
  if (w > MAX_SEARCH_KM * 1.5 || h > MAX_SEARCH_KM * 1.5) throw new Error('Zoom in a little to search for trails in this area.')
  const data = await overpass(query(b), signal, onRetry)
  return parseTrails(data.elements)
}

/** Searches stay fresh for a day, are still shown for a week, and are cleared after 30 days. */
export const FRESH_MS = 24 * 3600e3
export const KEEP_MS = 7 * 24 * 3600e3
const PRUNE_MS = 30 * 24 * 3600e3

const containsBox = (o: BBox, i: BBox) => i[0] >= o[0] && i[1] >= o[1] && i[2] <= o[2] && i[3] <= o[3]

/** The newest earlier search that covers this whole view, if it's less than a week old. */
export async function cachedSearch(view: BBox, maxAge = KEEP_MS) {
  const since = Date.now() - maxAge
  const hits = await db.searches.where('at').above(since).filter((s) => containsBox(s.bbox, view)).toArray()
  const s = hits.sort((a, b) => b.at - a.at)[0]
  if (!s) return null
  const trails = (await db.trails.bulkGet(s.trailIds)).filter((t): t is Trail => !!t)
  return { at: s.at, trails: trails.sort((a, b) => rankScore(b) - rankScore(a)) }
}

/**
 * Search the trail servers and remember the result. The area searched is a bit bigger than the view,
 * so small pans and zooms afterwards are answered from the saved copy.
 */
export async function searchAndSave(view: BBox, signal?: AbortSignal, onRetry?: (msg: string) => void) {
  const { w, h } = bboxSizeKm(view)
  const room = MAX_SEARCH_KM * 1.4 - Math.max(w, h)
  const area = room > 0 ? padBBox(view, Math.min(Math.max(w, h) * 0.25, room / 2)) : view
  const trails = await fetchTrails(area, signal, onRetry)
  await saveTrails(trails)
  const at = Date.now()
  await db.searches.add({ id: uid(), bbox: area, at, trailIds: trails.map((t) => t.id) })
  const stored = (await db.trails.bulkGet(trails.map((t) => t.id))).filter((t): t is Trail => !!t)
  return { at, trails: stored }
}

/** Clear out old searches, and trails only kept because of them (saved and starred trails stay). */
export async function pruneSearches() {
  const cutoff = Date.now() - PRUNE_MS
  await db.transaction('rw', db.searches, db.trails, async () => {
    await db.searches.where('at').below(cutoff).delete()
    const keep = new Set((await db.searches.toArray()).flatMap((s) => s.trailIds))
    await db.trails.filter((t) => !t.packIds.length && !t.starred && !keep.has(t.id) && t.fetchedAt < cutoff).delete()
  })
}

/** Trails saved offline that overlap an area. */
export async function offlineTrails(b: BBox) {
  const all = await db.trails.toArray()
  return all.filter((t) => (t.packIds.length || t.starred) && intersects(t.bbox, b)).sort((a, b) => rankScore(b) - rankScore(a))
}

/** Store trails, keeping existing pack links, stars and elevation data. */
export async function saveTrails(trails: Trail[], packId?: string) {
  await db.transaction('rw', db.trails, async () => {
    for (const t of trails) {
      const old = await db.trails.get(t.id)
      const packIds = [...new Set([...(old?.packIds ?? []), ...(packId ? [packId] : [])])]
      await db.trails.put({ ...t, packIds, starred: old?.starred ?? t.starred, profile: old?.profile ?? t.profile, ascent: old?.ascent ?? t.ascent, descent: old?.descent ?? t.descent })
    }
  })
}

/** Elevation profile from Open-Meteo (free, no key). */
export async function fetchProfile(t: Trail) {
  const pts = samplePoints(t.lines, Math.min(100, Math.max(10, Math.round(t.distanceKm * 10))))
  const lat = pts.map((p) => p.p[0].toFixed(5)).join(',')
  const lng = pts.map((p) => p.p[1].toFixed(5)).join(',')
  const res = await fetch(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`)
  if (!res.ok) throw new Error('elevation')
  const { elevation } = (await res.json()) as { elevation: number[] }
  const profile: [number, number][] = pts.map((p, i) => [p.km, elevation[i]])
  let ascent = 0, descent = 0
  for (let i = 1; i < profile.length; i++) {
    const d = profile[i][1] - profile[i - 1][1]
    if (d > 0) ascent += d
    else descent -= d
  }
  return { profile, ascent: Math.round(ascent), descent: Math.round(descent) }
}
