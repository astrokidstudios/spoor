import type { LatLng, Trail } from './db'
import { haversineKm } from './geo'
import { readJSON, writeJSON } from './settings'

/**
 * Photos of a trail's surroundings from Wikimedia Commons: free, openly licensed and with no API key.
 * We look around a few points along the trail, keep real landscape-type photos, and nearest first.
 */

export interface TrailPhoto {
  id: string // Commons file title
  thumb: string // ~640 px wide
  full: string // ~1600 px wide
  page: string // Commons page (credit and licence details)
  title: string
  author: string
  licence: string
  km: number // distance from the trail
  lat?: number
  lng?: number
  /** Title or categories suggest a landscape view. */
  scenic?: boolean
  /** For photos found by name rather than location: what the photo is of (e.g. a nearby peak). */
  about?: string
}

const API = 'https://commons.wikimedia.org/w/api.php'
const CACHE_KEY = 'trailz.photos.v3'
const CACHE_MS = 7 * 24 * 3600e3

const stripTags = (s = '') => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim()

/** Up to n points spread along the trail (start, end and in between). */
function samplePoints(t: Pick<Trail, 'lines'>, n: number): LatLng[] {
  const pts = t.lines.flat()
  if (pts.length <= n) return pts
  return Array.from({ length: n }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (n - 1))])
}

/** Distance from a photo to the nearest point of the trail, in km. */
function kmFromTrail(p: LatLng, t: Pick<Trail, 'lines'>) {
  let best = Infinity
  for (const line of t.lines) for (let i = 0; i < line.length; i += Math.max(1, Math.floor(line.length / 200))) best = Math.min(best, haversineKm(p, line[i]))
  return best
}

// Keep real views of the place. Skip: 360° panoramas (2:1 "equirectangular" files that look warped flat),
// maps, logos, space-station shots, and close-ups of animals, insects and plants.
const NOT_A_VIEW = /\b(map|logo|diagram|chart|flag|coat of arms|locator|svg|hdri?|16k|8k|4k|panorama|360|equirectangular|poly haven|preview|inat|iss\d+|view of earth)\b/i
// "Genus species ….jpg": a species photo (the second word is lower case, unlike "Monks Cowl").
const SPECIES_TITLE = /^File:[A-Z][a-z]+ [a-z]+\b/
// Categories that mean "this is a photo of a living thing", not of the landscape.
const SPECIES_CATEGORY = /^[A-Z][a-z]+ [a-z]+(?: [a-z]+)?(?: \(.*\))?$|\b(animals?|mammals?|birds?|insects?|butterflies|moths?|caterpillars?|reptiles?|amphibians?|frogs?|spiders?|flora|fauna|fungi|plants?|flowers?|bovidae|antelopes?|in flight|eating)\b/i
// Words that suggest a good view: these photos go first.
const SCENIC = /\b(mountains?|peak|summit|castle|cowl|falls|waterfall|valley|gorge|river|view|landscape|trail|path|hik(e|ing)|drakensberg|escarpment|cliffs?|ridge|pass|lake|forest|sunrise|sunset|scenery|national park|nature reserve)\b/i

interface CommonsPage {
  title: string
  coordinates?: { lat: number; lon: number }[]
  categories?: { title: string }[]
  imageinfo?: { thumburl?: string; url: string; descriptionurl: string; width: number; height: number; mime: string; extmetadata?: Record<string, { value?: string }> }[]
}

async function geosearch(p: LatLng, radiusM: number, signal?: AbortSignal): Promise<CommonsPage[]> {
  const params = new URLSearchParams({
    action: 'query', format: 'json', origin: '*',
    generator: 'geosearch', ggscoord: `${p[0]}|${p[1]}`, ggsradius: String(Math.round(radiusM)), ggslimit: '100', ggsnamespace: '6',
    prop: 'imageinfo|coordinates|categories', clshow: '!hidden', cllimit: 'max', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1600',
    iiextmetadatafilter: 'Artist|LicenseShortName|ObjectName|ImageDescription',
  })
  const res = await fetch(`${API}?${params}`, { signal })
  if (!res.ok) throw new Error(`Photo server busy (${res.status})`)
  const data = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } }
  return Object.values(data.query?.pages ?? {})
}

