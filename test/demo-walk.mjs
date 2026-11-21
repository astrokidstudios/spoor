// Demo: a pretend walk to a trail and along it, saving a screenshot per step (for a GIF).
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = req('playwright-core') }
import { mock } from './serve-mocks.mjs'
const OUT = process.argv[2]
const b = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
const ctx = await b.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['geolocation'], geolocation: { latitude: -29.0402, longitude: 29.3995, accuracy: 9 } })
await mock(ctx, { ntfy: [], offline: { value: false } })
const p = await ctx.newPage()
await p.addInitScript(() => { localStorage.setItem('spoor.test', '1'); localStorage.setItem('spoor.settings', JSON.stringify({ myName: 'Josh' })) })
await p.goto('http://127.0.0.1:4174/')
await p.waitForSelector('.trail-card')
await p.locator('.trail-card', { hasText: 'Blindman' }).click()
await p.getByRole('button', { name: /Start this trail/ }).click()
await p.waitForSelector('.rec-time')
const geom = (await import('./fixtures.mjs')).overpass.elements.find((e) => e.id === 9002).members.flatMap((m) => m.geometry)
// Approach: 6 steps from ~400 m away to the trail start, then 30 steps along the trail.
const s0 = geom[0]
const approach = Array.from({ length: 6 }, (_, i) => ({ lat: s0.lat - 0.0036 * (1 - i / 6), lon: s0.lon - 0.0012 * (1 - i / 6) }))
const pts = [...approach, ...geom.slice(0, 30)]
let n = 0
const t0 = Date.now()
for (const [i, pt] of pts.entries()) {
  await p.evaluate(([pt, t]) => window.__spoorFix({ t, lat: pt.lat, lng: pt.lon, acc: 8, alt: 1500 + pt.i * 5 }), [{ ...pt, i }, t0 + i * 45000])
  await p.waitForTimeout(350)
  await p.screenshot({ path: `${OUT}/f${String(n++).padStart(3, '0')}.png` })
}
console.log('frames', n, 'progress:', await p.locator('.trail-progress').textContent())
await b.close()
