// End-to-end check against fake outside services: trails, offline area, wildlife, sharing, follow page.
import { createRequire } from 'node:module'
const req = createRequire(import.meta.url)
let pw
try { pw = req('playwright') } catch { pw = req('playwright-core') }
const { chromium } = pw
import { mock } from './serve-mocks.mjs'

const OUT = process.argv[2] || 'test/out'
const URL = 'http://127.0.0.1:4174/'
// CHROME=/path/to/chrome uses a browser you already have instead of Playwright's download.
const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {})
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

// Searching the same area again (here: opening the app again) uses the saved copy, with no trail-server request.
const overpassCalls = () => log.filter((l) => l.includes('overpass')).length
const firstCalls = overpassCalls()
ok(firstCalls === 1, `first search asked the trail server once (${firstCalls})`)
await p.reload()
await p.waitForSelector('.trail-card', { timeout: 5000 })
ok(overpassCalls() === firstCalls, `second search in the same area: no trail-server request (${overpassCalls()})`)
ok((await p.locator('.trail-name').count()) === names.length, 'saved search shows the same trails')
ok(/Trails saved just now/.test(await p.locator('.saved-at').textContent()), 'shows when the trails were saved')
await p.locator('.saved-at .link-btn', { hasText: 'Refresh' }).click()
await p.waitForFunction((n) => document.querySelectorAll('.trail-card').length === n, names.length, { timeout: 10000 })
ok(overpassCalls() === firstCalls + 1, 'Refresh asks the trail server again')

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
ok(/\d+ trails · 15 species/.test(packMeta), `pack saved: ${packMeta}`)
ok(overpassCalls() === firstCalls + 1, 'saving the area reused the saved trail search')
await p.screenshot({ path: `${OUT}/4-phone-offline.png` })

// Wildlife from the pack
await p.getByRole('tab', { name: /Wildlife/ }).click()
await p.waitForSelector('.species')
ok((await p.locator('.species').count()) === 15, 'wildlife list from saved area incl. nearby snakes/animals')
await p.locator('.chip', { hasText: 'Snakes' }).click()
const snakes = await p.locator('.sp-name').allTextContents()
ok(snakes.includes('Berg Adder') && snakes.includes('Spotted Grass Snake') && snakes.length === 4, 'snakes chip: ' + snakes.join(', '))
await p.locator('.chip', { hasText: 'Be careful' }).click()
const careful = await p.locator('.sp-name').allTextContents()
ok(careful.includes('Leopard') && careful.includes('Puff Adder') && careful.includes('Chacma Baboon'), 'be careful chip: ' + careful.join(', '))
await p.locator('.species', { hasText: 'Berg Adder' }).click()
const modalText = await p.locator('.modal').textContent()
ok(modalText.includes('Drakensberg') && modalText.includes('First aid'), 'berg adder safety tips')
await p.screenshot({ path: `${OUT}/5b-phone-snake.png` })
await p.locator('.modal-x').click()
await p.locator('.chip', { hasText: /^All/ }).click()
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
ok(photosOk === 15, `wildlife photos offline: ${photosOk}`)
await p.locator('.species', { hasText: 'Bearded Vulture' }).click()
ok((await p.locator('.modal').textContent()).includes('uKhahlamba'), 'species description offline')
await p.locator('.modal-x').click()
// SOS works offline and knows the area is in South Africa
await p.getByRole('button', { name: 'Emergency numbers' }).click()
await p.waitForSelector('.sos-list a')
const sos = await p.locator('.sos-list').textContent()
ok(sos.includes('10177') && sos.includes('Mountain Rescue') && sos.includes('112'), 'SOS shows SA numbers offline')
await p.waitForSelector('.sos-where .pluscode', { timeout: 10000 })
ok((await p.locator('.sos-where .pluscode').textContent()) === '5G2FX95X+WR', 'SOS shows the Plus Code offline')
ok((await p.locator('.sos-where a', { hasText: 'Text my location' }).getAttribute('href')).includes('Plus%20code%205G2FX95X'), 'SOS can text the location')
ok((await p.locator('.modal').textContent()).includes('KwaZulu-Natal'), 'SOS knows the province')
await p.waitForTimeout(800)
await p.screenshot({ path: `${OUT}/7b-phone-sos-offline.png` })
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
ok(ntfy[0].message.includes('-29.04020, 29.39950 (±9 m)') && ntfy[0].message.includes('Plus code 5G2FX95X+WR'), 'update has GPS and Plus Code: ' + JSON.stringify(ntfy[0].message))
ok(/^Where: (On |.+ from ).+$/m.test(ntfy[0].message), 'update names the nearest trail: ' + (ntfy[0].message.match(/^Where: .+$/m) || ['none'])[0])
ok((await p.locator('.live .pluscode').textContent()) === '5G2FX95X+WR', 'sharing card shows the Plus Code')
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
ok((await f.locator('.coords.big').textContent()) === '-29.04020, 29.39950', 'contact sees GPS coordinates')
ok((await f.locator('.pluscode').textContent()) === '5G2FX95X+WR', 'contact sees the Plus Code')
ok((await f.locator('.where-near').count()) === 1, 'contact sees the nearest trail: ' + (await f.locator('.where-near').textContent().catch(() => '')))
ok((await f.locator('a', { hasText: 'Google Maps directions' }).getAttribute('href')).includes('destination=-29.040200,29.399500'), 'Google Maps directions link')
ok((await f.locator('a', { hasText: 'Apple Maps' }).getAttribute('href')).startsWith('https://maps.apple.com/?ll=-29.040200,29.399500'), 'Apple Maps link')
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

