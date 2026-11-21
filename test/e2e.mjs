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

// ---- Layout check: nothing may stick out of its box or the screen ----
// Runs after every phone screenshot, at 390 px and again at 360 px wide.
const layoutProblems = new Map()
async function findOverflow(page) {
  return page.evaluate(() => {
    const out = []
    const vw = document.documentElement.clientWidth
    const skip = (el) => el.closest('.leaflet-container, .tp-viewer, .map-area, .follow-map, [aria-hidden="true"], .sr-only')
    const boundary = (el) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX
        if (ox !== 'visible') return a
      }
      return null
    }
    for (const el of document.querySelectorAll('body *')) {
      if (skip(el)) continue
      const st = getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden' || st.position === 'fixed' && el.matches('.cheer')) continue
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const box = boundary(el)
      const br = box ? box.getBoundingClientRect() : { left: 0, right: vw }
      const right = Math.min(br.right, vw), left = Math.max(br.left, 0)
      // Only look at things in view vertically inside their scroller (lists below the fold still count).
      // Also: a normal (not absolutely positioned) element must fit inside its parent's box.
      const pe = el.parentElement
      if (pe && st.position !== 'absolute' && st.position !== 'fixed' && getComputedStyle(pe).display !== 'inline' && !skip(pe)) {
        const pr = pe.getBoundingClientRect()
        const pst = getComputedStyle(pe)
        const innerRight = pr.right - parseFloat(pst.borderRightWidth || '0')
        if (r.right - innerRight > 1.5 && pst.overflowX === 'visible') {
          const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
          out.push(`${el.tagName.toLowerCase()}${cls === '.' ? '' : cls} "${(el.textContent || '').trim().slice(0, 40)}" sticks out of its parent by ${Math.round(r.right - innerRight)}px`)
          continue
        }
      }
      const over = r.right - right, under = left - r.left
      if (over > 1 || under > 1) {
        // Report the outermost offender only (its children would repeat it).
        const par = el.parentElement && el.parentElement.getBoundingClientRect()
        if (par && (par.right - right > 1 || left - par.left > 1) && !box?.isSameNode(el.parentElement)) continue
        const cls = typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
        out.push(`${el.tagName.toLowerCase()}${cls === '.' ? '' : cls} "${(el.textContent || '').trim().slice(0, 40)}" sticks out ${Math.round(Math.max(over, under))}px`)
      }
    }
    return [...new Set(out)].slice(0, 12)
  })
}
async function checkLayout(page, name) {
  const vp = page.viewportSize()
  if (!vp || vp.width > 500) return
  const found = (await findOverflow(page)).map((x) => `${vp.width}px: ${x}`)
  await page.setViewportSize({ width: 360, height: 740 })
  await page.waitForTimeout(150)
  found.push(...(await findOverflow(page)).map((x) => `360px: ${x}`))
  await page.setViewportSize(vp)
  await page.waitForTimeout(100)
  if (found.length) layoutProblems.set(name, found)
}
const snap = async (page, path) => { await page.screenshot({ path }); await checkLayout(page, path.split('/').pop()) }

