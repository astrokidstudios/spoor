import Dexie, { type EntityTable } from 'dexie'

/** [south, west, north, east] */
export type BBox = [number, number, number, number]
export type LatLng = [number, number]

export type TrailKind = 'hiking' | 'walking' | 'running' | 'path'

export interface Trail {
  id: string // e.g. r123 (OSM relation) or w:Name (merged named ways)
  name: string
  kind: TrailKind
  distanceKm: number
  lines: LatLng[][]
  bbox: BBox
  tags: Record<string, string>
  /** Offline areas this trail was saved with. */
  packIds: string[]
  starred?: boolean
  /** Your groups this saved trail is in, e.g. "Drakensberg" or "Bucket list". */
  groups?: string[]
  /** Elevation profile: [distanceKm, metres] pairs, filled in when the trail is opened online. */
  profile?: [number, number][]
  ascent?: number
  descent?: number
  fetchedAt: number
}

export interface Group {
  id: string
  name: string
  createdAt: number
}

export interface Pack {
  id: string
  name: string
  bbox: BBox
  minZoom: number
  maxZoom: number
  tileSource: string
  tileCount: number
  tilesDone: number
  tileBytes: number
  trailCount: number
  speciesCount: number
  status: 'downloading' | 'ready' | 'partial'
  error?: string
  createdAt: number
  /** ISO country code of the area (for emergency numbers), e.g. "ZA". */
  country?: string
  region?: string // province / state
}

export interface Species {
  id: string // packId:taxonId
  packId: string
  taxonId: number
  name: string // scientific
  common: string
  group: string // iNaturalist iconic taxon, e.g. Aves
  count: number
  rank: number // position in the area's list (most seen first)
  photoUrl?: string
  photoAttribution?: string
  photo?: Blob
  summary?: string
  wikiUrl?: string
  status?: string // conservation status
  snake?: boolean
  /** Not recorded inside the area itself but within a wider radius around it. */
  nearby?: boolean
}

export interface Sighting {
  taxonId: number
  seenAt: number
  note?: string
}

/** A trail search we've already done, so the same area loads instantly next time. */
export interface Search {
  id: string
  bbox: BBox // the (padded) area that was searched
  at: number
  trailIds: string[]
}

export interface WalkPoint {
  t: number
  lat: number
  lng: number
  alt: number | null
  acc: number
  /** Increases after each pause, so the track and distance don't jump across a gap. */
  seg: number
}

export type Activity = 'walk' | 'hike' | 'run'

/** A recorded walk, hike or run. */
export interface Walk {
  id: string
  name: string
  activity: Activity
  status: 'recording' | 'paused' | 'done'
  startedAt: number
  endedAt?: number
  /** Time spent recording (pauses not counted), up to resumedAt. */
  activeMs: number
  resumedAt?: number
  points: WalkPoint[]
  distanceKm: number
  ascent: number
  descent: number
  calories: number
  weightKg: number
  /** Trail being followed, for progress along it. */
  trailId?: string
  trailName?: string
  trailKm?: number
  trailShape?: 'loop' | 'out-back'
  /** Sample point of the followed trail nearest where you started (for the way back on an out-and-back). */
  startIdx?: number
  /** Which sample points of the followed trail have been passed. */
  visited?: number[]
}

export interface Photo {
  id: string
  walkId: string
  at: number
  lat?: number
  lng?: number
  blob: Blob
}

export interface Contact {
  id: string
  name: string
  phone: string
  /** Pinned to the top of the Share list. */
  favourite?: boolean
  lastSharedAt?: number
  shareCount?: number
}

export const db = new Dexie('spoor') as Dexie & {
  trails: EntityTable<Trail, 'id'>
  packs: EntityTable<Pack, 'id'>
  species: EntityTable<Species, 'id'>
  sightings: EntityTable<Sighting, 'taxonId'>
  contacts: EntityTable<Contact, 'id'>
  searches: EntityTable<Search, 'id'>
  walks: EntityTable<Walk, 'id'>
  photos: EntityTable<Photo, 'id'>
  groups: EntityTable<Group, 'id'>
}

db.version(1).stores({
  trails: 'id, *packIds',
  packs: 'id, createdAt',
  species: 'id, packId, taxonId, group',
  sightings: 'taxonId',
  contacts: 'id',
})
db.version(2).stores({ searches: 'id, at' })
db.version(3).stores({ walks: 'id, startedAt, status', photos: 'id, walkId' })
db.version(4).stores({ groups: 'id, createdAt' })

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