function toPhoto(pg: CommonsPage, t: Pick<Trail, 'lines'>): TrailPhoto | null {
  const ii = pg.imageinfo?.[0]
  if (!ii || !/jpe?g/i.test(ii.mime) || ii.width < 800 || ii.height < 500) return null
  const ratio = ii.width / ii.height
  if (ratio >= 1.95 || ratio < 0.55) return null // 360° panoramas and odd strips
  const cats = (pg.categories ?? []).map((c) => c.title.replace(/^Category:/, ''))
  if (NOT_A_VIEW.test(pg.title) || SPECIES_TITLE.test(pg.title) || cats.some((c) => SPECIES_CATEGORY.test(c))) return null
  const m = ii.extmetadata ?? {}
  const full = ii.thumburl ?? ii.url
  const c = pg.coordinates?.[0]
  return {
    id: pg.title,
    full,
    thumb: full.replace(/\/1600px-/, '/640px-'),
    page: ii.descriptionurl,
    title: stripTags(m.ObjectName?.value) || pg.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
    author: stripTags(m.Artist?.value) || 'Unknown',
    licence: stripTags(m.LicenseShortName?.value) || 'See source',
    km: c ? kmFromTrail([c.lat, c.lon], t) : 0,
    lat: c?.lat,
    lng: c?.lon,
    scenic: SCENIC.test(pg.title) || cats.some((c) => SCENIC.test(c)),
  }
}

// ---------- More photos by name (Openverse: openly licensed photos from Flickr, Wikimedia and others) ----------

const OPENVERSE = 'https://api.openverse.org/v1/images/'
const GENERIC_NAME = /^(unnamed|mountain|hard|easy|moderate|expert)?\s*(path|track|trail|route|walk|footway|loop)$/i
const NOT_A_PHOTO = /\b(google earth|banner|screenshot|poster|flyer|sign|logo|map|hotel|bedroom|room|suite|retreat|restaurant|bar|wedding|menu|spa|pool|conference|reception)\b/i
// Place names that are likely landmarks worth a photo search (rather than towns, schools or farms).
const LANDMARK = /\b(peak|castle|cowl|falls|waterfall|mount|mountain|berg|kop|dome|pass|gorge|canyon|valley|river|dam|lake|reserve|national park|park|forest|cave|amphitheatre|cathedral|needle|horn|tower|head|point|bay|beach|cliffs?|ridge)\b/i

interface OpenverseImage {
  id: string; title?: string; url: string; thumbnail?: string; foreign_landing_url?: string
  creator?: string; license: string; license_version?: string; width?: number; height?: number
}

const licenceName = (l: string, v?: string) => (l === 'cc0' ? 'CC0' : l === 'pdm' ? 'Public domain' : `CC ${l.toUpperCase()}${v ? ' ' + v : ''}`)

async function openverse(q: string, signal?: AbortSignal, mustBeScenic = false): Promise<TrailPhoto[]> {
  const params = new URLSearchParams({ q, page_size: '20', mature: 'false' })
  const res = await fetch(`${OPENVERSE}?${params}`, { signal })
  if (!res.ok) throw new Error(`Openverse ${res.status}`)
  const data = (await res.json()) as { results?: OpenverseImage[] }
  const out: TrailPhoto[] = []
  for (const r of data.results ?? []) {
    const w = r.width ?? 0, h = r.height ?? 0
    if (w && h && (w < 500 || w / h >= 1.95 || w / h < 0.55)) continue // tiny files and 360°/banner strips
    const title = stripTags(r.title || '').replace(/^File:/, '').replace(/\.[a-z]{3,4}$/i, '')
    if (NOT_A_VIEW.test(title) || NOT_A_PHOTO.test(title) || SPECIES_TITLE.test('File:' + title)) continue
    // A trail name like "Blindman's Corner" also matches unrelated things: only keep landscape photos for it.
    if (mustBeScenic && !SCENIC.test(title) && !LANDMARK.test(title)) continue
    out.push({
      id: `ov:${r.id}`, thumb: r.thumbnail || r.url, full: r.url, page: r.foreign_landing_url || r.url,
      title: title || q, author: r.creator || 'Unknown', licence: licenceName(r.license, r.license_version),
      km: 0, about: q, scenic: SCENIC.test(title),
    })
  }
  return out
}

