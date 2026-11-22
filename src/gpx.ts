import { Capacitor } from '@capacitor/core'
import type { LatLng, Trail, Walk } from './db'
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

// ---------- Saving a recorded walk as a GPX file ----------

const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!)

/** A recorded walk as GPX 1.1: one track segment per stretch between pauses, with heights and times. */
export function walkToGpx(w: Walk): string {
  const segs = new Map<number, string[]>()
  for (const p of w.points) {
    const list = segs.get(p.seg) ?? []
    list.push(`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${p.alt != null ? `<ele>${p.alt.toFixed(1)}</ele>` : ''}<time>${new Date(p.t).toISOString()}</time></trkpt>`)
    segs.set(p.seg, list)
  }
  const type = w.activity === 'run' ? 'running' : 'hiking'
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Trailz" xmlns="http://www.topografix.com/GPX/1/1">
<metadata><name>${esc(w.name)}</name><time>${new Date(w.startedAt).toISOString()}</time></metadata>
<trk><name>${esc(w.name)}</name><type>${type}</type>${w.trailName ? `<desc>${esc(w.trailName)}</desc>` : ''}
${[...segs.values()].map((s) => `<trkseg>\n${s.join('\n')}\n</trkseg>`).join('\n')}
</trk>
</gpx>
`
}

const fileNameOf = (w: Walk) => `${new Date(w.startedAt).toISOString().slice(0, 10)} ${w.name}`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) + '.gpx'

/**
 * Hand a walk's GPX file to the phone's share sheet, so it can go to Files, iCloud Drive, AirDrop or
 * another app. Returns false if the share sheet was closed without saving.
 */
export async function saveWalkGpx(w: Walk): Promise<boolean> {
  const name = fileNameOf(w)
  const xml = walkToGpx(w)
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Share') && Capacitor.isPluginAvailable('Filesystem')) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const { uri } = await Filesystem.writeFile({ path: name, data: xml, directory: Directory.Cache, encoding: Encoding.UTF8 })
    try { await Share.share({ title: w.name, files: [uri] }); return true } catch { return false }
  }
  const file = new File([xml], name, { type: 'application/gpx+xml' })
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: w.name }); return true } catch { return false }
  }
  const url = URL.createObjectURL(file)
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return true
}
