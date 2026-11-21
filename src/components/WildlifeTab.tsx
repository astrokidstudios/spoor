import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Species } from '../db'
import { getMap } from '../mapbus'
import { fetchAreaWildlife, GROUPS, groupInfo } from '../wildlife'
import { safetyFor } from '../safety'

type Row = Omit<Species, 'id' | 'packId'> & { id?: string }

export default function WildlifeTab() {
  const packs = useLiveQuery(() => db.packs.orderBy('createdAt').reverse().toArray(), [])
  const sightings = useLiveQuery(async () => new Set((await db.sightings.toArray()).map((s) => s.taxonId)), [])
  const [source, setSource] = useState<string>('')
  const [live, setLive] = useState<Row[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [group, setGroup] = useState('all')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Row | null>(null)

  const withSpecies = packs?.filter((p) => p.speciesCount > 0) ?? []
  useEffect(() => {
    if (!source && packs) setSource(withSpecies[0]?.id ?? 'live')
  }, [packs]) // eslint-disable-line react-hooks/exhaustive-deps

  const saved = useLiveQuery(() => (source && source !== 'live' ? db.species.where('packId').equals(source).sortBy('rank') : Promise.resolve([] as Species[])), [source])

  async function loadLive() {
    const b = getMap().bounds
    if (!b) return
    setLoading(true)
    setErr('')
    try {
      setLive(await fetchAreaWildlife(b))
    } catch {
      setErr(navigator.onLine === false ? "You're offline. Save an area in the Offline tab to keep its wildlife on your phone." : 'Could not reach iNaturalist. Try again in a moment.')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (source === 'live' && !live) void loadLive()
  }, [source]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows: Row[] = source === 'live' ? live ?? [] : saved ?? []
  const counts = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => m.set(r.group, (m.get(r.group) ?? 0) + 1))
    return m
  }, [rows])
  const dangerCount = rows.filter((r) => safetyFor(r.name, r.group, r.snake).danger).length
  const snakeCount = rows.filter((r) => r.snake).length
  const shown = rows.filter((r) => (group === 'all' || (group === 'seen' ? sightings?.has(r.taxonId) : group === 'danger' ? !!safetyFor(r.name, r.group, r.snake).danger : group === 'snakes' ? r.snake : r.group === group)) && (!q || `${r.common} ${r.name}`.toLowerCase().includes(q.toLowerCase())))

  return (
    <div className="tab-body">
      <div className="row gap">
        <select className="input grow" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Which area">
          {withSpecies.map((p) => <option key={p.id} value={p.id}>⬇ {p.name} ({p.speciesCount})</option>)}
          <option value="live">🌐 Area on the map (online)</option>
        </select>
        {source === 'live' && <button className="btn" onClick={loadLive} disabled={loading}>{loading ? <span className="spin" /> : '↻'}</button>}
      </div>
      <input className="input" type="search" placeholder="Search, e.g. eland, sugarbird, protea" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips">
        <button className={`chip ${group === 'all' ? 'on' : ''}`} onClick={() => setGroup('all')}>All {rows.length || ''}</button>
        {dangerCount > 0 && <button className={`chip warn ${group === 'danger' ? 'on' : ''}`} onClick={() => setGroup('danger')}>⚠ Be careful {dangerCount}</button>}
        {snakeCount > 0 && <button className={`chip ${group === 'snakes' ? 'on' : ''}`} onClick={() => setGroup('snakes')}>🐍 Snakes {snakeCount}</button>}
        {GROUPS.filter((g) => counts.get(g.id)).map((g) => (
          <button key={g.id} className={`chip ${group === g.id ? 'on' : ''}`} onClick={() => setGroup(g.id)}>{g.emoji} {g.label} {counts.get(g.id)}</button>
        ))}
        {sightings && sightings.size > 0 && <button className={`chip ${group === 'seen' ? 'on' : ''}`} onClick={() => setGroup('seen')}>✓ Seen</button>}
      </div>
      {err && <p className="note error">{err}</p>}
      {loading && <p className="note">Looking up wildlife recorded here…</p>}
      {source !== 'live' && !withSpecies.length && <p className="note">Save an area in the Offline tab and its wildlife will be kept here for when you have no signal.</p>}
      <ul className="species-grid">
        {shown.map((r) => (
          <li key={r.taxonId}>
            <button className="species" onClick={() => setOpen(r)}>
              <Photo r={r} />
              <span className="sp-name">{r.common}</span>
              <span className="sp-sci">{r.name}</span>
              {sightings?.has(r.taxonId) && <span className="seen">✓</span>}
              <DangerBadge r={r} />
            </button>
          </li>
        ))}
      </ul>
      <p className="credit">Species records from <a href="https://www.inaturalist.org" target="_blank" rel="noreferrer">iNaturalist</a> (research grade). Photos © their owners.</p>
      {open && <SpeciesModal r={open} seen={!!sightings?.has(open.taxonId)} onClose={() => setOpen(null)} />}
    </div>
  )
}

