import type { LatLng, Trail } from './db'
import { db } from './db'
import { bboxOf, haversineKm, lineKm } from './geo'

/** Read a GPX file (tracks, routes or plain waypoints) into one of your saved trails. */
export function parseGpx(xml: string, fileName = 'Imported trail'): Trail {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.querySelector('parsererror') || !doc.querySelector('gpx')) throw new Error("That file doesn't look like a GPX file.")
  const pt = (el: Element): LatLng | null => {
    const lat = parseFloat(el.getAttribute('lat') ?? ''), lon = parseFloat(el.getAttribute('lon') ?? '')
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null
  }
  const seg = (els: Element[]) => els.map(pt).filter((p): p is LatLng => !!p)
  let lines: LatLng[][] = [...doc.getElementsByTagName('trkseg')].map((s) => seg([...s.getElementsByTagName('trkpt')]))
  if (!lines.some((l) => l.length > 1)) lines = [...doc.getElementsByTagName('rte')].map((r) => seg([...r.getElementsByTagName('rtept')]))
  if (!lines.some((l) => l.length > 1)) lines = [seg([...doc.getElementsByTagName('wpt')])]
  lines = lines.filter((l) => l.length > 1)
  if (!lines.length) throw new Error('No track found in that GPX file.')
  const text = (sel: string) => doc.querySelector(sel)?.textContent?.trim() || ''
  const name = text('trk > name') || text('rte > name') || text('metadata > name') || fileName.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ').trim() || 'Imported trail'
  const all = lines.flat()
  const loop = haversineKm(all[0], all[all.length - 1]) < 0.2
  const desc = text('trk > desc') || text('metadata > desc')
  return {
    id: `g${Date.now().toString(36)}`,
    name: name.slice(0, 80),
    kind: 'hiking',
    distanceKm: lines.reduce((s, l) => s + lineKm(l), 0),
    lines,
    bbox: bboxOf(lines),
    tags: { source: 'gpx', ...(loop ? { roundtrip: 'yes' } : {}), ...(desc ? { description: desc.slice(0, 600) } : {}) },
    packIds: [],
    starred: true,
    fetchedAt: Date.now(),
  }
}

export async function importGpxFile(file: File) {
  if (file.size > 15e6) throw new Error('That file is too big for a trail.')
  const t = parseGpx(await file.text(), file.name)
  await db.trails.put(t)
  return t
}
