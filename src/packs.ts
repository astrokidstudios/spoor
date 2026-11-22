import { useSyncExternalStore } from 'react'
import type { BBox, Pack } from './db'
import { db, uid } from './db'
import { bboxCenter, countTiles, intersects, padBBox } from './geo'
import { lookupPlace, rememberPlace } from './emergency'
import { activeSource, deleteTiles, downloadTiles, SOURCES, type TileSource } from './tiles'
import { builtInTrails } from './trailindex'
import { cachedSearch, FRESH_MS, fetchTrails, pruneSearches, saveTrails } from './trails'
import { saveWildlife } from './wildlife'

export interface PackPlan { bbox: BBox; minZoom: number; maxZoom: number; tiles: number; mb: number; src: TileSource; tooBig: boolean }

const AVG_TILE_KB = 22

/** Work out how many tiles an area needs, dropping the deepest zoom levels until it fits the source's limit. */
export function planPack(bbox: BBox, viewZoom: number): PackPlan {
  const src = activeSource()
  const minZoom = Math.max(8, Math.min(12, Math.floor(viewZoom) - 2))
  let maxZoom = src.offlineMaxZoom
  let tiles = countTiles(bbox, minZoom, maxZoom)
  while (tiles > src.offlineLimit && maxZoom > minZoom + 1) tiles = countTiles(bbox, minZoom, --maxZoom)
  return { bbox, minZoom, maxZoom, tiles, mb: (tiles * AVG_TILE_KB) / 1024, src, tooBig: tiles > src.offlineLimit || maxZoom < 13 }
}

export interface Job { packId: string; stage: string; pct: number }
const jobs = new Map<string, Job>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let snapshot: Job[] = []
const emit = () => { snapshot = [...jobs.values()]; listeners.forEach((l) => l()) }
export const useJobs = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => snapshot)

function setJob(packId: string, stage: string, pct: number) {
  jobs.set(packId, { packId, stage, pct })
  emit()
}

export async function startPack(name: string, plan: PackPlan) {
  // Ask the browser not to clear our offline data when space runs low (important on iPhone).
  navigator.storage?.persist?.().catch(() => {})
  const pack: Pack = {
    id: uid(), name, bbox: plan.bbox, minZoom: plan.minZoom, maxZoom: plan.maxZoom, tileSource: plan.src.id,
    tileCount: plan.tiles, tilesDone: 0, tileBytes: 0, trailCount: 0, speciesCount: 0, status: 'downloading', createdAt: Date.now(),
  }
  await db.packs.add(pack)
  void runPack(pack, plan.src)
  return pack.id
}

/** Keep the screen on while an area downloads (iPhone pauses the app when the screen locks). */
type Lock = { release: () => Promise<void> }
async function screenOn(): Promise<Lock | null> {
  try {
    const n = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }
    return document.visibilityState === 'visible' && n.wakeLock ? await n.wakeLock.request('screen') : null
  } catch { return null }
}

