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
}

const API = 'https://commons.wikimedia.org/w/api.php'
const CACHE_KEY = 'trailz.photos.v2'
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

/** Photos for a trail: from the last week's cache if we have them, otherwise from Wikimedia Commons. */
export async function trailPhotos(t: Pick<Trail, 'id' | 'lines' | 'distanceKm'>, signal?: AbortSignal): Promise<TrailPhoto[]> {
  try { localStorage.removeItem('trailz.photos') } catch { /* old cache format */ }
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
  const out = photos.slice(0, 40)

  // Keep the cache small: newest 60 trails.
  const next = { ...cache, [t.id]: { at: Date.now(), photos: out } }
  const keys = Object.keys(next).sort((a, b) => next[b].at - next[a].at)
  writeJSON(CACHE_KEY, Object.fromEntries(keys.slice(0, 60).map((k) => [k, next[k]])))
  return out
}
