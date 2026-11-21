import type { BBox, Species } from './db'
import { db } from './db'

const API = 'https://api.inaturalist.org/v1'

export const GROUPS: { id: string; label: string; emoji: string }[] = [
  { id: 'Mammalia', label: 'Mammals', emoji: '🦌' },
  { id: 'Aves', label: 'Birds', emoji: '🐦' },
  { id: 'Reptilia', label: 'Reptiles', emoji: '🦎' },
  { id: 'Amphibia', label: 'Frogs', emoji: '🐸' },
  { id: 'Insecta', label: 'Insects', emoji: '🦋' },
  { id: 'Arachnida', label: 'Spiders & scorpions', emoji: '🕷️' },
  { id: 'Plantae', label: 'Plants', emoji: '🌿' },
  { id: 'Fungi', label: 'Fungi', emoji: '🍄' },
]
export const groupInfo = (id: string) => GROUPS.find((g) => g.id === id) ?? { id, label: 'Other', emoji: '🔎' }

interface INatTaxon {
  id: number
  name: string
  preferred_common_name?: string
  iconic_taxon_name?: string
  default_photo?: { square_url?: string; medium_url?: string; attribution?: string }
  wikipedia_url?: string
  wikipedia_summary?: string
  conservation_status?: { status_name?: string; status?: string }
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()

/** Species seen in an area, most-observed first (research-grade iNaturalist records). */
export async function fetchSpecies(b: BBox, signal?: AbortSignal): Promise<Omit<Species, 'id' | 'packId'>[]> {
  const [s, w, n, e] = b
  const groups = GROUPS.map((g) => g.id).join(',')
  const url = `${API}/observations/species_counts?swlat=${s}&swlng=${w}&nelat=${n}&nelng=${e}&quality_grade=research&iconic_taxa=${groups}&per_page=300&locale=en`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Wildlife server busy (${res.status})`)
  const data = (await res.json()) as { results: { count: number; taxon: INatTaxon }[] }
  return data.results.map((r, rank) => ({
    taxonId: r.taxon.id,
    name: r.taxon.name,
    common: r.taxon.preferred_common_name || r.taxon.name,
    group: r.taxon.iconic_taxon_name || 'Other',
    count: r.count,
    rank,
    photoUrl: r.taxon.default_photo?.medium_url || r.taxon.default_photo?.square_url,
    photoAttribution: r.taxon.default_photo?.attribution,
    wikiUrl: r.taxon.wikipedia_url,
    status: r.taxon.conservation_status?.status_name,
  }))
}

/** Short descriptions for up to 30 species per call. */
async function fetchSummaries(ids: number[], signal?: AbortSignal) {
  const res = await fetch(`${API}/taxa/${ids.join(',')}?locale=en`, { signal })
  if (!res.ok) return new Map<number, string>()
  const data = (await res.json()) as { results: INatTaxon[] }
  return new Map(data.results.filter((t) => t.wikipedia_summary).map((t) => [t.id, stripTags(t.wikipedia_summary!)]))
}

async function fetchPhoto(url: string, signal?: AbortSignal): Promise<Blob | undefined> {
  try {
    const r = await fetch(url, { signal, mode: 'cors' })
    if (r.ok) return await r.blob()
  } catch { /* fall through */ }
  // No CORS: warm the offline photo cache instead (the service worker keeps it).
  try { await fetch(url, { signal, mode: 'no-cors' }) } catch { /* offline */ }
  return undefined
}

/**
 * Save an area's wildlife for offline use: the species list, descriptions and photos.
 * The top species get full-size photos and descriptions; the rest get small photos.
 */
export async function saveWildlife(packId: string, b: BBox, onProgress: (msg: string) => void, signal: AbortSignal) {
  onProgress('Finding wildlife recorded here…')
  const list = await fetchSpecies(b, signal)
  const rows: Species[] = list.map((s) => ({ ...s, id: `${packId}:${s.taxonId}`, packId }))
  const TOP = 90
  for (let i = 0; i < Math.min(TOP, rows.length); i += 30) {
    if (signal.aborted) return rows.length
    onProgress(`Saving species notes… ${Math.min(i + 30, rows.length)}/${Math.min(TOP, rows.length)}`)
    const sums = await fetchSummaries(rows.slice(i, i + 30).map((r) => r.taxonId), signal).catch(() => new Map<number, string>())
    rows.slice(i, i + 30).forEach((r) => (r.summary = sums.get(r.taxonId)))
  }
  let done = 0
  let next = 0
  async function worker() {
    while (next < rows.length && !signal.aborted) {
      const r = rows[next++]
      if (r.photoUrl) {
        if (r.rank >= TOP) r.photoUrl = r.photoUrl.replace('/medium.', '/small.')
        r.photo = await fetchPhoto(r.photoUrl, signal)
      }
      done++
      if (done % 10 === 0) onProgress(`Saving wildlife photos… ${done}/${rows.length}`)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  await db.species.bulkPut(rows)
  return rows.length
}
