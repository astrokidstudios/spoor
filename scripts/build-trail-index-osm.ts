/**
 * The fast way to build Trailz's built-in trail map: download OpenStreetMap for South Africa, Lesotho and
 * Eswatini in one go from Geofabrik (a few hundred MB), cut out the trails on this computer with osmium,
 * and write the same files as build-trail-index.ts. Minutes instead of hours, and no busy public servers.
 *
 *   brew install osmium-tool      # once (Mac). Windows: install osmium-tool via conda or WSL.
 *   npm run trails:fast           # download, cut out trails, write public/trails/
 *   npm run trails:fast -- --opl some.opl   # skip download and osmium, read an OPL file directly (tests)
 *
 * Data © OpenStreetMap contributors (ODbL).
 */
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseTrails, type OsmElement } from '../src/trails'
import { TILE_DEG, tileKey, packTrail, type IndexEntry, type TrailIndex } from '../src/trailindex'

const REGION: [number, number, number, number] = [-35, 16, -22, 33]
const OUT = new URL('public/trails/', pathToFileURL(process.cwd() + '/'))
const WORK = new URL('node_modules/.cache/trails-osm/', pathToFileURL(process.cwd() + '/'))
const EXTRACTS = ['https://download.geofabrik.de/africa/south-africa-latest.osm.pbf', 'https://download.geofabrik.de/africa/swaziland-latest.osm.pbf']

const oplArg = process.argv.indexOf('--opl')
let opl = oplArg > 0 ? process.argv[oplArg + 1] : ''

function run(cmd: string, args: string[]) {
  console.log('$', cmd, args.join(' '))
  execFileSync(cmd, args, { stdio: 'inherit' })
}

if (!opl) {
  try { execFileSync('osmium', ['--version'], { stdio: 'ignore' }) } catch {
    console.error('osmium is not installed. On a Mac: brew install osmium-tool'); process.exit(1)
  }
  mkdirSync(WORK, { recursive: true })
  const dir = fileURLToPath(WORK) // a real path: the folder name may contain spaces
  const files: string[] = []
  for (const url of EXTRACTS) {
    const f = dir + url.split('/').pop()
    // Re-download only if older than a day.
    if (!existsSync(f) || Date.now() - statSync(f).mtimeMs > 24 * 3600e3) run('curl', ['-L', '--fail', '-o', f, url])
    files.push(f)
  }
  run('osmium', ['merge', '--overwrite', '-o', dir + 'region.osm.pbf', ...files])
  // Everything the trail query asks for (the exact rules are applied below, while reading).
  run('osmium', ['tags-filter', '--overwrite', '-o', dir + 'trails.osm.pbf', dir + 'region.osm.pbf',
    'r/route=hiking,foot,walking,running,fitness_trail',
    'w/highway=path,footway,bridleway,track',
    'n/natural=peak,waterfall,cave_entrance,saddle,spring,rock', 'n/waterway=waterfall',
    'n/tourism=alpine_hut,wilderness_hut,viewpoint,camp_site,picnic_site,hotel,guest_house,chalet',
    'n/amenity=shelter', 'n/highway=trailhead', 'n/mountain_pass=yes', 'n/place=town,village,hamlet,locality,isolated_dwelling'])
  run('osmium', ['add-locations-to-ways', '--overwrite', '-o', dir + 'trails.opl', dir + 'trails.osm.pbf'])
  opl = dir + 'trails.opl'
}

// ---- Read the OPL file (one object per line; node locations are written into each way) ----
const unesc = (s: string) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
function tagsOf(field: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!field || field.length < 2) return out
  for (const kv of field.slice(1).split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) out[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1))
  }
  return out
}
const fieldsOf = (line: string) => {
  const f: Record<string, string> = {}
  for (const part of line.split(' ')) if (part) f[part[0]] = part
  return f
}
const lines = () => createInterface({ input: createReadStream(opl), crlfDelay: Infinity })

const ROUTE = /^(hiking|foot|walking|running|fitness_trail)$/
const NAMED_WAY = /^(path|bridleway|track)$/
const SAC_WAY = /^(path|footway|track)$/
const isMark = (t: Record<string, string>) => !!t.name && (
  /^(peak|waterfall|cave_entrance|saddle|spring|rock)$/.test(t.natural ?? '') || t.waterway === 'waterfall' ||
  /^(alpine_hut|wilderness_hut|viewpoint|camp_site|picnic_site|hotel|guest_house|chalet)$/.test(t.tourism ?? '') ||
  t.amenity === 'shelter' || t.highway === 'trailhead' || t.mountain_pass === 'yes' ||
  /^(town|village|hamlet|locality|isolated_dwelling)$/.test(t.place ?? ''))

// Pass 1: route relations, and which ways they need.
interface Rel { id: number; tags: Record<string, string>; members: { ref: number; role: string }[] }
const rels: Rel[] = []
const wantWays = new Set<number>()
for await (const line of lines()) {
  if (line[0] !== 'r') continue
  const f = fieldsOf(line)
  const tags = tagsOf(f.T)
  if (tags.type !== 'route' || !ROUTE.test(tags.route ?? '')) continue
  const members = (f.M?.slice(1) || '').split(',').filter((m) => m[0] === 'w').map((m) => { const at = m.indexOf('@'); return { ref: Number(m.slice(1, at)), role: unesc(m.slice(at + 1)) } })
  members.forEach((m) => wantWays.add(m.ref))
  rels.push({ id: Number(f.r.slice(1)), tags, members })
}
console.log(`${rels.length} trail routes`)

