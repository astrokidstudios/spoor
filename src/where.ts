import { db, type LatLng, type Trail } from './db'
import { fmtKm } from './geo'
import { getMap } from './mapbus'

/**
 * Free, offline ways to say where you are: GPS coordinates, a Plus Code and the nearest trail.
 * No accounts or paid APIs. Any map app, rescue service or person can use the coordinates.
 */

const OLC = '23456789CFGHJMPQRVWX'

/** Full 10-digit Plus Code (Open Location Code), about 14 m square. Google Maps can search for it. */
export function plusCode(lat: number, lng: number) {
  lat = Math.min(90, Math.max(-90, lat))
  lng = ((((lng + 180) % 360) + 360) % 360) - 180
  const la = Math.min(Math.floor((lat + 90) * 8000), 180 * 8000 - 1)
  const lo = Math.floor((lng + 180) * 8000)
  let c = ''
  for (let i = 4; i >= 0; i--) {
    const p = 20 ** i
    c += OLC[Math.floor(la / p) % 20] + OLC[Math.floor(lo / p) % 20]
  }
  return c.slice(0, 8) + '+' + c.slice(8)
}

/** Metres from a point to a polyline, using a flat approximation (fine over a few km). */
function distToLineM([lat, lng]: LatLng, line: LatLng[]) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110540
  let best = Infinity
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][1] - lng) * kx, ay = (line[i][0] - lat) * ky
    if (i === 0) { best = Math.min(best, Math.hypot(ax, ay)); continue }
    const bx = (line[i - 1][1] - lng) * kx, by = (line[i - 1][0] - lat) * ky
    const dx = ax - bx, dy = ay - by
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(bx * dx + by * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(bx + t * dx, by + t * dy))
  }
  return best
}

/** "On Sphinx Trail" or "450 m from Sphinx Trail", from trails on the map or saved offline. Works with no signal. */
export async function nearestTrail(lat: number, lng: number): Promise<string | undefined> {
  const seen = new Map<string, Trail>()
  for (const t of getMap().trails) seen.set(t.id, t)
  try {
    const pad = 0.05
    const saved = await db.trails.filter((t) => lat >= t.bbox[0] - pad && lat <= t.bbox[2] + pad && lng >= t.bbox[1] - pad && lng <= t.bbox[3] + pad).toArray()
    for (const t of saved) seen.set(t.id, t)
  } catch { /* no saved trails */ }
  let best: { name: string; m: number } | undefined
  for (const t of seen.values()) {
    if (!t.name || /^(path|track|footway)$/i.test(t.name)) continue
    for (const line of t.lines) {
      const m = distToLineM([lat, lng], line)
      if (!best || m < best.m) best = { name: t.name, m }
    }
  }
  if (!best || best.m > 3000) return undefined
  return best.m <= 40 ? `On ${best.name}` : `${fmtKm(best.m / 1000)} from ${best.name}`
}

export interface Where { lat: number; lng: number; acc?: number; alt?: number | null; words?: string; near?: string }

export const coordsText = (w: Where) => `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}`
export const googleMapsUrl = (w: Where) => `https://www.google.com/maps/dir/?api=1&destination=${w.lat.toFixed(6)},${w.lng.toFixed(6)}`
export const appleMapsUrl = (w: Where, label = 'Hiker') => `https://maps.apple.com/?ll=${w.lat.toFixed(6)},${w.lng.toFixed(6)}&q=${encodeURIComponent(label)}`

/** Plain text that reads well in an SMS or WhatsApp, and that a rescuer can type into any map. */
export function whereText(w: Where) {
  const lines = []
  if (w.near) lines.push(w.near)
  lines.push(`GPS ${coordsText(w)}${w.acc ? ` (±${Math.round(w.acc)} m)` : ''}`)
  lines.push(`Plus code ${plusCode(w.lat, w.lng)}`)
  if (w.alt != null) lines.push(`Altitude ${Math.round(w.alt)} m`)
  if (w.words) lines.push(`///${w.words}`)
  lines.push(`Map: https://maps.google.com/?q=${w.lat.toFixed(6)},${w.lng.toFixed(6)}`)
  return lines.join('\n')
}
