import L from 'leaflet'
import type { BBox } from './db'
import { db } from './db'
import { getSettings } from './settings'
import { intersects, lat2y, lng2x, tilesIn } from './geo'

export interface TileSource {
  id: string
  label: string
  url: string // {s} {z} {x} {y} and optionally {k} for an API key
  subdomains: string[]
  maxZoom: number
  /** Deepest zoom we download for offline areas. */
  offlineMaxZoom: number
  /** Most tiles allowed in one offline area. Keyless community servers get a small, polite limit. */
  offlineLimit: number
  concurrency: number
  attribution: string
  needsKey?: boolean
}

export const SOURCES: Record<string, TileSource> = {
  topo: {
    id: 'topo',
    label: 'Topo (contours)',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 17,
    offlineMaxZoom: 15,
    offlineLimit: 2500,
    concurrency: 3,
    attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | Style © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  },
  street: {
    id: 'street',
    label: 'Street',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: [],
    maxZoom: 19,
    offlineMaxZoom: 15,
    offlineLimit: 1500,
    concurrency: 2,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  outdoors: {
    id: 'outdoors',
    label: 'Outdoors (needs free Thunderforest key)',
    url: 'https://{s}.tile.thunderforest.com/outdoors/{z}/{x}/{y}.png?apikey={k}',
    subdomains: ['a', 'b', 'c'],
    maxZoom: 20,
    offlineMaxZoom: 16,
    offlineLimit: 20000,
    concurrency: 6,
    attribution: 'Maps © <a href="https://www.thunderforest.com">Thunderforest</a>, Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    needsKey: true,
  },
}

export function activeSource(): TileSource {
  const s = getSettings()
  if (s.mapStyle === 'outdoors' && s.thunderforestKey) return SOURCES.outdoors
  return SOURCES[s.mapStyle === 'outdoors' ? 'topo' : s.mapStyle]
}

const TILE_CACHE = 'spoor-offline-tiles'
const hasCaches = () => typeof caches !== 'undefined'

/** Real URL to fetch a tile from. */
export function tileUrl(src: TileSource, z: number, x: number, y: number) {
  const s = src.subdomains.length ? src.subdomains[(x + y) % src.subdomains.length] : ''
  return src.url.replace('{s}', s).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{k}', getSettings().thunderforestKey)
}

/** Stable key for the offline cache: same tile = same key, whatever subdomain or API key was used. */
export function tileKey(src: TileSource, z: number, x: number, y: number) {
  return `https://spoor.tiles/${src.id}/${z}/${x}/${y}.png`
}

let cachePromise: Promise<Cache> | null = null
const openCache = () => (cachePromise ??= caches.open(TILE_CACHE))

export async function cachedTile(key: string): Promise<Blob | null> {
  try {
    const t = await db.tiles.get(key)
    if (t) return new Blob([t.data], { type: t.type })
  } catch { /* fall through to the older cache */ }
  if (!hasCaches()) return null
  try {
    const r = await (await openCache()).match(key)
    return r ? await r.blob() : null
  } catch {
    return null
  }
}

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((ok) => { const t = setTimeout(ok, ms); signal.addEventListener('abort', () => { clearTimeout(t); ok() }, { once: true }) })

/** While the app is in the background (phone locked), wait: iPhone pauses the app and its downloads. */
const waitVisible = (signal: AbortSignal) => new Promise<void>((ok) => {
  if (typeof document === 'undefined' || document.visibilityState !== 'hidden' || signal.aborted) return ok()
  const on = () => { if (document.visibilityState !== 'hidden') { document.removeEventListener('visibilitychange', on); ok() } }
  document.addEventListener('visibilitychange', on)
  signal.addEventListener('abort', () => { document.removeEventListener('visibilitychange', on); ok() }, { once: true })
})

/** Fetch one tile, trying again a couple of times if the free tile server is busy. Gives up on a stuck one after 15 s. */
async function fetchTile(url: string, signal: AbortSignal): Promise<{ data: ArrayBuffer; type: string }> {
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitVisible(signal)
    const ac = new AbortController()
    const stop = () => ac.abort()
    signal.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, 15000)
    try {
      const res = await fetch(url, { signal: ac.signal })
      if (res.ok) return { data: await res.arrayBuffer(), type: res.headers.get('content-type') || 'image/png' }
      last = new Error(String(res.status))
      if (res.status === 404) break
    } catch (e) {
      last = e
      // Failed because the phone was locked mid-download: that attempt doesn't count.
      if (document.visibilityState === 'hidden' && !signal.aborted) attempt--
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    }
    if (signal.aborted) break
    await sleep(800 * (attempt + 1) * (attempt + 1), signal)
  }
  throw last
}

