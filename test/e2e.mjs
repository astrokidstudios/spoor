// End-to-end check against fake outside services: trails, offline area, wildlife, sharing, follow page.
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
import { mock } from './serve-mocks.mjs'

const OUT = process.argv[2] || 'test/out'
const URL = 'http://127.0.0.1:4174/'
const b = await chromium.launch()
const ntfy = []
const offline = { value: false }
const errors = []
const ok = (cond, msg) => { console.log(cond ? '✓' : '✗', msg); if (!cond) process.exitCode = 1 }

async function context(opts) {
  const ctx = await b.newContext({ serviceWorkers: 'block', permissions: ['geolocation', 'clipboard-read', 'clipboard-write'], geolocation: { latitude: -29.0402, longitude: 29.3995, accuracy: 9 }, ...opts })
  const log = await mock(ctx, { ntfy, offline })
  return { ctx, log }
}

// ---- Phone ----
const { ctx, log } = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const p = await ctx.newPage()
p.on('pageerror', (e) => errors.push(String(e)))
await p.goto(URL)
await p.waitForSelector('.trail-card', { timeout: 15000 })
const names = await p.locator('.trail-name').allTextContents()
ok(names.length >= 5, `found ${names.length} trails: ${names.join(' | ')}`)
ok(!names.some((n) => n === 'Mountain path' && names.filter((x) => x === n).length > 1), 'no duplicate unnamed paths')
await p.waitForTimeout(800)
await p.screenshot({ path: `${OUT}/1-phone-trails.png` })

await p.locator('.chip', { hasText: 'Runs' }).click()
ok((await p.locator('.trail-name').allTextContents()).join() === 'Champagne Sports Trail Run 10k', 'running filter')
await p.locator('.chip', { hasText: 'All' }).click()

await p.locator('.trail-card', { hasText: 'Sphinx' }).click()
await p.waitForSelector('.profile', { timeout: 8000 })
ok(/\d+ m/.test(await p.locator('.stats > div').nth(1).textContent()), 'elevation climb shown')
await p.locator('.icon-btn[aria-label="Save trail"]').click()
await p.waitForTimeout(300)
await p.screenshot({ path: `${OUT}/2-phone-trail-detail.png` })

// Save offline area from the trail
await p.getByRole('button', { name: /Save for offline/ }).click()
await p.waitForSelector('.stats.compact')
const tiles = await p.locator('.stats.compact b').first().textContent()
ok(Number(tiles.replace(/\D/g, '')) > 10, `download plan: ${tiles} tiles`)
await p.getByPlaceholder(/Name, e.g./).fill("Monk's Cowl")
await p.getByRole('button', { name: '⬇ Save' }).click()
await p.waitForSelector('.pill.busy')
await p.waitForTimeout(600)
await p.screenshot({ path: `${OUT}/3-phone-downloading.png` })
await p.waitForSelector('.pill.ready', { timeout: 120000 })
const packMeta = await p.locator('.pack .tiny').first().textContent()
ok(/\d+ trails · 12 species/.test(packMeta), `pack saved: ${packMeta}`)
await p.screenshot({ path: `${OUT}/4-phone-offline.png` })

// Wildlife from the pack
await p.getByRole('tab', { name: /Wildlife/ }).click()
await p.waitForSelector('.species')
ok((await p.locator('.species').count()) === 12, 'wildlife list from saved area')
await p.locator('.chip', { hasText: 'Reptiles' }).click()
ok((await p.locator('.sp-name').allTextContents()).includes('Puff Adder'), 'reptile filter')
await p.locator('.chip', { hasText: /^All/ }).click()
await p.waitForTimeout(500)
await p.screenshot({ path: `${OUT}/5-phone-wildlife.png` })
await p.locator('.species', { hasText: 'Bearded Vulture' }).click()
await p.getByRole('button', { name: 'I saw this' }).click()
await p.waitForTimeout(300)
ok(await p.locator('.modal').getByText('Endangered').count() > 0 || (await p.locator('.modal').textContent()).includes('Endangered'), 'species detail with status')
await p.screenshot({ path: `${OUT}/6-phone-species.png` })
await p.locator('.modal-x').click()

// ---- Go offline: everything should still work ----
offline.value = true // every outside request now fails, like having no signal
await p.reload()
await ctx.setOffline(true) // (page itself is served locally; the service worker covers this on the real site)
await p.waitForSelector('.pill.offline')
await p.waitForSelector('.trail-card', { timeout: 10000 })
ok((await p.locator('.trail-card').count()) >= 4, `offline trails from saved area: ${await p.locator('.trail-card').count()}`)
await p.getByRole('tab', { name: /Offline/ }).click()
await p.getByRole('button', { name: 'Show', exact: true }).click()
await p.waitForTimeout(2500)
const blobTiles = await p.evaluate(() => [...document.querySelectorAll('.leaflet-tile')].filter((i) => i.src.startsWith('blob:') && i.complete).length)
ok(blobTiles > 3, `map tiles served from offline storage: ${blobTiles}`)
await p.screenshot({ path: `${OUT}/7-phone-offline-map.png` })
await p.getByRole('tab', { name: /Trails/ }).click()
await p.getByRole('tab', { name: /Wildlife/ }).click()
await p.waitForSelector('.species')
const photosOk = await p.evaluate(() => [...document.querySelectorAll('.species img')].filter((i) => i.src.startsWith('blob:')).length)
ok(photosOk === 12, `wildlife photos offline: ${photosOk}`)
await p.locator('.species', { hasText: 'Bearded Vulture' }).click()
ok((await p.locator('.modal').textContent()).includes('uKhahlamba'), 'species description offline')
await p.locator('.modal-x').click()
offline.value = false
await ctx.setOffline(false)

