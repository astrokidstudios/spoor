/**
 * Trailz's built-in trail map: every hiking route and named path in South Africa, Lesotho and Eswatini,
 * made from OpenStreetMap by scripts/build-trail-index.ts and shipped inside the app (public/trails/).
 * Trails come up instantly and offline; the public trail servers are only asked outside this region
 * or when you tap Refresh.
 */
import type { BBox, LatLng, Trail, TrailKind } from './db'
import { haversineKm } from './geo'

export const TILE_DEG = 0.5
export const tileKey = (lat: number, lng: number) => `${Math.floor(lat / TILE_DEG)}_${Math.floor(lng / TILE_DEG)}`

/** [id, name, kind, km, tile, lat, lng, has a real name (1) or one worked out from nearby places (0)] */
export type IndexEntry = [string, string, TrailKind, number, string, number, number, 0 | 1]
export interface TrailIndex { v: 1; at: number; tileDeg: number; region: BBox; tiles: string[]; trails: IndexEntry[] }

interface Packed { i: string; n: string; k: TrailKind; d: number; b: BBox; l: number[][]; t: Record<string, string> }

const KEEP_TAGS = ['name', 'ref', 'sac_scale', 'trail_visibility', 'operator', 'website', 'description', 'distance', 'roundtrip', 'network', 'from', 'to', 'destination', 'surface', 'ascent', 'route', 'highway', 'trailz:named', 'name:en', 'symbol', 'osmc:symbol', 'duration']

/** Drop points that don't change the shape (Douglas-Peucker, about 6 m). */
function simplify(line: LatLng[], tol = 0.00006): LatLng[] {
  if (line.length < 3) return line
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ax, ay] = line[a], [bx, by] = line[b]
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12
    let max = 0, at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (line[i][0] - ax) - dx * (line[i][1] - ay)) / len
      if (d > max) { max = d; at = i }
    }
    if (max > tol && at > 0) { keep[at] = 1; stack.push([a, at], [at, b]) }
  }
  return line.filter((_, i) => keep[i])
}

/** Small form for shipping: points as whole numbers (1e-5 degrees), each relative to the one before. */
export function packTrail(t: Trail): Packed {
  const tags: Record<string, string> = {}
  for (const k of KEEP_TAGS) if (t.tags[k]) tags[k] = t.tags[k].slice(0, 400)
  const l = t.lines.map((line) => {
    const out: number[] = []
    let px = 0, py = 0
    for (const [la, ln] of simplify(line)) {
      const x = Math.round(la * 1e5), y = Math.round(ln * 1e5)
      out.push(x - px, y - py)
      px = x; py = y
    }
    return out
  })
  return { i: t.id, n: t.name, k: t.kind, d: +t.distanceKm.toFixed(3), b: t.bbox.map((v) => +v.toFixed(5)) as BBox, l, t: tags }
}

function unpack(p: Packed, at: number): Trail {
  const lines = p.l.map((enc) => {
    const out: LatLng[] = []
    let x = 0, y = 0
    for (let i = 0; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; out.push([x / 1e5, y / 1e5]) }
    return out
  })
  return { id: p.i, name: p.n, kind: p.k, distanceKm: p.d, lines, bbox: p.b, tags: { ...p.t, source: p.t.source ?? 'trailz-map' }, packIds: [], fetchedAt: at }
}

const base = () => (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './'
let indexP: Promise<TrailIndex | null> | null = null
const tileCache = new Map<string, Promise<Trail[]>>()

/** The built-in index (names and places of every trail), or null if this build has none. */
export function loadIndex(): Promise<TrailIndex | null> {
  indexP ??= fetch(`${base()}trails/index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<TrailIndex>) : null))
    .catch(() => null)
  return indexP
}

function loadTile(key: string, at: number): Promise<Trail[]> {
  let p = tileCache.get(key)
  if (!p) {
    p = fetch(`${base()}trails/${key}.json`)
      .then((r) => (r.ok ? r.json() : { trails: [] }))
      .then((d: { trails: Packed[] }) => d.trails.map((t) => unpack(t, at)))
      .catch(() => [])
    tileCache.set(key, p)
  }
  return p
}

const inRegion = (idx: TrailIndex, b: BBox) => b[0] >= idx.region[0] - 0.01 && b[1] >= idx.region[1] - 0.01 && b[2] <= idx.region[2] + 0.01 && b[3] <= idx.region[3] + 0.01

/** Built-in trails in this area, or null when the area is outside the built-in map. */
export async function builtInTrails(b: BBox): Promise<Trail[] | null> {
  const idx = await loadIndex()
  if (!idx || !inRegion(idx, b)) return null
  const have = new Set(idx.tiles)
  const pad = idx.tileDeg / 2 // long trails are filed under the tile of their middle
  const keys: string[] = []
  for (let la = Math.floor((b[0] - pad) / idx.tileDeg); la <= Math.floor((b[2] + pad) / idx.tileDeg); la++)
    for (let ln = Math.floor((b[1] - pad) / idx.tileDeg); ln <= Math.floor((b[3] + pad) / idx.tileDeg); ln++) {
      const k = `${la}_${ln}`
      if (have.has(k)) keys.push(k)
    }
  const all = (await Promise.all(keys.map((k) => loadTile(k, idx.at)))).flat()
  return all.filter((t) => !(t.bbox[2] < b[0] || t.bbox[0] > b[2] || t.bbox[3] < b[1] || t.bbox[1] > b[3]))
}

/** Load full trails for index entries. */
export async function trailsFor(entries: IndexEntry[]): Promise<Trail[]> {
  const idx = await loadIndex()
  if (!idx) return []
  const want = new Set(entries.map((e) => e[0]))
  const tiles = [...new Set(entries.map((e) => e[4]))]
  const all = (await Promise.all(tiles.map((k) => loadTile(k, idx.at)))).flat()
  const byId = new Map(all.filter((t) => want.has(t.id)).map((t) => [t.id, t]))
  return entries.map((e) => byId.get(e[0])).filter((t): t is Trail => !!t)
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Trails whose name has every word typed, nearest first. Instant and offline. */
export async function searchIndex(q: string, near: LatLng, limit = 25): Promise<IndexEntry[]> {
  const idx = await loadIndex()
  const words = norm(q).split(' ').filter(Boolean)
  if (!idx || !words.length || norm(q).length < 2) return []
  const hits = idx.trails.filter((e) => { const n = norm(e[1]); return words.every((w) => n.includes(w)) })
  return hits
    .map((e) => ({ e, s: (e[7] ? 0 : 50) + (e[2] === 'path' ? 20 : 0) + haversineKm(near, [e[5], e[6]]) / 10 }))
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.e)
}

/** Rough driving time on SA roads: twisty roads make it ~1.4x the straight line, at ~70 km/h. */
export const driveMinutes = (km: number) => Math.round((km * 1.4) / 70 * 60)

/** Trails within this many minutes' drive of a point, closest first. */
export async function trailsNear(at: LatLng, minutes: number, limit = 60): Promise<{ e: IndexEntry; km: number }[]> {
  const idx = await loadIndex()
  if (!idx) return []
  const maxKm = (minutes / 60) * 70 / 1.4
  return idx.trails
    .map((e) => ({ e, km: haversineKm(at, [e[5], e[6]]) }))
    .filter((x) => x.km <= maxKm && x.e[3] >= 0.8)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit)
}
