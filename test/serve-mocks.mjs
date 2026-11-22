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
    if (url.includes('en.wikipedia.org/w/api.php')) return route.fulfill({ json: { query: { geosearch: [{ title: 'Cathkin Peak' }, { title: 'Winterton' }] } }, headers: cors })
    if (url.includes('api.openverse.org')) {
      // Photos found by place name: one good view, one hotel room that should be filtered out.
      const q = new URL(url).searchParams.get('q')
      const results = q === 'Cathkin Peak' ? [
        { id: 'ov1', title: 'Cathkin Peak from the Contour Path', url: 'https://upload.wikimedia.org/x/Cathkin.jpg', thumbnail: 'https://upload.wikimedia.org/x/Cathkin-thumb.jpg', foreign_landing_url: 'https://www.flickr.com/photos/x/1', creator: 'Sam Walker', license: 'by', license_version: '2.0', width: 1024, height: 683 },
        { id: 'ov2', title: 'Hotel bedroom with a view', url: 'https://upload.wikimedia.org/x/room.jpg', creator: 'Hotel', license: 'by', width: 1024, height: 683 },
      ] : []
      return route.fulfill({ json: { result_count: results.length, results }, headers: cors })
    }
    if (url.includes('commons.wikimedia.org/w/api.php')) {
      // Two real views near the trail, plus a species close-up, a map, a 360° panorama and an animal photo that should be filtered out.
      const img = (name, w = 2000, h = 1500, mime = 'image/jpeg') => ({ thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/aa/${name}/1600px-${name}`, url: `https://upload.wikimedia.org/wikipedia/commons/a/aa/${name}`, descriptionurl: `https://commons.wikimedia.org/wiki/File:${name}`, width: w, height: h, mime, extmetadata: { Artist: { value: '<a href="#">Greg Hiker</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' }, ObjectName: { value: name.replace(/_/g, ' ').replace('.jpg', '') } } })
      const pages = {
        1: { title: 'File:Sphinx_view.jpg', coordinates: [{ lat: -29.04, lon: 29.4 }], imageinfo: [img('Sphinx_view.jpg')] },
        2: { title: 'File:Crystal_Falls.jpg', coordinates: [{ lat: -29.03, lon: 29.39 }], imageinfo: [img('Crystal_Falls.jpg')] },
        3: { title: 'File:Bitis atropos 12345678.jpg', imageinfo: [img('Bitis_atropos_12345678.jpg')] },
        4: { title: 'File:Drakensberg map.png', imageinfo: [img('Drakensberg_map.png', 2000, 1500, 'image/png')] },
        5: { title: 'File:Sphinx 360.jpg', imageinfo: [img('Sphinx_360.jpg', 8000, 4000)] },
        6: { title: 'File:Grey Rhebok 2017.jpg', categories: [{ title: 'Category:Mammals of Drakensberg' }], imageinfo: [img('Grey_Rhebok_2017.jpg')] },
      }
      return route.fulfill({ json: { query: { pages } }, headers: cors })
    }
    if (url.includes('upload.wikimedia.org')) return route.fulfill({ body: await fx.photo('7'), contentType: 'image/jpeg', headers: cors })
    if (url.includes('brouter.de')) {
      // Fake path routing: a kinked line between the two points, so a snapped leg isn't straight.
      const [[x1, y1], [x2, y2]] = new URL(url).searchParams.get('lonlats').split('|').map((p) => p.split(',').map(Number))
      const coords = [[x1, y1], [x1 + (x2 - x1) * 0.5 + 0.002, y1 + (y2 - y1) * 0.5 - 0.002], [x2, y2]]
      return route.fulfill({ json: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }] }, headers: cors })
    }
    if (url.includes('photon.komoot.io') && /q=nandi/i.test(url)) return route.fulfill({ json: { features: [
      { geometry: { coordinates: [29.381, -29.046] }, properties: { osm_id: 9, osm_type: 'N', osm_key: 'waterway', osm_value: 'waterfall', name: 'Nandi Falls', state: 'KwaZulu-Natal', country: 'South Africa' } },
    ] }, headers: cors })
    if (url.includes('cdn.jsdelivr.net/npm/tesseract.js')) return route.fulfill({ contentType: 'application/javascript', headers: cors, body: `window.Tesseract = { recognize: async () => ({ data: { lines: [
      { text: 'Try Autumn foliage', bbox: { x0: 40, y0: 20, x1: 80, y1: 26 } },
      { text: 'Nandi Falls', bbox: { x0: 10, y0: 80, x1: 30, y1: 85 } },
      { text: 'Cathkin Peak', bbox: { x0: 70, y0: 60, x1: 90, y1: 65 } },
      { text: 'Nandi Falls Loop ›', bbox: { x0: 5, y0: 120, x1: 60, y1: 132 } },
      { text: '10.1 km 364 m 368 m 3h 4m', bbox: { x0: 5, y0: 136, x1: 90, y1: 142 } },
      { text: 'Download', bbox: { x0: 5, y0: 180, x1: 40, y1: 188 } },
    ] } }) }` })
    if (url.includes('photon.komoot.io')) return route.fulfill({ json: { features: [
      { geometry: { coordinates: [29.3976, -29.0476] }, properties: { osm_id: 1, osm_type: 'N', osm_key: 'natural', osm_value: 'peak', name: 'Cathkin Peak', state: 'KwaZulu-Natal', country: 'South Africa' } },
      { geometry: { coordinates: [29.42, -29.06] }, properties: { osm_id: 2, osm_type: 'W', osm_key: 'amenity', osm_value: 'bar', name: 'Blindman Pub' } },
    ] }, headers: cors })
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
