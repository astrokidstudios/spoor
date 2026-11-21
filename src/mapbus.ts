import { useSyncExternalStore } from 'react'
import type L from 'leaflet'
import type { BBox, LatLng, Trail } from './db'
import type { Member } from './group'
import { readJSON, writeJSON } from './settings'

/** Shared state between the map and the side panel. */
export interface MapState {
  trails: Trail[]
  selectedId: string | null
  bounds: BBox | null
  zoom: number
  me: { lat: number; lng: number; acc: number } | null
  preview: BBox | null // area about to be downloaded
  follow: boolean
  /** A recorded walk to draw: its track, photo spots and the trail being followed. */
  track: { lines: LatLng[][]; photos: { id: string; lat: number; lng: number }[]; guide?: LatLng[][] } | null
  /** People on your group walk. */
  group?: Member[] | null
}

const VIEW_KEY = 'spoor.view'
// Default view: Champagne Castle / Monk's Cowl area, Central Drakensberg.
export const savedView = readJSON<{ c: LatLng; z: number }>(VIEW_KEY, { c: [-29.035, 29.37], z: 12 })

let state: MapState = { trails: [], selectedId: null, bounds: null, zoom: savedView.z, me: null, preview: null, follow: false, track: null }
const listeners = new Set<() => void>()
export const getMap = () => state
export function setMap(patch: Partial<MapState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}
export const useMapState = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

let map: L.Map | null = null
export const bindMap = (m: L.Map | null) => { map = m }
export const leaflet = () => map

export function rememberView(c: LatLng, z: number) {
  writeJSON(VIEW_KEY, { c, z })
}

export function fitBBox(b: BBox, maxZoom = 15) {
  map?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: [30, 30], maxZoom })
}
export function flyTo(p: LatLng, z?: number) {
  map?.flyTo(p, z ?? Math.max(map.getZoom(), 14), { duration: 0.8 })
}
