import * as fx from './fixtures.mjs'

/** Route every outside request to fake data. Returns a log of what was called. */
export async function mock(ctx, { ntfy = [], offline = { value: false } } = {}) {
  const log = []
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, async (route) => {
    const req = route.request()
    const url = req.url()
    log.push(req.method() + ' ' + url.slice(0, 120))
    if (offline.value) return route.abort('internetdisconnected')
    const cors = { 'access-control-allow-origin': '*' }
    let m
    if (url.includes('brouter.de')) {
      // Fake path routing: a kinked line between the two points, so a snapped leg isn't straight.
      const [[x1, y1], [x2, y2]] = new URL(url).searchParams.get('lonlats').split('|').map((p) => p.split(',').map(Number))
      const coords = [[x1, y1], [x1 + (x2 - x1) * 0.5 + 0.002, y1 + (y2 - y1) * 0.5 - 0.002], [x2, y2]]
      return route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] }, headers: cors })
    }
    if (url.includes('overpass')) return route.fulfill({ json: fx.overpass, headers: cors })
    if (url.includes('/observations/species_counts') && url.includes('taxon_id=85553')) return route.fulfill({ json: fx.snakesWide, headers: cors })
    if (url.includes('/observations/species_counts') && url.includes('iconic_taxa=Mammalia,Reptilia')) return route.fulfill({ json: fx.animalsWide, headers: cors })
    if (url.includes('/observations/species_counts')) return route.fulfill({ json: fx.speciesCounts, headers: cors })
    if (url.includes('nominatim')) return route.fulfill({ json: { address: { country_code: 'za', state: 'KwaZulu-Natal' } }, headers: cors })
    if ((m = url.match(/\/v1\/taxa\/([\d,]+)/))) return route.fulfill({ json: fx.taxaDetail(m[1].split(',')), headers: cors })
    if ((m = url.match(/photos\/(\d+)\//))) return route.fulfill({ body: await fx.photo(m[1]), contentType: 'image/jpeg', headers: cors })
    if ((m = url.match(/\/(\d+)\/(\d+)\/(\d+)\.png/))) return route.fulfill({ body: await fx.tile(+m[1], +m[2], +m[3]), contentType: 'image/png', headers: cors })
    if (url.includes('open-meteo')) return route.fulfill({ json: fx.elevation(url), headers: cors })
    if (url.includes('what3words')) {
      const key = new URL(url).searchParams.get('key')
      if (key !== 'TESTKEY') return route.fulfill({ status: 401, json: { error: { code: 'InvalidKey', message: 'Authentication failed; invalid API key' } }, headers: cors })
      return route.fulfill({ json: { words: ['filled', 'count', 'soap'].join('.') }, headers: cors })
    }
    if (url.startsWith('https://ntfy.sh')) {
      if (req.method() === 'POST') {
        const body = JSON.parse(req.postData())
        ntfy.push({ id: String(ntfy.length), time: Math.floor(Date.now() / 1000), event: 'message', topic: body.topic, title: body.title, message: body.message })
        return route.fulfill({ json: { id: 'x' }, headers: cors })
      }
      const topic = new URL(url).pathname.split('/')[1]
      return route.fulfill({ body: ntfy.filter((x) => x.topic === topic).map((x) => JSON.stringify(x)).join('\n') + '\n', contentType: 'application/x-ndjson', headers: cors })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  return log
}