function DangerBadge({ r }: { r: Row }) {
  const s = safetyFor(r.name, r.group, r.snake)
  if (!s.danger) return null
  return <span className={`danger-badge ${s.danger}`}>{s.danger === 'danger' ? '⚠ ' : ''}{s.label}</span>
}

function Photo({ r, big }: { r: Row; big?: boolean }) {
  const [url, setUrl] = useState<string | undefined>()
  useEffect(() => {
    if (r.photo) {
      const u = URL.createObjectURL(r.photo)
      setUrl(u)
      return () => URL.revokeObjectURL(u)
    }
    setUrl(r.photoUrl)
  }, [r.photo, r.photoUrl])
  const g = groupInfo(r.group)
  return (
    <span className={`photo ${big ? 'big' : ''}`}>
      {url ? <img src={url} alt={r.common} loading="lazy" onError={() => setUrl(undefined)} /> : <span className="photo-ph">{g.emoji}</span>}
    </span>
  )
}

function SafetyBox({ r }: { r: Row }) {
  const s = safetyFor(r.name, r.group, r.snake)
  return (
    <div className={`safety ${s.danger ?? 'info'}`}>
      <b>{s.danger ? `⚠ ${s.label}` : 'If you see one'}</b>
      <p>{s.tip}</p>
      {s.firstAid && (
        <details>
          <summary>First aid if bitten or stung</summary>
          <p>{s.firstAid}</p>
          <p className="tiny">Emergency numbers are under the red SOS button at the top.</p>
        </details>
      )}
    </div>
  )
}

function SpeciesModal({ r, seen, onClose }: { r: Row; seen: boolean; onClose: () => void }) {
  const g = groupInfo(r.group)
  async function toggleSeen() {
    if (seen) await db.sightings.delete(r.taxonId)
    else await db.sightings.put({ taxonId: r.taxonId, seenAt: Date.now() })
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" role="dialog" aria-label={r.common} onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        <Photo r={r} big />
        <div className="modal-body">
          <h2>{r.common}</h2>
          <p className="muted"><i>{r.name}</i> · {g.emoji} {g.label}</p>
          <p className="small">Recorded {r.count.toLocaleString()} time{r.count === 1 ? '' : 's'} {r.nearby ? 'within about 25 km of this area' : 'in this area'}{r.status ? ` · ${r.status}` : ''}.</p>
          <SafetyBox r={r} />
          {r.summary ? <p>{r.summary}</p> : <p className="muted small">No description saved for this one.</p>}
          <div className="row gap wrap">
            <button className={`btn ${seen ? 'primary' : ''}`} onClick={toggleSeen}>{seen ? '✓ Seen it' : 'I saw this'}</button>
            <a className="btn subtle" href={`https://www.inaturalist.org/taxa/${r.taxonId}`} target="_blank" rel="noreferrer">More on iNaturalist</a>
          </div>
          {r.photoAttribution && <p className="muted tiny">Photo: {r.photoAttribution}</p>}
        </div>
      </div>
    </div>
  )
}