/** Names of well-known places near the trail (peaks, falls, parks), from Wikipedia: good search words for photos. */
async function placesNear(p: LatLng, signal?: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', list: 'geosearch', gscoord: `${p[0]}|${p[1]}`, gsradius: '10000', gslimit: '20' })
  const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { signal })
  if (!res.ok) return []
  const data = (await res.json()) as { query?: { geosearch?: { title: string }[] } }
  const titles = (data.query?.geosearch ?? []).map((g) => g.title)
  // Landmarks (peaks, falls, parks) first; they make much better photo searches than towns.
  return [...titles.filter((t) => LANDMARK.test(t)), ...titles.filter((t) => !LANDMARK.test(t))]
}

const rank = (p: TrailPhoto) => (p.about ? 1 : p.scenic ? 0 : 2)

/** Photos for a trail: from the last week's cache if we have them, otherwise from Wikimedia Commons. */
export async function trailPhotos(t: Pick<Trail, 'id' | 'lines' | 'distanceKm'> & { name?: string }, signal?: AbortSignal): Promise<TrailPhoto[]> {
  try { localStorage.removeItem('trailz.photos'); localStorage.removeItem('trailz.photos.v2') } catch { /* old cache format */ }
  const cache = readJSON<Record<string, { at: number; photos: TrailPhoto[] }>>(CACHE_KEY, {})
  const hit = cache[t.id]
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.photos

  const points = samplePoints(t, t.distanceKm > 6 ? 4 : t.distanceKm > 2 ? 3 : 2)
  const radius = Math.min(10000, Math.max(1500, (t.distanceKm * 1000) / points.length))
  const pages = (await Promise.all(points.map((p) => geosearch(p, radius, signal).catch((e) => { if (signal?.aborted) throw e; return [] as CommonsPage[] })))).flat()
  const seen = new Set<string>()
  const photos: TrailPhoto[] = []
  for (const pg of pages) {
    if (seen.has(pg.title)) continue
    seen.add(pg.title)
    const ph = toPhoto(pg, t)
    if (ph) photos.push(ph)
  }
  // Scenic views first, then nearest.
  photos.sort((a, b) => Number(!!b.scenic) - Number(!!a.scenic) || a.km - b.km)

  // Not many geotagged photos? Search by the trail's name and nearby landmarks too (Flickr and more).
  if (photos.filter((p) => p.scenic).length < 8) {
    const fail = (e: unknown) => { if (signal?.aborted) throw e; return [] as TrailPhoto[] }
    // Landmarks within 10 km of the start, middle and end of the trail (Wikipedia allows 10 km per search).
    const lists = await Promise.all(samplePoints(t, 3).map((p) => placesNear(p, signal).catch(() => [] as string[])))
    const all = [...new Set(lists.flat())]
    const names = [...all.filter((n) => LANDMARK.test(n)), ...all.filter((n) => !LANDMARK.test(n))]
    const trailQ = t.name && !GENERIC_NAME.test(t.name.trim()) ? [openverse(t.name, signal, true).catch(fail)] : []
    const placeQ = names.slice(0, 4).map((q) => openverse(q, signal).catch(fail))
    const byName = (await Promise.all([...trailQ, ...placeQ])).flat()
    const titles = new Set(photos.map((p) => p.title.toLowerCase()))
    for (const p of byName) {
      const key = p.title.toLowerCase()
      if (seen.has(p.id) || titles.has(key)) continue
      seen.add(p.id)
      titles.add(key)
      photos.push(p)
    }
    // Geotagged scenic views first, then photos found by name (trail name first), then the rest.
    photos.sort((a, b) => rank(a) - rank(b))
  }
  const out = photos.slice(0, 40)

  // Keep the cache small: newest 60 trails.
  const next = { ...cache, [t.id]: { at: Date.now(), photos: out } }
  const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at)
  writeJSON(CACHE_KEY, Object.fromEntries(keys.slice(0, 60).map((k) => [k, next[k]])))
  return out
}
