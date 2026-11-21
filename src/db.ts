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
  /** Elevation profile: [distanceKm, metres] pairs, filled in when the trail is opened online. */
  profile?: [number, number][]
  ascent?: number
  descent?: number
  fetchedAt: number
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
}

export interface Sighting {
  taxonId: number
  seenAt: number
  note?: string
}

export interface Contact {
  id: string
  name: string
  phone: string
}

export const db = new Dexie('spoor') as Dexie & {
  trails: EntityTable<Trail, 'id'>
  packs: EntityTable<Pack, 'id'>
  species: EntityTable<Species, 'id'>
  sightings: EntityTable<Sighting, 'taxonId'>
  contacts: EntityTable<Contact, 'id'>
}

db.version(1).stores({
  trails: 'id, *packIds',
  packs: 'id, createdAt',
  species: 'id, packId, taxonId, group',
  sightings: 'taxonId',
  contacts: 'id',
})

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
