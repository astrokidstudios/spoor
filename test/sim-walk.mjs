// Simulated walk: start off the trail, walk onto it, follow part of it. Screenshots of the map at each stage.
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
const { chromium } = req('playwright')
import { mock } from './serve-mocks.mjs'
const OUT = process.argv[2] || 'test/out'
const URL = 'http://127.0.0.1:4174/'
const b = await chromium.launch()
const ctx = await b.newContext({ serviceWorkers: 'block', permissions: ['geolocation'], geolocation: { latitude: -29.0402, longitude: 29.3995, accuracy: 9 }, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await mock(ctx, { ntfy: [], offline: { value: false } })
const r = await ctx.newPage()
const errs = []; r.on('pageerror', (e) => errs.push(String(e)))
await r.addInitScript(() => { localStorage.setItem('spoor.test', '1'); localStorage.setItem('spoor.settings', JSON.stringify({ myName: 'Josh' })) })
await r.goto(URL)
await r.waitForSelector('.trail-card')
await r.locator('.trail-card', { hasText: 'Blindman' }).click()
await r.getByRole('button', { name: /Start this trail/ }).click()
await r.waitForSelector('.rec-time')
const geom = (await import('./fixtures.mjs')).overpass.elements.find((e) => e.id === 9002).members.flatMap((m) => m.geometry)
const start = geom[0]
// Approach from ~400 m south-west, 6 fixes
const approach = Array.from({ length: 6 }, (_, i) => ({ lat: start.lat - 0.0035 * (1 - i / 6), lon: start.lon - 0.0025 * (1 - i / 6) }))
let t0 = Date.now(), i = 0
const send = (pts) => r.evaluate(({ pts, t0, i0 }) => pts.forEach((p, k) => window.__spoorFix({ t: t0 + (i0 + k) * 45000, lat: p.lat, lng: p.lon, alt: 1500 + (i0 + k) * 5, acc: 6 })), { pts, t0, i0: i })
const shot = async (name) => {
  await r.waitForTimeout(500)
  await r.screenshot({ path: `${OUT}/${name}-panel.png` })
  await r.locator('.map-expand').click(); await r.waitForTimeout(900)
  await r.screenshot({ path: `${OUT}/${name}-map.png` })
  await r.locator('.map-expand').click(); await r.waitForTimeout(300)
}
await send(approach); i += approach.length
console.log('approach:', (await r.locator('.trail-progress').textContent().catch(() => '')).slice(0, 120))
await shot('sim1-approach')
const along = geom.slice(0, 30)
await send(along); i += along.length
console.log('on trail:', (await r.locator('.trail-progress').textContent()).slice(0, 160))
await shot('sim2-on-trail')
console.log('errors', errs)
await b.close()
