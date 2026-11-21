import { CloudDownload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Pack } from '../db'
import { fitBBox, getMap, setMap, useMapState } from '../mapbus'
import { cancelPack, deletePack, planPack, startPack, updatePack, useJobs } from '../packs'
import { useSettings } from '../settings'

export default function PacksTab({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { bounds, zoom, preview } = useMapState()
  const settings = useSettings()
  const packs = useLiveQuery(() => db.packs.orderBy('createdAt').reverse().toArray(), [])
  const jobs = useJobs()
  const [name, setName] = useState('')
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const area = preview ?? bounds
  const plan = useMemo(() => (area ? planPack(area, zoom) : null), [area, zoom, settings.mapStyle, settings.thunderforestKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setStorage({ usage: e.usage ?? 0, quota: e.quota ?? 0 })).catch(() => {})
  }, [packs, jobs.length])
  // Show the area outline on the map while this tab is open.
  useEffect(() => {
    if (!getMap().preview && getMap().bounds) setMap({ preview: shrink(getMap().bounds!) })
    return () => setMap({ preview: null })
  }, [])
  useEffect(() => {
    if (bounds) setMap({ preview: shrink(bounds) })
  }, [bounds])

  async function start() {
    if (!plan) return
    await startPack(name.trim() || `Area saved ${new Date().toLocaleDateString()}`, plan)
    setName('')
  }

  const offline = navigator.onLine === false
  return (
    <div className="tab-body">
      <section className="card">
        <h3>Save this area for offline</h3>
        <p className="muted small">Saves the map, every trail in the orange box and the wildlife recorded there, so it all works with no signal. Move the map to change the box.</p>
        {plan && (
          <>
            <div className="stats compact">
              <div><b>{plan.tiles.toLocaleString()}</b><span>map tiles</span></div>
              <div><b>~{plan.mb < 1 ? '<1' : Math.round(plan.mb)} MB</b><span>map size</span></div>
              <div><b>z{plan.minZoom}–{plan.maxZoom}</b><span>detail</span></div>
            </div>
            {plan.tooBig ? (
              <p className="note error small">That area is too big to save in one go. Zoom in a little{!settings.thunderforestKey ? ', or add a free Thunderforest key in Settings for bigger areas' : ''}.</p>
            ) : plan.maxZoom < plan.src.offlineMaxZoom ? (
              <p className="note small">Large area: saving up to zoom {plan.maxZoom}. Zoom in to save more detail.</p>
            ) : null}
            <div className="row gap">
              <input className="input grow" placeholder="Name, e.g. Monk's Cowl" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn primary" disabled={plan.tooBig || offline} onClick={start}><CloudDownload size={17} /> Save</button>
            </div>
            {offline && <p className="note small">Connect to the internet to save an area.</p>}
            {plan.src.id !== 'outdoors' && (
              <p className="muted tiny">Maps come from a free community server, so areas are kept small. <button className="link-btn" onClick={onOpenSettings}>Settings</button></p>
            )}
          </>
        )}
      </section>

      <h3 className="section-title">Saved areas</h3>
      {!packs?.length && <p className="note">Nothing saved yet. Before a hike, save the area while you still have signal.</p>}
      <ul className="pack-list">
        {packs?.map((p) => <PackRow key={p.id} p={p} job={jobs.find((j) => j.packId === p.id)} />)}
      </ul>
      {storage && storage.quota > 0 && (
        <p className="muted tiny">Using {fmtMB(storage.usage)} of {fmtMB(storage.quota)} available on this device.</p>
      )}
    </div>
  )
}

/** Default download box: the middle of the visible map, so the outline is easy to see. */
function shrink(b: [number, number, number, number]): [number, number, number, number] {
  const dy = (b[2] - b[0]) * 0.08, dx = (b[3] - b[1]) * 0.08
  return [b[0] + dy, b[1] + dx, b[2] - dy, b[3] - dx]
}

const fmtMB = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1e6))} MB`)

function PackRow({ p, job }: { p: Pack; job?: { stage: string; pct: number } }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <li className="pack">
      <div className="row between gap">
        <button className="pack-name link-btn" onClick={() => fitBBox(p.bbox, 14)}>{p.name}</button>
        <span className={`pill ${job ? 'busy' : p.status}`}>{job ? 'Saving' : p.status === 'ready' ? 'Ready offline' : 'Incomplete'}</span>
      </div>
      {job ? (
        <>
          <div className="bar"><span style={{ width: `${Math.max(3, job.pct)}%` }} /></div>
          <p className="muted tiny">{job.stage}</p>
        </>
      ) : (
        <p className="muted tiny">
          {p.trailCount} trails · {p.speciesCount} species · {fmtMB(p.tileBytes)} map · saved {new Date(p.createdAt).toLocaleDateString()}
        </p>
      )}
      {p.error && !job && <p className="tiny error">{p.error}</p>}
      <div className="row gap">
        {job ? (
          <button className="btn small" onClick={() => cancelPack(p.id)}>Stop</button>
        ) : (
          <>
            <button className="btn small" onClick={() => fitBBox(p.bbox, 14)}>Show</button>
            <button className="btn small" onClick={() => updatePack(p.id)} disabled={navigator.onLine === false}>Update</button>
            {confirm ? (
              <button className="btn small danger" onClick={() => deletePack(p.id)}>Really delete?</button>
            ) : (
              <button className="btn small subtle" onClick={() => setConfirm(true)}>Delete</button>
            )}
          </>
        )}
      </div>
    </li>
  )
}
