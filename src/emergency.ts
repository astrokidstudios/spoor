import type { BBox, LatLng } from './db'
import { db } from './db'
import { contains } from './geo'
import { readJSON, writeJSON } from './settings'

export interface Num { number: string; label: string }

/** Emergency numbers by country. 112 works from most mobile phones worldwide, even without airtime. */
const COUNTRY: Record<string, { name: string; nums: Num[] }> = {
  ZA: {
    name: 'South Africa',
    nums: [
      { number: '112', label: 'Emergency from any mobile (works without airtime)' },
      { number: '10177', label: 'Ambulance – ask for Mountain Rescue' },
      { number: '10111', label: 'Police' },
      { number: '0861555777', label: 'Poison & snakebite advice (Poison Information Helpline, 24 h)' },
    ],
  },
  GB: { name: 'United Kingdom', nums: [{ number: '999', label: 'Emergency – ask for Police, then Mountain Rescue' }, { number: '112', label: 'Emergency from any mobile' }] },
  IE: { name: 'Ireland', nums: [{ number: '112', label: 'Emergency – ask for Mountain Rescue' }, { number: '999', label: 'Emergency' }] },
  US: { name: 'United States', nums: [{ number: '911', label: 'Emergency' }] },
  CA: { name: 'Canada', nums: [{ number: '911', label: 'Emergency' }] },
  AU: { name: 'Australia', nums: [{ number: '000', label: 'Emergency' }, { number: '112', label: 'Emergency from any mobile' }] },
  NZ: { name: 'New Zealand', nums: [{ number: '111', label: 'Emergency' }] },
}
const EU = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'CH', 'NO', 'IS']

/** Extra numbers for particular provinces / regions. */
const REGION: Record<string, Num[]> = {
  'ZA:Western Cape': [{ number: '0219370300', label: 'Wilderness Search & Rescue (Western Cape)' }],
}

export function numbersFor(country?: string, region?: string): { place: string; nums: Num[] } {
  const c = country?.toUpperCase()
  const base = c && COUNTRY[c] ? COUNTRY[c] : null
  const nums = base ? [...base.nums] : c && EU.includes(c) ? [{ number: '112', label: 'Emergency' }] : [{ number: '112', label: 'Emergency from most mobile phones worldwide' }]
  if (c && region && REGION[`${c}:${region}`]) nums.push(...REGION[`${c}:${region}`])
  return { place: [region, base?.name ?? c].filter(Boolean).join(', ') || 'Unknown area', nums }
}

/** Look up which country / province a point is in (online). */
export async function lookupPlace(p: LatLng, signal?: AbortSignal): Promise<{ country?: string; region?: string }> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&lat=${p[0]}&lon=${p[1]}&accept-language=en`, { signal })
  if (!res.ok) throw new Error('place lookup failed')
  const d = (await res.json()) as { address?: { country_code?: string; state?: string; province?: string } }
  return { country: d.address?.country_code?.toUpperCase(), region: d.address?.state || d.address?.province }
}

const LAST = 'spoor.lastPlace'

/** Best guess of where you are, working offline: a saved area you're inside, else the last place we looked up. */
export async function placeFor(p: LatLng | null): Promise<{ country?: string; region?: string }> {
  if (p) {
    const pack = (await db.packs.toArray()).find((k) => k.country && contains(k.bbox as BBox, p))
    if (pack) return { country: pack.country, region: pack.region }
    if (navigator.onLine !== false) {
      try {
        const place = await lookupPlace(p, AbortSignal.timeout(6000))
        if (place.country) {
          writeJSON(LAST, place)
          return place
        }
      } catch { /* offline */ }
    }
  }
  return readJSON(LAST, { country: 'ZA' })
}

export const rememberPlace = (place: { country?: string; region?: string }) => place.country && writeJSON(LAST, place)

// Your own numbers (lodge, park office, a friend in the area).
const MINE = 'spoor.myNumbers'
export const myNumbers = () => readJSON<Num[]>(MINE, [])
export const saveMyNumbers = (n: Num[]) => writeJSON(MINE, n)
