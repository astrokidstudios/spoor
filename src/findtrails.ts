import type { BBox, LatLng, Trail } from './db'
import { db } from './db'
import { padBBox } from './geo'
import { useEffect, useState } from 'react'
import { readJSON, writeJSON } from './settings'
import { overpassQuery, parseTrails, saveTrails } from './trails'

/** A town, peak, reserve or park from the place search. */
export interface PlaceHit {
  id: string
  name: string
  sub: string
  at: LatLng
  bbox?: BBox
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const matches = (name: string, q: string) => norm(q).split(' ').every((w) => norm(name).includes(w))

/** Trails already on this phone (searched before, saved or offline) whose name matches. Works offline. */
export async function localTrailsNamed(q: string, limit = 20) {
  if (norm(q).length < 2) return []
  const all = await db.trails.filter((t) => matches(t.name, q)).limit(limit).toArray()
  return all.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || b.distanceKm - a.distanceKm)
}

/** Overpass regex: every word must appear, in any order, ignoring case. */
function nameRegex(q: string) {
  const words = norm(q).split(' ').filter(Boolean).slice(0, 4)
  return words.map((w) => w.replace(/[.*+?^${}()|[\]\\"]/g, '')).join('.*')
}

/**
 * Named trails anywhere in the country the map is in (walking, hiking and running routes),
 * plus named paths within about 100 km of the map. Found trails are kept, so they open instantly next time.
 */
export async function trailsNamed(q: string, center: LatLng, signal?: AbortSignal): Promise<Trail[]> {
  const re = nameRegex(q)
  if (re.replace(/\.\*/g, '').length < 3) return []
  const bb = padBBox([center[0], center[1], center[0], center[1]], 100).map((v) => v.toFixed(4)).join(',')
  const query = `[out:json][timeout:25];
is_in(${center[0].toFixed(4)},${center[1].toFixed(4)})->.c;
area.c["admin_level"="2"]->.a;
(
  relation["type"="route"]["route"~"^(hiking|foot|walking|running|fitness_trail)$"]["name"~"${re}",i](area.a);
  way["highway"~"^(path|footway|bridleway|track)$"]["name"~"${re}",i](${bb});
);
out tags geom 40;`
  const data = await overpassQuery(query, signal)
  const trails = parseTrails(data.elements).filter((t) => matches(t.name, q))
  await saveTrails(trails)
  const stored = (await db.trails.bulkGet(trails.map((t) => t.id))).filter((t): t is Trail => !!t)
  return stored.sort((a, b) => (a.kind === 'path' ? 1 : 0) - (b.kind === 'path' ? 1 : 0) || b.distanceKm - a.distanceKm)
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: { osm_id: number; osm_type: string; osm_key: string; osm_value: string; name?: string; city?: string; county?: string; state?: string; country?: string; extent?: [number, number, number, number] }
}

const KEEP_KEYS = /^(place|natural|leisure|boundary|tourism|mountain_pass|waterway|landuse|route|highway)$/

/** Places by name (Photon, free, from OpenStreetMap), nearest to the map first. */
export async function placesNamed(q: string, near: LatLng, signal?: AbortSignal): Promise<PlaceHit[]> {
  if (norm(q).length < 3) return []
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=8&lang=en&lat=${near[0].toFixed(3)}&lon=${near[1].toFixed(3)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error('place search')
  const { features } = (await res.json()) as { features: PhotonFeature[] }
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const f of features) {
    const p = f.properties
    if (!p.name || !KEEP_KEYS.test(p.osm_key)) continue
    const sub = [label(p.osm_key, p.osm_value), p.city !== p.name ? p.city : '', p.state, p.country].filter(Boolean).join(' · ')
    const key = `${p.name}|${sub}`
    if (seen.has(key)) continue
    seen.add(key)
    const [lng, lat] = f.geometry.coordinates
    const e = p.extent
    out.push({ id: `${p.osm_type}${p.osm_id}`, name: p.name, sub, at: [lat, lng], bbox: e ? [Math.min(e[1], e[3]), Math.min(e[0], e[2]), Math.max(e[1], e[3]), Math.max(e[0], e[2])] : undefined })
  }
  return out.slice(0, 6)
}

function label(key: string, value: string) {
  if (key === 'natural' && value === 'peak') return 'Peak'
  if (key === 'place') return value === 'city' || value === 'town' ? 'Town' : value === 'village' || value === 'hamlet' ? 'Village' : 'Place'
  if (key === 'leisure' && value === 'nature_reserve') return 'Nature reserve'
  if (key === 'boundary' && (value === 'national_park' || value === 'protected_area')) return 'Park'
  if (key === 'waterway') return 'Waterfall or river'
  if (key === 'tourism') return value === 'camp_site' ? 'Campsite' : value === 'alpine_hut' || value === 'wilderness_hut' ? 'Hut' : 'Attraction'
  return ''
}

/** Look this trail up on AllTrails' own site (a link only; nothing is copied from them). */
export const allTrailsUrl = (t: Pick<Trail, 'name'>, area = '') => `https://www.google.com/search?q=${encodeURIComponent(`${t.name} ${area} site:alltrails.com`.replace(/\s+/g, ' '))}`

const AREA_KEY = 'spoor.trailArea'

/** Province and country a trail is in, e.g. "KwaZulu-Natal, South Africa". Looked up once, then remembered. */
export async function trailArea(t: Pick<Trail, 'id' | 'lines'>, signal?: AbortSignal) {
  const cache = readJSON<Record<string, string>>(AREA_KEY, {})
  if (cache[t.id] !== undefined) return cache[t.id]
  const p = t.lines[0]?.[0]
  if (!p || navigator.onLine === false) return ''
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&lat=${p[0].toFixed(4)}&lon=${p[1].toFixed(4)}&accept-language=en`, { signal })
  if (!res.ok) return ''
  const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {}
  const area = [a.state || a.province || a.region || a.county, a.country].filter(Boolean).join(', ')
  const keys = Object.keys(cache)
  if (keys.length > 500) for (const k of keys.slice(0, 100)) delete cache[k]
  writeJSON(AREA_KEY, { ...cache, [t.id]: area })
  return area
}

export function useTrailArea(t: Pick<Trail, 'id' | 'lines'>) {
  const [area, setArea] = useState(() => readJSON<Record<string, string>>(AREA_KEY, {})[t.id] ?? '')
  useEffect(() => {
    const ac = new AbortController()
    trailArea(t, ac.signal).then((a) => !ac.signal.aborted && setArea(a)).catch(() => {})
    return () => ac.abort()
  }, [t.id]) // eslint-disable-line react-hooks/exhaustive-deps
  return area
}