/** Leaflet layer that shows downloaded tiles first and falls back to the network. */
export const OfflineTileLayer = L.TileLayer.extend({
  createTile(this: L.TileLayer & { _src: TileSource }, coords: L.Coords, done: L.DoneCallback) {
    const img = document.createElement('img')
    img.alt = ''
    img.setAttribute('role', 'presentation')
    const src = this._src
    const net = () => {
      img.onload = () => done(undefined, img)
      img.onerror = () => done(new Error('tile'), img)
      img.src = tileUrl(src, coords.z, coords.x, coords.y)
    }
    cachedTile(tileKey(src, coords.z, coords.x, coords.y)).then((blob) => {
      if (!blob) return net()
      const u = URL.createObjectURL(blob)
      img.onload = () => { URL.revokeObjectURL(u); done(undefined, img) }
      img.onerror = () => { URL.revokeObjectURL(u); net() }
      img.src = u
    })
    return img
  },
})

export function makeTileLayer(src: TileSource) {
  const layer = new (OfflineTileLayer as unknown as new (u: string, o: L.TileLayerOptions) => L.TileLayer & { _src: TileSource })(src.url, {
    maxZoom: src.maxZoom,
    maxNativeZoom: src.maxZoom,
    attribution: src.attribution,
  })
  layer._src = src
  return layer
}

export interface TileProgress { done: number; failed: number; bytes: number }

/** Download every tile of an area into the offline cache. */
export async function downloadTiles(
  src: TileSource, bbox: BBox, minZ: number, maxZ: number,
  onProgress: (p: TileProgress) => void, signal: AbortSignal,
) {
  const list = [...tilesIn(bbox, minZ, maxZ)]
  const p: TileProgress = { done: 0, failed: 0, bytes: 0 }
  let i = 0
  let lastReport = 0
  async function worker() {
    while (i < list.length && !signal.aborted) {
      const t = list[i++]
      const key = tileKey(src, t.z, t.x, t.y)
      try {
        const have = await db.tiles.get(key)
        if (have) {
          p.bytes += have.data.byteLength
        } else {
          const { data, type } = await fetchTile(tileUrl(src, t.z, t.x, t.y), signal)
          p.bytes += data.byteLength
          await db.tiles.put({ key, data, type })
        }
      } catch (e) {
        if (signal.aborted) return
        // Phone storage full: no point carrying on.
        if ((e as Error)?.name === 'QuotaExceededError') throw new Error('Your phone is out of space for offline maps.')
        p.failed++
      }
      p.done++
      if (Date.now() - lastReport > 250) { lastReport = Date.now(); onProgress({ ...p }) }
    }
  }
  await Promise.all(Array.from({ length: src.concurrency }, worker))
  onProgress({ ...p })
  return p
}

/** Remove a pack's tiles, keeping any that another downloaded area still needs. */
export async function deleteTiles(packId: string) {
  const pack = await db.packs.get(packId)
  if (!pack) return
  const others = (await db.packs.toArray()).filter((p) => p.id !== packId && p.tileSource === pack.tileSource && intersects(p.bbox, pack.bbox))
  const src = SOURCES[pack.tileSource]
  const cache = hasCaches() ? await openCache().catch(() => null) : null
  const covers = (o: (typeof others)[number], z: number, x: number, y: number) =>
    z >= o.minZoom && z <= o.maxZoom && x >= lng2x(o.bbox[1], z) && x <= lng2x(o.bbox[3], z) && y >= lat2y(o.bbox[2], z) && y <= lat2y(o.bbox[0], z)
  for (const t of tilesIn(pack.bbox, pack.minZoom, pack.maxZoom)) {
    if (others.some((o) => covers(o, t.z, t.x, t.y))) continue
    const key = tileKey(src, t.z, t.x, t.y)
    await db.tiles.delete(key)
    await cache?.delete(key)
  }
}