// ---- Recording a walk along an out-and-back trail ----
const { ctx: c4 } = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const r = await c4.newPage()
r.on('pageerror', (e) => errors.push('record: ' + e))
await r.addInitScript(() => localStorage.setItem('spoor.test', '1'))
await r.goto(URL)
await r.waitForSelector('.trail-card')
const blind = r.locator('.trail-card', { hasText: "Blindman" })
ok(/Out & back/.test(await blind.textContent()) && /return/.test(await blind.textContent()), 'out-and-back trail is labelled on its card: ' + (await blind.locator('.trail-meta').textContent()))
ok(/Loop/.test(await r.locator('.trail-card', { hasText: 'Sphinx' }).textContent()), 'loop trail is labelled Loop')
await blind.click()
await r.waitForSelector('.out-back-note')
ok(/each way/.test(await r.locator('.out-back-note').textContent()), 'detail explains out and back: ' + (await r.locator('.out-back-note').textContent()))
ok(/there & back/.test(await r.locator('.stats').textContent()), 'detail shows the there-and-back distance')
await r.getByRole('button', { name: /Start this trail/ }).click()
await r.waitForSelector('.rec-time')
ok(/Recording/.test(await r.locator('.rec-on').textContent()), 'recording started from the trail')
// Walk the first ~2.4 km of the trail (points from the fixture), one fix every 60 s with rising height.
const geom = (await import('./fixtures.mjs')).overpass.elements.find((e) => e.id === 9002).members.flatMap((m) => m.geometry)
await r.evaluate((pts) => {
  const t0 = Date.now()
  pts.forEach((p, i) => window.__spoorFix({ t: t0 + i * 60000, lat: p.lat, lng: p.lon, alt: 1500 + i * 6, acc: 8 }))
}, geom.slice(0, 22))
await r.waitForTimeout(300)
const statsText = await r.locator('.stats').textContent()
ok(/km/.test(statsText) && !/^0 m/.test(statsText), 'distance recorded: ' + statsText)
const kcal = Number((await r.locator('.stats > div').nth(2).locator('b').textContent()))
ok(kcal > 50, `calories counted (${kcal} kcal)`)
ok(/On the trail/.test(await r.locator('.trail-progress').textContent()), 'on the trail')
const prog = await r.locator('.trail-progress').textContent()
ok(/done/.test(prog) && /there and back/.test(prog), 'progress along the out-and-back trail: ' + prog)
// Step off the trail.
await r.evaluate(() => window.__spoorFix({ t: Date.now() + 23 * 60000, lat: -29.04, lng: 29.37, acc: 8, alt: 1650 }))
await r.waitForTimeout(200)
ok(/off the trail/.test(await r.locator('.trail-progress').textContent()), 'warns when off the trail')
// Pause stops the clock.
await r.getByRole('button', { name: /Pause/ }).click()
const t1 = await r.locator('.rec-time').textContent()
await r.waitForTimeout(1500)
ok((await r.locator('.rec-time').textContent()) === t1 && /Paused/.test(await r.locator('.muted.small').first().textContent()), 'pause stops the clock')
await r.getByRole('button', { name: /Resume/ }).click()
// Add a photo from the library.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64')
await r.locator('input[aria-label="Add photos"]').setInputFiles({ name: 'falls.png', mimeType: 'image/png', buffer: png })
await r.waitForSelector('.photo-thumb img', { timeout: 5000 })
ok(true, 'photo added to the walk')
await r.waitForTimeout(500)
await r.screenshot({ path: `${OUT}/12-phone-recording.png` })
// Reload mid-walk: the walk carries on.
await r.reload()
await r.getByRole('tab', { name: /Record/ }).click()
await r.waitForSelector('.rec-time', { timeout: 5000 })
ok(/Blindman/.test(await r.locator('.trail-title').textContent()), 'recording survives reopening the app')
await r.getByRole('button', { name: /Finish/ }).click()
await r.getByRole('button', { name: /Tap again to finish/ }).click()
await r.waitForSelector('.walk-list .trail-card')
const row = await r.locator('.walk-list .trail-card').first().textContent()
ok(/Blindman/.test(row) && /kcal/.test(row) && /📷 1/.test(row), 'finished walk in history: ' + row)
await r.locator('.walk-list .trail-card').first().click()
await r.waitForSelector('.photo-strip.big img')
await r.waitForTimeout(500)
await r.screenshot({ path: `${OUT}/13-phone-walk-detail.png` })

ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors))
const unexpected = log.filter((l) => !/overpass|inaturalist|open-meteo|opentopomap|what3words|ntfy|nominatim/.test(l))
ok(unexpected.length === 0, 'no unexpected outside requests ' + JSON.stringify(unexpected.slice(0, 5)))
await b.close()