// ---- Sharing ----
await p.getByRole('tab', { name: /Share/ }).click()
await p.locator('.field input').first().fill('Josh')
await p.getByPlaceholder('Their name').fill('Mom')
await p.getByPlaceholder(/Mobile/).fill('082 555 1234')
await p.screenshot({ path: `${OUT}/8-phone-share-setup.png` })
// No key first: coordinates only
await p.getByRole('button', { name: /Start sharing/ }).click()
await p.waitForSelector('.live')
await p.waitForFunction(() => document.querySelector('.ping-list li .good'), null, { timeout: 15000 })
ok(ntfy.length === 1 && !ntfy[0].message.includes('///'), 'first update sent without what3words (no key)')
// Add key, send again
await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('spoor.settings')); s.w3wKey = 'TESTKEY'; localStorage.setItem('spoor.settings', JSON.stringify(s)) })
await p.reload()
await p.getByRole('tab', { name: /Share/ }).click()
await p.getByRole('button', { name: /Send now/ }).click()
await p.waitForFunction(() => document.querySelector('.w3w')?.textContent.includes('filled.count.soap'), null, { timeout: 15000 })
ok(ntfy.length === 2 && ntfy[1].message.startsWith('///filled.count.soap'), `update with what3words: ${JSON.stringify(ntfy[1].message)}`)
const wa = await p.locator('a', { hasText: 'WhatsApp' }).getAttribute('href')
ok(wa.startsWith('https://wa.me/27825551234'), 'WhatsApp link to contact: ' + wa.slice(0, 40))
const link = await p.locator('.tiny-input').inputValue()
ok(link.startsWith('https://astrokidstudios.github.io/spoor/#/follow/spoor-') && link.includes('n=Josh'), 'follow link: ' + link)
await p.screenshot({ path: `${OUT}/9-phone-sharing.png` })

// 5-minute timer: fast-forward the clock
const before = ntfy.length
await p.evaluate(() => {
  // Pretend the last update was 5 minutes ago.
  const k = 'spoor.share.pings'; const ps = JSON.parse(localStorage.getItem(k)); ps.forEach((x) => (x.t -= 5 * 60000)); localStorage.setItem(k, JSON.stringify(ps))
})
await p.reload()
await p.waitForTimeout(4000)
await p.getByRole('tab', { name: /Share/ }).click()
ok(ntfy.length > before, `automatic update after 5 minutes (${before} → ${ntfy.length})`)

// ---- Contact's follow page (different browser, no app) ----
const { ctx: c2 } = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: [] })
const f = await c2.newPage()
f.on('pageerror', (e) => errors.push('follow: ' + e))
await f.goto(link.replace('https://astrokidstudios.github.io/spoor/', URL))
await f.waitForSelector('.w3w.big', { timeout: 10000 })
ok((await f.locator('.w3w.big').textContent()) === '///filled.count.soap', 'contact sees what3words address')
ok((await f.locator('h1').textContent()) === 'Following Josh', 'contact sees name')
await f.waitForTimeout(1200)
await f.screenshot({ path: `${OUT}/10-contact-follow.png` })

await p.getByRole('button', { name: 'Stop sharing' }).click()
await p.waitForSelector('text=Start sharing')
ok(/stopped sharing/.test(ntfy[ntfy.length - 1].title), 'stop message sent')
await f.reload()
await f.waitForSelector('text=has stopped sharing', { timeout: 8000 })
ok(true, 'contact page shows stopped')

// ---- Desktop layout ----
const { ctx: c3 } = await context({ viewport: { width: 1400, height: 880 } })
const d = await c3.newPage()
d.on('pageerror', (e) => errors.push('desktop: ' + e))
await d.goto(URL)
await d.waitForSelector('.trail-card')
await d.locator('.trail-card', { hasText: "Blindman" }).click()
await d.waitForSelector('.profile')
await d.waitForTimeout(800)
await d.screenshot({ path: `${OUT}/11-desktop.png` })

ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors))
const unexpected = log.filter((l) => !/overpass|inaturalist|open-meteo|opentopomap|what3words|ntfy/.test(l))
ok(unexpected.length === 0, 'no unexpected outside requests ' + JSON.stringify(unexpected.slice(0, 5)))
await b.close()
