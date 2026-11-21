import { useSyncExternalStore } from 'react'

export interface Settings {
  myName: string
  w3wKey: string
  thunderforestKey: string
  mapStyle: 'topo' | 'street' | 'outdoors'
  ntfyServer: string
  shareEveryMin: number
  weightKg: number
  /** Show finished walks (a summary, no route) to people who follow you. */
  shareWalks: boolean
  /** When you start a walk on a trail, followers see it under Live now and can join. */
  liveToFollowers: boolean
}

const DEFAULTS: Settings = {
  myName: '',
  w3wKey: '',
  thunderforestKey: '',
  mapStyle: 'topo',
  ntfyServer: 'https://ntfy.sh',
  shareEveryMin: 5,
  weightKg: 75,
  shareWalks: true,
  liveToFollowers: true,
}

const KEY = 'spoor.settings'
const listeners = new Set<() => void>()
let current: Settings = load()

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}

export const getSettings = () => current

export function setSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch { /* private mode */ }
  listeners.forEach((l) => l())
}

export function useSettings() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => current,
  )
}

/** Public web address of the app, used in share links (the desktop app has no public address). */
export const PUBLIC_URL = 'https://astrokidstudios.github.io/spoor/'

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
export function writeJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch { /* ignore */ }
}