// Pass 2: ways (with their points) and landmark nodes.
type Pt = { lat: number; lon: number }
const wayGeom = new Map<number, Pt[]>()
const elements: (OsmElement & { bb: [number, number, number, number] })[] = []
const bbOf = (pts: Pt[]): [number, number, number, number] => {
  let s = 90, w = 180, n = -90, e = -180
  for (const p of pts) { if (p.lat < s) s = p.lat; if (p.lat > n) n = p.lat; if (p.lon < w) w = p.lon; if (p.lon > e) e = p.lon }
  return [s, w, n, e]
}
for await (const line of lines()) {
  const c = line[0]
  if (c === 'n') {
    const f = fieldsOf(line)
    const tags = tagsOf(f.T)
    if (!isMark(tags) || !f.x || !f.y) continue
    const lat = Number(f.y.slice(1)), lon = Number(f.x.slice(1))
    elements.push({ type: 'node', id: Number(f.n.slice(1)), lat, lon, tags, bb: [lat, lon, lat, lon] })
  } else if (c === 'w') {
    const f = fieldsOf(line)
    const id = Number(f.w.slice(1))
    const tags = tagsOf(f.T)
    const hw = tags.highway ?? ''
    const own = (NAMED_WAY.test(hw) && !!tags.name) || (SAC_WAY.test(hw) && !!tags.sac_scale)
    if (!own && !wantWays.has(id)) continue
    const geometry: Pt[] = []
    for (const ref of (f.N?.slice(1) || '').split(',')) {
      const xi = ref.indexOf('x'), yi = ref.indexOf('y')
      if (xi < 0 || yi < 0) continue
      geometry.push({ lat: Number(ref.slice(yi + 1)), lon: Number(ref.slice(xi + 1, yi)) })
    }
    if (geometry.length < 2) continue
    if (wantWays.has(id)) wayGeom.set(id, geometry)
    if (own) elements.push({ type: 'way', id, tags, geometry, bb: bbOf(geometry) })
  }
}
for (const r of rels) {
  const members = r.members.map((m) => ({ type: 'way', role: m.role, geometry: wayGeom.get(m.ref) })).filter((m) => m.geometry)
  if (!members.length) continue
  elements.push({ type: 'relation', id: r.id, tags: r.tags, members, bb: bbOf(members.flatMap((m) => m.geometry!)) })
}
console.log(`${elements.length} trail pieces and landmarks`)

// ---- Same as build-trail-index.ts: work through 1-degree areas, so names and joins match ----
const boxes = new Map<string, typeof elements>()
for (const el of elements) {
  for (let s = Math.floor(el.bb[0]); s <= Math.floor(el.bb[2]); s++)
    for (let w = Math.floor(el.bb[1]); w <= Math.floor(el.bb[3]); w++) {
      if (s < REGION[0] || s >= REGION[2] || w < REGION[1] || w >= REGION[3]) continue
      const k = `${s},${w}`
      const list = boxes.get(k) ?? []
      list.push(el)
      boxes.set(k, list)
    }
}

mkdirSync(OUT, { recursive: true })
for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(new URL(f, OUT))
type PackedT = ReturnType<typeof packTrail>
const tiles = new Map<string, Map<string, PackedT>>()
const index = new Map<string, IndexEntry>()
for (const [, els] of [...boxes].sort()) {
  for (const t of parseTrails(els)) {
    if (index.has(t.id)) continue
    const c: [number, number] = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2]
    const key = tileKey(c[0], c[1])
    const tile = tiles.get(key) ?? new Map()
    tile.set(t.id, packTrail(t))
    tiles.set(key, tile)
    index.set(t.id, [t.id, t.name, t.kind, +t.distanceKm.toFixed(2), key, +c[0].toFixed(4), +c[1].toFixed(4), t.tags['trailz:named'] === 'guessed' || t.tags['trailz:named'] === 'none' ? 0 : 1])
  }
}
let bytes = 0
for (const [key, tile] of tiles) {
  const body = JSON.stringify({ v: 1, trails: [...tile.values()] })
  bytes += body.length
  writeFileSync(new URL(`${key}.json`, OUT), body)
}
const idx: TrailIndex & { doneBoxes: string[] } = { v: 1, at: Date.now(), tileDeg: TILE_DEG, region: REGION, tiles: [...tiles.keys()].sort(), trails: [...index.values()], doneBoxes: [...boxes.keys()] }
writeFileSync(new URL('index.json', OUT), JSON.stringify(idx))
console.log(`\nDone: ${index.size} trails in ${tiles.size} tiles, ${(bytes / 1e6).toFixed(1)} MB (+ index ${(JSON.stringify(idx).length / 1e6).toFixed(1)} MB)`)