async function context(opts) {
  const ctx = await b.newContext({ serviceWorkers: 'block', permissions: ['geolocation', 'clipboard-read', 'clipboard-write', 'accelerometer', 'gyroscope', 'magnetometer'], geolocation: { latitude: -29.0402, longitude: 29.3995, accuracy: 9 }, ...opts })
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
await snap(p, `${OUT}/1-phone-trails.png`)

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

// Compass: tap to follow the phone's direction, the map turns with it; tap again for north-up.
await p.locator('.compass').click()
await p.waitForFunction(() => document.querySelector('.compass')?.classList.contains('heading'), null, { timeout: 5000 })
await p.evaluate(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 90; window.dispatchEvent(e) })
await p.waitForFunction(() => /rotate\(270deg\)/.test(document.querySelector('.compass svg')?.getAttribute('style') ?? ''), null, { timeout: 5000 })
ok((await p.locator('.compass-read').textContent()) === 'E 90°', 'compass shows the direction you face')
ok(await p.evaluate(() => [...document.querySelectorAll('.leaflet-map-pane *')].some((e) => /rotate\(4\.71/.test(e.style.transform))), 'map rotates to the way you face')
await p.locator('.compass').click()
await p.waitForFunction(() => /rotate\(0deg\)/.test(document.querySelector('.compass svg')?.getAttribute('style') ?? ''), null, { timeout: 5000 })
ok((await p.locator('.compass').getAttribute('class')).includes('north'), 'tap again: back to north-up')
// Hide the map so the list gets the whole screen, then bring it back.
await p.getByRole('button', { name: 'Hide map' }).click()
ok(!(await p.locator('.map-area').isVisible()) && (await p.locator('.trail-card').first().isVisible()), 'Hide map: list fills the screen')
await snap(p, `${OUT}/1b-phone-list-only.png`)
await p.getByRole('button', { name: 'Show map' }).click()
ok(await p.locator('.map-area').isVisible(), 'Show map brings the map back')
await p.locator('.chip', { hasText: 'Runs' }).click()
ok((await p.locator('.trail-name').allTextContents()).join() === 'Champagne Sports Trail Run 10k', 'running filter')
await p.locator('.chip', { hasText: 'All' }).click()

await p.locator('.trail-card', { hasText: 'Sphinx' }).click()
await p.waitForSelector('.profile', { timeout: 8000 })
ok(/\d+ m/.test(await p.locator('.stats > div').nth(1).textContent()), 'elevation climb shown')
await p.waitForSelector('.tp-thumb img', { timeout: 10000 })
ok((await p.locator('.tp-thumb img').count()) === 3, 'trail photos shown, plus one found by a nearby peak\'s name (360° panoramas, animals, maps and hotel rooms filtered out)')
await p.locator('.tp-thumb').first().click()
await p.waitForSelector('.tp-viewer')
ok((await p.locator('.tp-count').textContent()) === '1 / 3', 'photo viewer opens at the tapped photo')
ok(/Photo of Cathkin Peak · Sam Walker · CC BY 2.0/.test(await p.locator('.tp-cap').textContent()), 'photo credit, licence and what it shows')
await snap(p, `${OUT}/2b-phone-trail-photo.png`)
await p.locator('.tp-x').click()
ok((await p.locator('.tp-viewer').count()) === 0, 'photo viewer closes')
ok(/tbm=isch&q=.*hike|tbm=isch&q=.*[Tt]rail/.test(await p.locator('.tp-google').getAttribute('href')), 'Google Images link for the trail')
await p.locator('.icon-btn[aria-label="Save trail"]').click()
await p.waitForSelector('.fullsheet')
await p.getByLabel('New group name').fill('Drakensberg')
await p.getByRole('button', { name: 'Add', exact: true }).click()
await p.waitForSelector('.group-row.on')
await p.waitForTimeout(400)
await snap(p, `${OUT}/2b-phone-save-group.png`)
await p.getByRole('button', { name: /Save to 1 group/ }).click()
await p.waitForSelector('.in-groups .chip')
ok((await p.locator('.in-groups').textContent()).includes('Drakensberg'), 'trail saved into a new group')
await p.waitForTimeout(300)
await snap(p, `${OUT}/2-phone-trail-detail.png`)

// Save offline area from the trail
await p.getByRole('button', { name: /Save for offline/ }).click()
await p.waitForSelector('.stats.compact')
const tiles = await p.locator('.stats.compact b').first().textContent()
ok(Number(tiles.replace(/\D/g, '')) > 10, `download plan: ${tiles} tiles`)
await p.getByPlaceholder(/Name, e.g./).fill("Monk's Cowl")
await p.getByRole('button', { name: 'Save', exact: true }).click()
await p.waitForSelector('.pill.busy')
await p.waitForTimeout(600)
await snap(p, `${OUT}/3-phone-downloading.png`)
await p.waitForSelector('.pill.ready', { timeout: 120000 })
const packMeta = await p.locator('.pack .tiny').first().textContent()
ok(/\d+ trails · 15 species/.test(packMeta), `pack saved: ${packMeta}`)
ok(overpassCalls() === firstCalls + 1, 'saving the area reused the saved trail search')
await snap(p, `${OUT}/4-phone-offline.png`)

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
await snap(p, `${OUT}/5b-phone-snake.png`)
await p.locator('.modal-x').click()
await p.locator('.chip', { hasText: /^All/ }).click()
await p.locator('.chip', { hasText: 'Reptiles' }).click()
ok((await p.locator('.sp-name').allTextContents()).includes('Puff Adder'), 'reptile filter')
await p.locator('.chip', { hasText: /^All/ }).click()
await p.waitForTimeout(500)
await snap(p, `${OUT}/5-phone-wildlife.png`)
await p.locator('.species', { hasText: 'Bearded Vulture' }).click()
await p.getByRole('button', { name: 'I saw this' }).click()
await p.waitForTimeout(300)
ok(await p.locator('.modal').getByText('Endangered').count() > 0 || (await p.locator('.modal').textContent()).includes('Endangered'), 'species detail with status')
await snap(p, `${OUT}/6-phone-species.png`)
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
await snap(p, `${OUT}/7-phone-offline-map.png`)
await p.getByRole('tab', { name: /Explore/ }).click()
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
await snap(p, `${OUT}/7b-phone-sos-offline.png`)
await p.locator('.modal-x').click()
offline.value = false
await ctx.setOffline(false)

// ---- Sharing ----
await p.getByRole('tab', { name: /Share/ }).click()
await p.locator('.field input').first().fill('Josh')
await p.getByPlaceholder('Their name').fill('Mom')
await p.getByPlaceholder(/Mobile/).fill('082 555 1234')
await snap(p, `${OUT}/8-phone-share-setup.png`)
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
await snap(p, `${OUT}/9-phone-sharing.png`)

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
ok((await f.locator('.follow-battery').count()) === 0, 'no battery warning while the battery is fine')
{
  // Josh's phone runs low: the follow page warns, with where he was last.
  const lastMsg = ntfy.filter((x) => x.message && /Plus code/.test(x.message)).pop()
  ntfy.push({ ...lastMsg, id: String(ntfy.length), time: Math.floor(Date.now() / 1000), title: "Josh's phone is on 9% battery", message: lastMsg.message.replace(/\nFix /, '\nBattery 9%\nFix ') })
  await f.reload()
  await f.waitForSelector('.follow-battery', { timeout: 10000 })
  ok(/9% battery/.test(await f.locator('.follow-battery').textContent()) && /last position/.test(await f.locator('.follow-battery').textContent()), 'follow page warns about low battery: ' + (await f.locator('.follow-battery b').textContent()))
  await snap(f, `${OUT}/10b-contact-low-battery.png`)
}
ok((await f.locator('.coords.big').textContent()) === '-29.04020, 29.39950', 'contact sees GPS coordinates')
ok((await f.locator('.pluscode').textContent()) === '5G2FX95X+WR', 'contact sees the Plus Code')
ok((await f.locator('.where-near').count()) === 1, 'contact sees the nearest trail: ' + (await f.locator('.where-near').textContent().catch(() => '')))
ok((await f.locator('a', { hasText: 'Google Maps directions' }).getAttribute('href')).includes('destination=-29.040200,29.399500'), 'Google Maps directions link')
ok((await f.locator('a', { hasText: 'Apple Maps' }).getAttribute('href')).startsWith('https://maps.apple.com/?ll=-29.040200,29.399500'), 'Apple Maps link')
await f.waitForTimeout(1200)
await snap(f, `${OUT}/10-contact-follow.png`)

await p.getByRole('button', { name: 'Stop sharing' }).click()
await p.waitForSelector('text=Start sharing')
ok(/stopped sharing/.test(ntfy[ntfy.length - 1].title), 'stop message sent')
await f.reload()
await f.waitForSelector('text=has stopped sharing', { timeout: 8000 })
ok(true, 'contact page shows stopped')

// People you've shared with stay on the Share tab; favourites go to the top.
await p.getByRole('tab', { name: /Share/ }).click()
await p.waitForSelector('.people .person')
ok((await p.locator('.person-name').first().textContent()) === 'Mom', 'previously shared contact is listed')
ok(/shared just now/.test(await p.locator('.person-sub').first().textContent()), 'shows when you last shared with them')
await p.getByRole('button', { name: /Add by hand/ }).click()
await p.getByPlaceholder('Their name').fill('Dad')
await p.getByPlaceholder(/Mobile/).fill('083 555 9876')
await p.getByRole('button', { name: /Start sharing/ }).click()
await p.waitForSelector('.live')
await p.getByRole('button', { name: 'Stop sharing' }).click()
await p.waitForSelector('.people .person')
ok((await p.locator('.person-name').allTextContents()).join(',') === 'Dad,Mom', 'most recently shared comes first')
await p.getByRole('button', { name: 'Favourite Mom' }).click()
await p.waitForFunction(() => document.querySelector('.person-name')?.textContent === 'Mom', null, { timeout: 5000 })
ok((await p.locator('.fav').first().getAttribute('aria-pressed')) === 'true', 'favourite goes to the top')
ok((await p.locator('.person.on .person-name').textContent()) === 'Mom', 'top person is pre-selected')
await snap(p, `${OUT}/9b-phone-share-people.png`)

// ---- Plan your own route ----
const brouterCalls = () => log.filter((l) => l.includes('brouter.de')).length
await p.getByRole('tab', { name: /Explore/ }).click()
await p.getByRole('button', { name: /Plan/ }).click()
await p.waitForSelector('.plan')
ok((await p.locator('.toggle').getAttribute('aria-checked')) === 'true', 'magnetic is on by default')
const mapBox = await p.locator('.map-area .leaflet-container').boundingBox()
const tap = (fx, fy) => p.mouse.click(mapBox.x + mapBox.width * fx, mapBox.y + mapBox.height * fy)
await tap(0.3, 0.35)
await tap(0.7, 0.6)
await p.waitForFunction(() => document.querySelectorAll('.plan .stats b')[2]?.textContent === '2', null, { timeout: 5000 })
await p.waitForFunction(() => !document.querySelector('.plan .stats .spin'), null, { timeout: 10000 })
ok(brouterCalls() === 1, `magnetic leg asked the path router (${brouterCalls()})`)
const km1 = await p.locator('.plan .stats b').first().textContent()
ok(/\d/.test(km1), 'planned distance shown: ' + km1)
await p.locator('.toggle').click()
ok((await p.locator('.toggle').getAttribute('aria-checked')) === 'false', 'magnetic toggled off')
await tap(0.5, 0.8)
await p.waitForFunction(() => document.querySelectorAll('.plan .stats b')[2]?.textContent === '3', null, { timeout: 5000 })
ok(brouterCalls() === 1, 'straight leg with magnetic off: no routing request')
await snap(p, `${OUT}/12-phone-plan.png`)
await p.getByRole('button', { name: /Out & back/ }).click()
ok((await p.locator('.plan .stats span').first().textContent()) === 'there & back', 'out & back route')
await p.getByPlaceholder(/Blue Grotto/).fill('My river walk')
await p.getByRole('button', { name: /Save route/ }).click()
await p.waitForSelector('.trail-title', { timeout: 10000 })
ok((await p.locator('.trail-title').textContent()) === 'My river walk', 'saved route opens like a trail')
const meta = await p.locator('.trail-tags').first().textContent()
ok(/Out & back/i.test(meta) && meta.includes('Your route'), 'saved route is out & back and marked as yours: ' + meta)
ok((await p.getByRole('button', { name: /Start this trail/ }).count()) === 1, 'can start the saved route')
await snap(p, `${OUT}/13-phone-saved-route.png`)
await p.locator('.link-btn', { hasText: 'All trails' }).click()
await p.getByRole('button', { name: 'Saved', exact: true }).click()
await p.waitForSelector('.group-chips')
await p.locator('.group-chips .chip', { hasText: 'Drakensberg' }).click()
ok((await p.locator('.trail-name').allTextContents()).join() .includes('Sphinx') && !(await p.locator('.trail-name').allTextContents()).includes('My river walk'), 'group filter shows only that group')
await p.locator('.group-chips .chip', { hasText: 'All saved' }).click()
ok((await p.locator('.trail-name').allTextContents()).includes('My river walk'), 'saved route listed under ★ Saved')

// ---- Desktop layout ----
const { ctx: c3 } = await context({ viewport: { width: 1400, height: 880 } })
const d = await c3.newPage()
d.on('pageerror', (e) => errors.push('desktop: ' + e))
await d.goto(URL)
await d.waitForSelector('.trail-card')
await d.locator('.trail-card', { hasText: "Blindman" }).click()
await d.waitForSelector('.profile')
await d.waitForTimeout(800)
await snap(d, `${OUT}/11-desktop.png`)

// ---- Recording a walk along an out-and-back trail ----
const { ctx: c4 } = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const r = await c4.newPage()
r.on('pageerror', (e) => errors.push('record: ' + e))
await r.addInitScript(() => { localStorage.setItem('spoor.test', '1'); if (!localStorage.getItem('spoor.settings')) localStorage.setItem('spoor.settings', JSON.stringify({ myName: 'Josh' })) })
await r.goto(URL)
await r.waitForSelector('.trail-card')
const blind = r.locator('.trail-card', { hasText: "Blindman" })
ok(/Out & back/.test(await blind.textContent()) && /return/.test(await blind.textContent()), 'out-and-back trail is labelled on its card: ' + (await blind.locator('.trail-meta').textContent()))
ok((await r.locator('.trail-card', { hasText: 'Sphinx' }).locator('.shape').textContent()) === 'Loop', 'loop trail is labelled Loop')
await blind.click()
await r.waitForSelector('.out-back-note')
ok(/each way/.test(await r.locator('.out-back-note').textContent()), 'detail explains out and back: ' + (await r.locator('.out-back-note').textContent()))
ok(/return/.test(await r.locator('.stats').textContent()), 'detail shows the there-and-back distance')
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
// ---- Group walk: invite a friend, both see each other ----
await r.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); })
await r.getByRole('button', { name: /Walk together/ }).click()
await r.waitForSelector('.group-card')
const invite = await r.evaluate(() => navigator.clipboard.readText())
ok(/#\/join\/trailz-g-/.test(invite), 'invite link made: ' + invite.slice(0, 80) + '…')
await r.evaluate((p) => window.__spoorFix({ t: Date.now() + 60 * 60000, lat: p.lat, lng: p.lon, acc: 8, alt: 1640 }), geom[22])
const { ctx: c5 } = await context({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
const g = await c5.newPage()
g.on('pageerror', (e) => errors.push('group friend: ' + e))
await g.addInitScript(() => localStorage.setItem('spoor.test', '1'))
await g.goto(invite.replace('https://astrokidstudios.github.io/spoor/', URL))
await g.waitForSelector('.join')
ok(/Blindman/.test(await g.locator('.join').textContent()) && /Josh invited you/.test(await g.locator('.join').textContent()), 'friend sees the invite with the trail')
ok(await g.locator('.join-offline input').isChecked(), 'offer to save the map, trails and wildlife offline is ticked')
await snap(g, `${OUT}/group-join.png`)
await g.locator('.join input:not([type=checkbox])').fill('Sam')
await g.getByRole('button', { name: /Join the walk/ }).click()
await g.waitForSelector('.rec-time')
ok(/Blindman/.test(await g.locator('.trail-title').textContent()), 'friend is recording the same trail')
await g.waitForSelector('.offline-prompt')
ok(/Saving|saved offline|Finding trails/.test(await g.locator('.offline-prompt').textContent()), 'joining saves the area offline: ' + (await g.locator('.offline-prompt').textContent()))
await g.evaluate((pts) => { const t0 = Date.now(); pts.forEach((p, i) => window.__spoorFix({ t: t0 + i * 60000, lat: p.lat, lng: p.lon, alt: 1500 + i * 6, acc: 8 })) }, geom.slice(0, 8))
await g.waitForSelector('.member', { timeout: 20000 })
await g.waitForFunction(() => /Josh/.test(document.querySelector('.members')?.textContent ?? ''), null, { timeout: 20000 })
const gtext = await g.locator('.members').textContent()
ok(/Josh/.test(gtext) && /ahead/.test(gtext), 'friend sees Josh ahead: ' + gtext)
ok(await g.locator('.group-pin').count() >= 1, 'Josh shows on the friend\'s map')
ok(/2 people/.test(await g.locator('.group-card').textContent()), 'friend\'s group card counts both walkers (2 people)')
await snap(g, `${OUT}/group-friend.png`)
await r.waitForFunction(() => /Sam/.test(document.querySelector('.members')?.textContent ?? ''), null, { timeout: 20000 })
const rtext = await r.locator('.members').textContent()
ok(/Sam/.test(rtext) && /behind/.test(rtext), 'Josh sees Sam behind: ' + rtext)
ok(/2 people/.test(await r.locator('.group-card').textContent()), 'host\'s group card counts both walkers (2 people)')
// A signed-in host also gets a Friends button: make sure three buttons still fit (it used to widen the card).
await r.evaluate(() => { const row = document.querySelector('.group-card .row.gap'); const b = row?.querySelector('.btn'); if (row && b) { const c = b.cloneNode(true); c.textContent = 'Friends'; row.insertBefore(c, row.lastElementChild) } })
await snap(r, `${OUT}/group-host.png`)
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
await snap(r, `${OUT}/12-phone-recording.png`)
// Phone drops to 12% on the walk: a ready-written WhatsApp message pops up, once.
await r.evaluate(() => { navigator.getBattery = async () => ({ level: 0.12, charging: false }) })
await r.evaluate(() => window.__checkBattery())
await r.waitForSelector('.low-batt-sheet', { timeout: 5000 })
ok(/down to 12% battery/.test(await r.locator('.low-batt-msg').textContent()), 'low battery message: ' + (await r.locator('.low-batt-msg').textContent()).split('\n')[0])
ok((await r.locator('.low-batt-sheet a.share-wa').getAttribute('href')).startsWith('https://wa.me/?text='), 'one tap to send it on WhatsApp')
await snap(r, `${OUT}/12a-phone-low-battery.png`)
await r.getByRole('button', { name: 'Close' }).last().click()
await r.evaluate(() => window.__checkBattery())
await r.waitForTimeout(300)
ok((await r.locator('.low-batt-sheet').count()) === 0, 'low battery alert only goes out once per walk')
// Reload mid-walk: the walk carries on.
await r.reload()
await r.getByRole('tab', { name: /Record/ }).click()
await r.waitForSelector('.rec-time', { timeout: 5000 })
ok(/Blindman/.test(await r.locator('.trail-title').textContent()), 'recording survives reopening the app')
await r.getByRole('button', { name: /Finish/ }).click()
await r.getByRole('button', { name: /Tap again to finish/ }).click()
await r.waitForSelector('.finished')
ok(/!/.test(await r.locator('.finished .trail-title').textContent()), 'finish screen cheers: ' + (await r.locator('.finished .trail-title').textContent()))
await r.waitForTimeout(700)
await snap(r, `${OUT}/12b-phone-finished.png`)
await r.getByRole('button', { name: 'See your walk' }).click()
await r.locator('.link-btn', { hasText: 'All walks' }).click()
await r.waitForSelector('.walk-list .trail-card .badge', { timeout: 5000 }).catch(() => {})
const row = await r.locator('.walk-list .trail-card').first().textContent()
ok(/Blindman/.test(row) && /kcal/.test(row) && /kcal\s*1$/.test(row.trim()), 'finished walk in history: ' + row)
await r.locator('.walk-list .trail-card').first().click()
await r.waitForSelector('.photo-strip.big img')
await r.waitForTimeout(500)
await snap(r, `${OUT}/13-phone-walk-detail.png`)

// Search by name: trails anywhere in the country, plus places; and GPX import.
await r.getByRole('tab', { name: /Explore/ }).click()
await r.getByLabel('Search trails or places by name').fill('blindman')
await r.waitForSelector('.place-row', { timeout: 10000 })
ok((await r.locator('.trail-list .trail-name').allTextContents()).join() === "Blindman's Corner", 'name search finds the trail')
ok((await r.locator('.place-row b').allTextContents()).join() === 'Cathkin Peak', 'name search finds places (and skips pubs)')
await snap(r, `${OUT}/14-phone-name-search.png`)
await r.locator('.trail-list .trail-card').first().click()
await r.waitForSelector('.trail-title')
ok((await r.locator('.trail-title').textContent()) === "Blindman's Corner", 'search result opens the trail')
ok(/site%3Aalltrails\.com/.test(await r.locator('a', { hasText: 'Find on AllTrails' }).getAttribute('href')), 'Find on AllTrails link')
await r.locator('.link-btn', { hasText: 'All trails' }).click()
await r.getByLabel('Clear search').click()
const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="test"><trk><name>Tugela Gorge</name><trkseg>${[0, 1, 2, 3, 4, 5].map((i) => `<trkpt lat="${-28.75 + i * 0.004}" lon="${28.89 + i * 0.003}"/>`).join('')}</trkseg></trk></gpx>`
await r.locator('.gpx-import input[type=file]').setInputFiles({ name: 'tugela.gpx', mimeType: 'application/gpx+xml', buffer: Buffer.from(gpx) })
await r.waitForSelector('.trail-title', { timeout: 5000 })
ok((await r.locator('.trail-title').textContent()) === 'Tugela Gorge', 'GPX import opens the imported trail')
ok((await r.getByRole('button', { name: /Start this trail/ }).count()) === 1, 'imported trail can be started')
await r.waitForTimeout(400)
await snap(r, `${OUT}/15-phone-gpx-trail.png`)

for (const [n, list] of layoutProblems) console.log('  layout:', n, '\n    ' + list.join('\n    '))
ok(layoutProblems.size === 0, `nothing sticks out of its box at 390 px or 360 px (${layoutProblems.size} screens with problems)`)
ok(errors.length === 0, 'no page errors ' + JSON.stringify(errors))
const unexpected = log.filter((l) => !/overpass|inaturalist|open-meteo|opentopomap|what3words|ntfy|nominatim|brouter|wikimedia|wikipedia|openverse|photon\.komoot/.test(l))
ok(unexpected.length === 0, 'no unexpected outside requests ' + JSON.stringify(unexpected.slice(0, 5)))
await b.close()
