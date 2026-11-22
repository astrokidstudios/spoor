// Fake responses for the outside services so the app can be tested without internet.
import sharp from 'sharp'

const pts = (start, steps) => {
  const out = [{ lat: start[0], lon: start[1] }]
  for (const [dl, dn] of steps) { const p = out[out.length - 1]; out.push({ lat: p.lat + dl, lon: p.lon + dn }) }
  return out
}
const wiggle = (n, dl, dn) => Array.from({ length: n }, (_, i) => [dl + Math.sin(i / 2) * 0.0007, dn + Math.cos(i / 3) * 0.0007])

export const overpass = {
  elements: [
    { type: 'relation', id: 9001, tags: { type: 'route', route: 'hiking', name: "Sphinx & Crystal Falls Loop", sac_scale: 'mountain_hiking', operator: 'Ezemvelo KZN Wildlife', surface: 'dirt' },
      members: [{ type: 'way', role: '', geometry: pts([-29.0435, 29.4058], wiggle(30, 0.0006, -0.0009)) }, { type: 'way', role: '', geometry: pts([-29.0255, 29.3788], wiggle(30, -0.0006, 0.0009)) }] },
    { type: 'relation', id: 9002, tags: { type: 'route', route: 'hiking', name: "Blindman's Corner", sac_scale: 'demanding_mountain_hiking' },
      members: [{ type: 'way', role: '', geometry: pts([-29.0435, 29.4058], wiggle(60, 0.0002, -0.0012)) }] },
    { type: 'relation', id: 9003, tags: { type: 'route', route: 'foot', name: 'Nandi Falls Walk', sac_scale: 'hiking' },
      members: [{ type: 'way', role: '', geometry: pts([-29.0450, 29.4100], wiggle(25, -0.0005, -0.0004)) }] },
    { type: 'relation', id: 9004, tags: { type: 'route', route: 'running', name: 'Champagne Sports Trail Run 10k' },
      members: [{ type: 'way', role: '', geometry: pts([-29.0600, 29.4200], wiggle(70, 0.0003, 0.0011)) }] },
    { type: 'way', id: 7001, tags: { highway: 'path', name: 'Hlathikhulu Forest Path', sac_scale: 'hiking' }, geometry: pts([-29.030, 29.395], wiggle(20, 0.0004, 0.0005)) },
    { type: 'way', id: 7002, tags: { highway: 'path', sac_scale: 'demanding_mountain_hiking' }, geometry: pts([-29.020, 29.360], wiggle(40, -0.0006, -0.0006)) },
    { type: 'node', id: 8001, lat: -29.0437, lon: 29.3378, tags: { natural: 'peak', name: "Monk's Cowl", ele: '3234' } },
    { type: 'node', id: 8002, lat: -29.1, lon: 29.5, tags: { tourism: 'viewpoint' } },
  ],
}

const taxa = [
  [42255, 'Taurotragus oryx', 'Common Eland', 'Mammalia', 120], [43151, 'Papio ursinus', 'Chacma Baboon', 'Mammalia', 98],
  [5352, 'Gypaetus barbatus', 'Bearded Vulture', 'Aves', 64], [13685, 'Promerops gurneyi', "Gurney's Sugarbird", 'Aves', 71],
  [26039, 'Bitis arietans', 'Puff Adder', 'Reptilia', 22], [30362, 'Hemachatus haemachatus', 'Rinkhals', 'Reptilia', 15],
  [64979, 'Amietia delalandii', 'Common River Frog', 'Amphibia', 18], [48662, 'Danaus chrysippus', 'African Monarch', 'Insecta', 30],
  [119024, 'Protea roupelliae', 'Silver Sugarbush', 'Plantae', 80], [56245, 'Kniphofia caulescens', 'Red Hot Poker', 'Plantae', 44],
  [47377, 'Opistophthalmus', 'Burrowing Scorpion', 'Arachnida', 6], [12345, 'Pelea capreolus', 'Grey Rhebok', 'Mammalia', 33],
]
export const speciesCounts = { results: taxa.map(([id, name, common, group, count]) => ({ count, taxon: { id, name, preferred_common_name: common, iconic_taxon_name: group, default_photo: { medium_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/medium.jpg`, attribution: '(c) Test Photographer, some rights reserved (CC BY)' }, conservation_status: id === 5352 ? { status_name: 'Endangered' } : undefined } })) }
const mk = (list) => ({ results: list.map(([id, name, common, group, count]) => ({ count, taxon: { id, name, preferred_common_name: common, iconic_taxon_name: group, default_photo: { medium_url: `https://inaturalist-open-data.s3.amazonaws.com/photos/${id}/medium.jpg`, attribution: '(c) Test' } } })) })
// Wider-area searches: snakes, and other animals within ~25 km.
export const snakesWide = mk([[30001, 'Bitis atropos', 'Berg Adder', 'Reptilia', 9], [26039, 'Bitis arietans', 'Puff Adder', 'Reptilia', 40], [30362, 'Hemachatus haemachatus', 'Rinkhals', 'Reptilia', 25], [30005, 'Psammophylax rhombeatus', 'Spotted Grass Snake', 'Reptilia', 12]])
export const animalsWide = mk([[41001, 'Panthera pardus', 'Leopard', 'Mammalia', 3], [43151, 'Papio ursinus', 'Chacma Baboon', 'Mammalia', 150]])
export const taxaDetail = (ids) => ({ results: ids.map((id) => ({ id: Number(id), wikipedia_summary: `<b>${taxa.find((t) => t[0] == id)?.[2]}</b> is found in the uKhahlamba-Drakensberg, often seen on grassy slopes and along streams.` })) })

const palette = { Mammalia: '#a0643c', Aves: '#3c78a0', Reptilia: '#6b8e23', Amphibia: '#2e8b57', Insecta: '#d2691e', Plantae: '#c71585', Arachnida: '#555' }
export async function photo(id) {
  const t = taxa.find((x) => String(x[0]) === String(id))
  return sharp({ create: { width: 200, height: 200, channels: 3, background: palette[t?.[3]] ?? '#888' } }).jpeg().toBuffer()
}

export async function tile(z, x, y) {
  const hue = ((x * 37 + y * 17) % 20) - 10
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="rgb(${226 + hue},${222 + hue},${200})"/>
  ${Array.from({ length: 6 }, (_, i) => `<path d="M0 ${30 + i * 40 + (x % 3) * 6} C 80 ${10 + i * 40} 170 ${60 + i * 40} 256 ${30 + i * 40 + (x % 3) * 6}" stroke="#b9a77f" fill="none" stroke-width="1"/>`).join('')}
  <text x="6" y="16" font-size="10" fill="#9a8f70">${z}/${x}/${y}</text></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

export const elevation = (url) => {
  const n = new URL(url).searchParams.get('latitude').split(',').length
  return { elevation: Array.from({ length: n }, (_, i) => Math.round(1450 + 420 * Math.sin((i / n) * Math.PI) + 30 * Math.sin(i))) }
}
