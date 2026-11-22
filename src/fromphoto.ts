/**
 * Rebuild a route from a picture (say, a screenshot of a trail someone shared): read the words on it,
 * find the named places (falls, peaks, huts, campsites) and the distance, then join those places up
 * along real OpenStreetMap paths with the route planner. Only the names and numbers are used; the
 * picture's own line is not traced.
 *
 * Reading text: on iPhone the built-in Apple text reader (native TextReader plugin) if this build has it,
 * otherwise Tesseract (free, runs on the phone, downloaded the first time it's needed).
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { LatLng } from './db'
import { haversineKm } from './geo'
import { placesNamed, type PlaceHit } from './findtrails'

export interface TextLine { text: string; x: number; y: number; w: number; h: number }
interface TextReaderPlugin { read(o: { data: string }): Promise<{ lines: TextLine[] }> }
const TextReader = registerPlugin<TextReaderPlugin>('TextReader')

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
interface TessLine { text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }
type Tess = { recognize: (img: Blob | string, lang: string) => Promise<{ data: { lines: TessLine[] } }> }

function loadScript(src: string) {
  return new Promise<void>((ok, fail) => {
    const s = document.createElement('script')
    s.src = src
    s.onload = () => ok()
    s.onerror = () => fail(new Error('Reading text needs a connection the first time.'))
    document.head.appendChild(s)
  })
}

const toBase64 = (f: Blob) => new Promise<string>((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1] ?? '')
  r.onerror = () => fail(r.error)
  r.readAsDataURL(f)
})

export async function imageSize(f: Blob) {
  const url = URL.createObjectURL(f)
  try {
    const img = new Image()
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url })
    return { w: img.naturalWidth || 1, h: img.naturalHeight || 1 }
  } finally { URL.revokeObjectURL(url) }
}

/** Every line of text in the picture, with where it is (0..1 across and down). */
export async function readText(f: Blob): Promise<TextLine[]> {
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TextReader')) {
    try { return (await TextReader.read({ data: await toBase64(f) })).lines } catch { /* fall back */ }
  }
  const w = window as unknown as { Tesseract?: Tess }
  if (!w.Tesseract) await loadScript(TESSERACT)
  const { w: iw, h: ih } = await imageSize(f)
  const { data } = await w.Tesseract!.recognize(f, 'eng')
  return data.lines.map((l) => ({ text: l.text.trim(), x: l.bbox.x0 / iw, y: l.bbox.y0 / ih, w: (l.bbox.x1 - l.bbox.x0) / iw, h: (l.bbox.y1 - l.bbox.y0) / ih }))
}

export interface PictureFacts { title: string; km: number | null; climb: number | null; names: { text: string; x: number; y: number; h?: number }[] }

const UI_WORDS = /^(download|start|save|share|directions|navigate|try\b.*|map|maps|mapbox|satellite|terrain|km|mi|m|ft|reviews?|photos?|overview|details|loop|out & back|easy|moderate|hard|leaflet|openstreetmap.*|©.*)$/i
const STAT = /\d/

