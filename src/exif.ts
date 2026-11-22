/**
 * When and where a photo was taken, read from its EXIF data (JPEG only; the iPhone hands photos from the
 * library over as JPEG). Used to put photos added after a walk at the right spot on the route.
 */
export interface PhotoFacts { at?: number; lat?: number; lng?: number }

export async function photoFacts(f: Blob): Promise<PhotoFacts> {
  try {
    return readExif(new DataView(await f.slice(0, 256 * 1024).arrayBuffer()))
  } catch {
    return {}
  }
}

export function readExif(v: DataView): PhotoFacts {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return {}
  let o = 2
  while (o + 4 < v.byteLength) {
    const marker = v.getUint16(o)
    const len = v.getUint16(o + 2)
    if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return readTiff(v, o + 10) // "Exif"
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break
    o += 2 + len
  }
  return {}
}

function readTiff(v: DataView, t: number): PhotoFacts {
  const le = v.getUint16(t) === 0x4949
  const u16 = (p: number) => v.getUint16(p, le)
  const u32 = (p: number) => v.getUint32(p, le)
  const str = (p: number, n: number) => { let s = ''; for (let i = 0; i < n; i++) { const c = v.getUint8(p + i); if (!c) break; s += String.fromCharCode(c) } return s }
  /** Entries of one directory: tag -> [type, count, value offset]. */
  const ifd = (p: number) => {
    const out = new Map<number, [number, number, number]>()
    const n = u16(p)
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12
      out.set(u16(e), [u16(e + 2), u32(e + 4), e + 8])
    }
    return out
  }
  const at = (e: [number, number, number] | undefined, size: number) => (e ? (e[1] * size > 4 ? t + u32(e[2]) : e[2]) : -1)
  const ascii = (e?: [number, number, number]) => (e ? str(at(e, 1), e[1]) : '')
  const rationals = (e?: [number, number, number]) => {
    if (!e) return []
    const p = at(e, 8)
    return Array.from({ length: e[1] }, (_, i) => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1))
  }

  const main = ifd(t + u32(t + 4))
  const out: PhotoFacts = {}
  const exifPtr = main.get(0x8769)
  if (exifPtr) {
    const ex = ifd(t + u32(exifPtr[2]))
    const when = ascii(ex.get(0x9003)) || ascii(ex.get(0x9004)) || ascii(main.get(0x0132))
    const m = when.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/)
    if (m) {
      const off = ascii(ex.get(0x9011)) || ascii(ex.get(0x9010))
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${/^[+-]\d{2}:\d{2}$/.test(off) ? off : ''}`
      const ms = Date.parse(iso) // no offset: the phone's own time zone
      if (Number.isFinite(ms)) out.at = ms
    }
  }
  const gpsPtr = main.get(0x8825)
  if (gpsPtr) {
    const g = ifd(t + u32(gpsPtr[2]))
    const dms = (r: number[]) => (r.length === 3 ? r[0] + r[1] / 60 + r[2] / 3600 : NaN)
    const ref = (e?: [number, number, number]) => (e ? String.fromCharCode(v.getUint8(e[2])) : '')
    const lat = dms(rationals(g.get(2))) * (ref(g.get(1)) === 'S' ? -1 : 1)
    const lng = dms(rationals(g.get(4))) * (ref(g.get(3)) === 'W' ? -1 : 1)
    if (Number.isFinite(lat) && Number.isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng }
  }
  return out
}
