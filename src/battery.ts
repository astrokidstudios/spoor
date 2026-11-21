/**
 * Low battery on a walk. When the phone drops to 15% (and isn't charging) while you're recording a walk,
 * sharing your location or on a group walk, Trailz tells people once per outing:
 *  - followers in Trailz (a "low battery" card with your last position),
 *  - whoever has your live location link (an update saying how much battery is left),
 *  - and it opens a ready-written WhatsApp message for you to send with one tap
 *    (no app is allowed to send WhatsApp messages on its own).
 */
import { useSyncExternalStore } from 'react'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { getRec } from './record'
import { followLink, getShare, sendBatteryUpdate } from './share'
import { getGroup, reportBattery } from './group'
import { myId, supabase } from './cloud'
import { getSettings, PUBLIC_URL, readJSON, writeJSON } from './settings'

export const LOW_AT = 0.15
const CHECK_MS = 90_000
const ALERTED_KEY = 'trailz.batteryAlerted'
const REARM_MS = 6 * 3600e3

export interface Battery { level: number; charging: boolean }

interface NavBattery { level: number; charging: boolean }

/** Battery level 0..1 and whether it's charging, or null if the phone won't say. */
export async function readBattery(): Promise<Battery | null> {
  try {
    if (Capacitor.isNativePlatform()) {
      const b = await Device.getBatteryInfo()
      return b.batteryLevel == null ? null : { level: b.batteryLevel, charging: !!b.isCharging }
    }
    const nav = navigator as Navigator & { getBattery?: () => Promise<NavBattery> }
    if (nav.getBattery) {
      const b = await nav.getBattery()
      return { level: b.level, charging: b.charging }
    }
  } catch { /* not available */ }
  return null
}

export interface LowBatteryPrompt { level: number; text: string }
let prompt: LowBatteryPrompt | null = null
const listeners = new Set<() => void>()
const setPrompt = (p: LowBatteryPrompt | null) => { prompt = p; listeners.forEach((l) => l()) }
export const useLowBatteryPrompt = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => prompt)
export const closeLowBatteryPrompt = () => setPrompt(null)

/** Out on a walk right now (recording, sharing your location, or on a group walk)? */
function outing() {
  const w = getRec().walk
  const recording = w && w.status !== 'done' ? w : null
  return { active: !!(recording || getShare().session || getGroup().session), walk: recording }
}

function lastPosition(): { lat: number; lng: number } | null {
  const w = getRec().walk
  const p = w?.points[w.points.length - 1]
  if (p) return { lat: p.lat, lng: p.lng }
  const ping = [...getShare().pings].reverse()[0]
  return ping ? { lat: ping.lat, lng: ping.lng } : null
}

export function lowBatteryMessage(level: number) {
  const name = getSettings().myName.trim() || 'I'
  const w = getRec().walk
  const trail = w?.trailName || getGroup().session?.trailName
  const pos = lastPosition()
  const share = getShare().session
  const lines = [
    `${name === 'I' ? "I'm" : `${name} here,`} out ${trail ? `on ${trail}` : 'walking'} and my phone is down to ${Math.round(level * 100)}% battery, so I may go quiet soon. Nothing's wrong.`,
  ]
  if (pos) lines.push(`Last position: https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}`)
  if (share) lines.push(`Live location (until my phone dies): ${followLink(share)}`)
  lines.push(`Sent from Trailz at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`)
  return lines.join('\n')
}

/** Tell everyone, once per outing. Exported so it can be tried from Settings. */
export async function sendLowBatteryAlert(level: number) {
  const pos = lastPosition()
  const w = getRec().walk
  const share = getShare().session
  writeJSON(ALERTED_KEY, Date.now())
  const jobs: Promise<unknown>[] = []
  if (share) jobs.push(sendBatteryUpdate(level))
  if (getGroup().session) reportBattery(level)
  if (myId()) {
    jobs.push(Promise.resolve(supabase.from('battery_alerts').insert({
      level: Math.round(level * 100),
      lat: pos?.lat ?? null, lng: pos?.lng ?? null,
      trail_name: w?.trailName || getGroup().session?.trailName || null,
      follow_url: share ? followLink(share) : null,
    })).catch(() => {}))
  }
  await Promise.allSettled(jobs)
  setPrompt({ level, text: lowBatteryMessage(level) })
}

async function check() {
  if (!getSettings().lowBatteryAlert) return
  const o = outing()
  if (!o.active) return
  const b = await readBattery()
  if (!b || b.charging || b.level > LOW_AT) return
  const last = readJSON<number>(ALERTED_KEY, 0)
  const startedAt = o.walk?.startedAt ?? getShare().session?.startedAt ?? getGroup().session?.startedAt ?? 0
  if (last && (last > startedAt || Date.now() - last < REARM_MS)) return
  await sendLowBatteryAlert(b.level)
}

// Automated tests trigger a check without waiting.
try {
  if (typeof window !== 'undefined' && localStorage.getItem('spoor.test') === '1') (window as unknown as { __checkBattery: typeof check }).__checkBattery = check
} catch { /* storage blocked */ }

let timer: number | undefined
export function startBatteryWatch() {
  if (timer || typeof window === 'undefined') return
  timer = window.setInterval(() => void check(), CHECK_MS)
  document.addEventListener('visibilitychange', () => void check())
  setTimeout(() => void check(), 5000)
}

/** Show the pop-up with an example message, without telling anyone. */
export function previewLowBattery() { setPrompt({ level: LOW_AT, text: lowBatteryMessage(LOW_AT) }) }

/** WhatsApp with the message ready: you pick who gets it. */
export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`
export const appUrl = PUBLIC_URL