/** Pick out the trail's name, its length and climb, and the place names on the map. */
export function readFacts(lines: TextLine[]): PictureFacts {
  const clean = lines.map((l) => ({ ...l, text: l.text.replace(/[›>»|]+/g, ' ').replace(/\s+/g, ' ').trim() })).filter((l) => l.text.length >= 2)
  const all = clean.map((l) => l.text).join('  ')
  const kmM = all.match(/(\d{1,3}(?:[.,]\d{1,2})?)\s?km\b/gi)
  // The trail's length is usually the biggest "x km" that isn't a map scale (scales are round: 1 km, 1.5 km).
  const kms = (kmM ?? []).map((s) => parseFloat(s.replace(',', '.'))).filter((v) => v > 0)
  const km = kms.length ? Math.max(...kms) : null
  const climbM = all.match(/(?:↗|elevation gain|gain|ascent)\s*:?\s*(\d[\d,\s]{0,5})\s?m\b/i)
  const climb = climbM ? parseInt(climbM[1].replace(/[,\s]/g, ''), 10) : null
  // Title: the biggest line that reads like a trail name.
  const trailish = /(loop|trail|walk|hike|route|path|traverse|circuit|falls|peak|pass|gorge|kloof|trek)/i
  const titled = clean.filter((l) => !STAT.test(l.text) && trailish.test(l.text) && !UI_WORDS.test(l.text)).sort((a, b) => b.h - a.h)
  const title = titled[0]?.text ?? ''
  const names = clean
    .filter((l) => l.text !== title && !UI_WORDS.test(l.text) && /[a-z]{3}/i.test(l.text) && !/\d{1,2}:\d{2}/.test(l.text))
    .map((l) => ({ text: l.text.replace(/\s*\d[\d,.]*\s?m$/i, '').replace(/[^\p{L}\p{N}'’ -]/gu, '').trim(), x: l.x + l.w / 2, y: l.y + l.h / 2, h: l.h }))
    .filter((n) => n.text.length >= 4 && n.text.split(' ').length <= 5)
  const seen = new Set<string>()
  return { title, km, climb, names: names.filter((n) => !seen.has(n.text.toLowerCase()) && seen.add(n.text.toLowerCase())) }
}

export interface FoundPlace extends PlaceHit { label: string; px: number; py: number; ph?: number; on: boolean }

/** Find the named places near you (or the map). Places far from the rest are dropped (same name elsewhere). */
export async function findPlaces(facts: PictureFacts, near: LatLng, signal?: AbortSignal): Promise<FoundPlace[]> {
  const out: FoundPlace[] = []
  for (const n of facts.names.slice(0, 14)) {
    if (signal?.aborted) break
    const hits = await placesNamed(n.text, near, signal).catch(() => [] as PlaceHit[])
    const h = hits.find((p) => haversineKm(p.at, near) < 150)
    if (h && !out.some((o) => o.id === h.id)) out.push({ ...h, label: n.text, px: n.x, py: n.y, ph: n.h, on: true })
  }
  if (out.length > 2) {
    // Keep the cluster: drop places much further from the middle than the rest.
    const mid: LatLng = [median(out.map((p) => p.at[0])), median(out.map((p) => p.at[1]))]
    return out.filter((p) => haversineKm(p.at, mid) < 25)
  }
  return out
}
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** A sensible order to visit the chosen places: start at the first, then always the nearest next. */
export function visitOrder(places: LatLng[]): LatLng[] {
  if (places.length < 3) return places
  const left = places.slice(1)
  const out = [places[0]]
  while (left.length) {
    const last = out[out.length - 1]
    left.sort((a, b) => haversineKm(last, a) - haversineKm(last, b))
    out.push(left.shift()!)
  }
  return out
}

// ---------- Lining the picture up with the map ----------

const R = 6378137
const merc = ([lat, lng]: LatLng) => [R * (lng * Math.PI / 180), R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))]
const unmerc = (x: number, y: number): LatLng => [(2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI, (x / R) * 180 / Math.PI]

/** Where a label's place really is in the picture: the icon or dot sits just above the name. */
const anchor = (p: FoundPlace, w: number, h: number) => [p.px * w, (p.py - (p.ph ?? 0.012) * 1.1) * h]

/**
 * Line the picture up with the map from the places found on it (screenshots of maps are north-up,
 * so: one scale and a shift). Returns the picture's corners on the map, or null if it doesn't fit.
 */
export function fitPicture(places: FoundPlace[], w: number, h: number): [LatLng, LatLng] | null {
  let pts = places.map((p) => ({ pix: anchor(p, w, h), geo: merc(p.at) }))
  const solve = (ps: typeof pts) => {
    const n = ps.length
    const mpx = ps.reduce((s, p) => s + p.pix[0], 0) / n, mpy = ps.reduce((s, p) => s + p.pix[1], 0) / n
    const mgx = ps.reduce((s, p) => s + p.geo[0], 0) / n, mgy = ps.reduce((s, p) => s + p.geo[1], 0) / n
    let num = 0, den = 0
    for (const p of ps) {
      const ax = p.pix[0] - mpx, ay = -(p.pix[1] - mpy), bx = p.geo[0] - mgx, by = p.geo[1] - mgy
      num += ax * bx + ay * by
      den += ax * ax + ay * ay
    }
    const k = den ? num / den : 0
    const f = (x: number, y: number) => [mgx + k * (x - mpx), mgy - k * (y - mpy)]
    const err = ps.map((p) => { const q = f(p.pix[0], p.pix[1]); return Math.hypot(q[0] - p.geo[0], q[1] - p.geo[1]) })
    return { k, f, err }
  }
  if (pts.length < 2) return null
  let fit = solve(pts)
  // A name matched to the wrong place: drop the worst one and try again.
  while (pts.length > 2) {
    const worst = fit.err.indexOf(Math.max(...fit.err))
    const typical = [...fit.err].sort((a, b) => a - b)[Math.floor(fit.err.length / 2)]
    if (fit.err[worst] < Math.max(250, typical * 3)) break
    pts = pts.filter((_, i) => i !== worst)
    fit = solve(pts)
  }
  if (!(fit.k > 0)) return null
  const [x0, y0] = fit.f(0, 0), [x1, y1] = fit.f(w, h)
  const nw = unmerc(x0, y0), se = unmerc(x1, y1)
  if (haversineKm(nw, se) > 80 || haversineKm(nw, se) < 0.2) return null
  return [[se[0], nw[1]], [nw[0], se[1]]] // [south-west, north-east]
}
