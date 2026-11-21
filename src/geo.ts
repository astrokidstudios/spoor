import type { BBox, LatLng } from './db'

const R = 6371

export function haversineKm(a: LatLng, b: LatLng) {
  const toRad = Math.PI / 180
  const dLat = (b[0] - a[0]) * toRad
  const dLng = (b[1] - a[1]) * toRad
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function lineKm(line: LatLng[]) {
  let d = 0
  for (let i = 1; i < line.length; i++) d += haversineKm(line[i - 1], line[i])
  return d
}

export function bboxOf(lines: LatLng[][]): BBox {
  let s = 90, w = 180, n = -90, e = -180
  for (const l of lines) for (const [la, lo] of l) {
    if (la < s) s = la
    if (la > n) n = la
    if (lo < w) w = lo
    if (lo > e) e = lo
  }
  return [s, w, n, e]
}

export const intersects = (a: BBox, b: BBox) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3])
export const contains = (outer: BBox, p: LatLng) => p[0] >= outer[0] && p[0] <= outer[2] && p[1] >= outer[1] && p[1] <= outer[3]
export const bboxCenter = (b: BBox): LatLng => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

export function padBBox(b: BBox, km: number): BBox {
  const dLat = km / 111
  const dLng = km / (111 * Math.cos(((b[0] + b[2]) / 2) * (Math.PI / 180)))
  return [b[0] - dLat, b[1] - dLng, b[2] + dLat, b[3] + dLng]
}

export function bboxSizeKm(b: BBox) {
  const h = haversineKm([b[0], b[1]], [b[2], b[1]])
  const w = haversineKm([b[0], b[1]], [b[0], b[3]])
  return { w, h }
}

/** Slippy-map tile maths. */
export const lng2x = (lng: number, z: number) => Math.floor(((lng + 180) / 360) * 2 ** z)
export const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

export function* tilesIn(b: BBox, minZ: number, maxZ: number) {
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lng2x(b[1], z), x1 = lng2x(b[3], z)
    const y0 = lat2y(b[2], z), y1 = lat2y(b[0], z)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) yield { z, x, y }
  }
}

export function countTiles(b: BBox, minZ: number, maxZ: number) {
  let n = 0
  for (let z = minZ; z <= maxZ; z++) n += (lng2x(b[3], z) - lng2x(b[1], z) + 1) * (lat2y(b[0], z) - lat2y(b[2], z) + 1)
  return n
}

/** Resample a set of lines into evenly spaced points (for the elevation profile). */
export function samplePoints(lines: LatLng[][], count: number): { p: LatLng; km: number }[] {
  const pts: LatLng[] = lines.flat()
  if (pts.length < 2) return pts.map((p) => ({ p, km: 0 }))
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const seg = haversineKm(pts[i - 1], pts[i])
    // Jumps between disconnected pieces of a route don't count as distance.
    cum.push(cum[i - 1] + (seg > 1 ? 0 : seg))
  }
  const total = cum[cum.length - 1]
  const out: { p: LatLng; km: number }[] = []
  let j = 0
  for (let k = 0; k < count; k++) {
    const target = (total * k) / (count - 1)
    while (j < cum.length - 2 && cum[j + 1] < target) j++
    out.push({ p: pts[j], km: target })
  }
  return out
}

export const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`)

export function fmtDuration(hours: number) {
  const m = Math.max(5, Math.round((hours * 60) / 5) * 5)
  const h = Math.floor(m / 60)
  return h ? `${h}h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}m` : ''}` : `${m} min`
}