async function runPack(pack: Pack, src: TileSource) {
  const ac = new AbortController()
  controllers.set(pack.id, ac)
  const errors: string[] = []
  let lock = await screenOn()
  const relock = async () => { if (document.visibilityState === 'visible' && controllers.has(pack.id)) lock = await screenOn() }
  document.addEventListener('visibilitychange', relock)
  try {
    setJob(pack.id, 'Finding trails…', 2)
    // Which country / province, so the right emergency numbers work offline here.
    lookupPlace(bboxCenter(pack.bbox), ac.signal).then((place) => { rememberPlace(place); return db.packs.update(pack.id, place) }).catch(() => {})
    try {
      // Reuse a search from the last day if it covers this area; otherwise ask the trail servers.
      // Inside Trailz's built-in trail map there's nothing to fetch.
      const built = await builtInTrails(pack.bbox).catch(() => null)
      const cached = built ? null : await cachedSearch(pack.bbox, FRESH_MS)
      const trails = built ?? (cached ? cached.trails.filter((t) => intersects(t.bbox, pack.bbox)) : await fetchTrails(pack.bbox, ac.signal))
      await saveTrails(trails, pack.id)
      await db.packs.update(pack.id, { trailCount: trails.length })
    } catch (e) {
      if (ac.signal.aborted) throw e
      errors.push('trails')
    }
    const res = await downloadTiles(src, pack.bbox, pack.minZoom, pack.maxZoom, (p) => {
      setJob(pack.id, `Saving map… ${p.done.toLocaleString()} of ${pack.tileCount.toLocaleString()} tiles`, 5 + (p.done / pack.tileCount) * 75)
    }, ac.signal)
    await db.packs.update(pack.id, { tilesDone: res.done - res.failed, tileBytes: res.bytes })
    if (res.failed > pack.tileCount * 0.05) errors.push(`${res.failed.toLocaleString()} of ${pack.tileCount.toLocaleString()} map tiles (the free map server was busy)`)
    if (ac.signal.aborted) throw new Error('cancelled')
    try {
      const n = await saveWildlife(pack.id, pack.bbox, (msg) => setJob(pack.id, msg, 85), ac.signal)
      await db.packs.update(pack.id, { speciesCount: n })
    } catch (e) {
      if (ac.signal.aborted) throw e
      errors.push('wildlife')
    }
    await db.packs.update(pack.id, { status: errors.length ? 'partial' : 'ready', error: errors.length ? `Some parts didn't download: ${errors.join(', ')}. Try "Update" when you have signal.` : undefined })
  } catch (e) {
    const why = (e as Error)?.message
    await db.packs.update(pack.id, { status: 'partial', error: ac.signal.aborted ? 'Download stopped. Tap Update to finish it.' : `Download stopped${why && why !== 'cancelled' ? `: ${why}` : ''}. Tap Update to finish it.` })
  } finally {
    jobs.delete(pack.id)
    controllers.delete(pack.id)
    document.removeEventListener('visibilitychange', relock)
    void lock?.release().catch(() => {})
    emit()
  }
}

export async function updatePack(id: string) {
  const pack = await db.packs.get(id)
  if (!pack || jobs.has(id) || controllers.has(id)) return
  await db.packs.update(id, { status: 'downloading', error: undefined })
  const src = activeSource().id === pack.tileSource ? activeSource() : SOURCES[pack.tileSource]
  void runPack({ ...pack, status: 'downloading' }, src)
}

export function cancelPack(id: string) {
  controllers.get(id)?.abort()
}

export async function deletePack(id: string) {
  cancelPack(id)
  await deleteTiles(id)
  await db.transaction('rw', db.trails, db.species, db.packs, async () => {
    await db.species.where('packId').equals(id).delete()
    const trails = await db.trails.where('packIds').equals(id).toArray()
    for (const t of trails) {
      const packIds = t.packIds.filter((p) => p !== id)
      if (!packIds.length && !t.starred) await db.trails.delete(t.id)
      else await db.trails.update(t.id, { packIds })
    }
    await db.packs.delete(id)
  })
}

/** Packs left as "downloading" by a closed app are unfinished: carry on with them (saved tiles are skipped). */
export async function tidyPacks() {
  void pruneSearches().catch(() => {})
  const stuck = await db.packs.where('id').noneOf([...jobs.keys()]).filter((p) => p.status === 'downloading').toArray()
  for (const p of stuck) {
    if (navigator.onLine === false) await db.packs.update(p.id, { status: 'partial', error: 'Download was interrupted. Tap Update to finish it.' })
    else void updatePack(p.id)
  }
}

/** Is this area already saved (or being saved) for offline use? */
export async function areaSaved(b: BBox) {
  const packs = await db.packs.toArray()
  return packs.some((p) => p.bbox[0] <= b[0] && p.bbox[1] <= b[1] && p.bbox[2] >= b[2] && p.bbox[3] >= b[3])
}

/** The offline area to save for a trail: the trail plus 1.5 km around it. */
export const trailPackPlan = (t: { bbox: BBox }) => planPack(padBBox(t.bbox, 1.5), 13)

/** Save a trail's map, trails and wildlife for offline use. */
export const saveTrailOffline = (t: { name: string; bbox: BBox }) => startPack(t.name, trailPackPlan(t))
