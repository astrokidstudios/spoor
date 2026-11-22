/**
 * Builds Trailz's own trail map for southern Africa from OpenStreetMap, so the app finds trails instantly
 * (and offline) instead of waiting on the busy public trail servers.
 *
 *   npm run trails            # whole region (South Africa, Lesotho, Eswatini), takes ~15 minutes
 *   npm run trails -- -30,29,-28,30   # just these areas (whole degrees)
 *   npm run trails -- --fresh          # start again from scratch (otherwise it resumes)
 *
 * Writes public/trails/index.json (every trail's name and where it is, for search) and one file per
 * half-degree tile (public/trails/<key>.json) with the trails themselves. Data © OpenStreetMap contributors (ODbL).
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseTrails, trailQuery } from '../src/trails'
import { TILE_DEG, tileKey, packTrail, type IndexEntry, type TrailIndex } from '../src/trailindex'

const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter']
const REGION: [number, number, number, number] = [-35, 16, -22, 33] // south, west, north, east
const OUT = new URL('public/trails/', pathToFileURL(process.cwd() + '/'))
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function ask(q: string) {
  let last: unknown
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length]
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'Trailz trail index builder' }, signal: AbortSignal.timeout(120_000) })
      if (res.ok) return (await res.json()) as { elements: never[] }
      last = new Error(`${url} ${res.status}`)
    } catch (e) { last = e }
    console.warn('  retrying:', (last as Error).message)
    await sleep(5000 * (attempt + 1))
  }
  throw last
}

const arg = process.argv.slice(2).find((a) => /^-?\d/.test(a))
const fresh = process.argv.includes('--fresh')
const region = arg ? (arg.split(',').map(Number) as [number, number, number, number]) : REGION
mkdirSync(OUT, { recursive: true })

// Pick up where a previous run stopped (the public servers are slow, so a full run can take hours).
type PackedT = ReturnType<typeof packTrail>
const tiles = new Map<string, Map<string, PackedT>>()
const index = new Map<string, IndexEntry>()
let done = new Set<string>()
const idxFile = new URL('index.json', OUT)
if (!fresh && existsSync(idxFile)) {
  const old = JSON.parse(readFileSync(idxFile, 'utf8')) as TrailIndex & { doneBoxes?: string[] }
  done = new Set(old.doneBoxes ?? [])
  for (const e of old.trails) index.set(e[0], e)
  for (const key of old.tiles) {
    const f = new URL(`${key}.json`, OUT)
    if (existsSync(f)) tiles.set(key, new Map((JSON.parse(readFileSync(f, 'utf8')).trails as PackedT[]).map((t) => [t.i, t])))
  }
  console.log(`resuming: ${done.size} areas done, ${index.size} trails so far`)
} else if (fresh) for (const f of readdirSync(OUT)) if (f.endsWith('.json')) unlinkSync(new URL(f, OUT))

function save(touched: Set<string>) {
  for (const key of touched) writeFileSync(new URL(`${key}.json`, OUT), JSON.stringify({ v: 1, trails: [...tiles.get(key)!.values()] }))
  const idx: TrailIndex & { doneBoxes: string[] } = { v: 1, at: Date.now(), tileDeg: TILE_DEG, region: REGION, tiles: [...tiles.keys()].sort(), trails: [...index.values()], doneBoxes: [...done] }
  writeFileSync(idxFile, JSON.stringify(idx))
}

// Busiest hiking areas first, so the useful part is ready early.
const PRIORITY: [number, number][] = [[-30, 29], [-29, 29], [-29, 28], [-26, 27], [-26, 28], [-34, 18], [-34, 19], [-29, 30], [-34, 22], [-34, 23], [-25, 30], [-26, 30]]
const boxes: [number, number][] = []
for (let s = Math.floor(region[0]); s < region[2]; s++) for (let w = Math.floor(region[1]); w < region[3]; w++) boxes.push([s, w])
boxes.sort((a, b) => {
  const pa = PRIORITY.findIndex((p) => p[0] === a[0] && p[1] === a[1]), pb = PRIORITY.findIndex((p) => p[0] === b[0] && p[1] === b[1])
  return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb)
})

for (const [s, w] of boxes) {
  const id = `${s},${w}`
  if (done.has(id)) continue
  const box: [number, number, number, number] = [Math.max(s, region[0]), Math.max(w, region[1]), Math.min(s + 1, region[2]), Math.min(w + 1, region[3])]
  process.stdout.write(`area ${id} … `)
  const data = await ask(trailQuery(box, 180))
  const trails = parseTrails(data.elements)
  const touched = new Set<string>()
  let added = 0
  for (const t of trails) {
    if (index.has(t.id)) continue // found again from the next area over
    const c: [number, number] = [(t.bbox[0] + t.bbox[2]) / 2, (t.bbox[1] + t.bbox[3]) / 2]
    const key = tileKey(c[0], c[1])
    const tile = tiles.get(key) ?? new Map()
    tile.set(t.id, packTrail(t))
    tiles.set(key, tile)
    touched.add(key)
    index.set(t.id, [t.id, t.name, t.kind, +t.distanceKm.toFixed(2), key, +c[0].toFixed(4), +c[1].toFixed(4), t.tags['trailz:named'] === 'guessed' || t.tags['trailz:named'] === 'none' ? 0 : 1])
    added++
  }
  done.add(id)
  save(touched)
  console.log(`${added} new trails (total ${index.size})`)
  await sleep(1500)
}

let bytes = 0
for (const key of tiles.keys()) bytes += JSON.stringify({ v: 1, trails: [...tiles.get(key)!.values()] }).length
console.log(`\nDone: ${index.size} trails in ${tiles.size} tiles, ${(bytes / 1e6).toFixed(1)} MB`)
