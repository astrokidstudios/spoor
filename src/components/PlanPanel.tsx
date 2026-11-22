import { useEffect, useState } from 'react'
import { db, type Trail } from '../db'
import { fmtKm } from '../geo'
import { getMap, setMap, useMapState } from '../mapbus'
import { clearPlan, finishRoute, planKm, planLine, planTripKm, savePlan, setMagnetic, setPlanActive, setPlanMode, undoPoint, usePlan } from '../plan'
import { fetchProfile, shapeOf } from '../trails'
import { ArrowLeftRight, Bike, Eraser, Footprints, Magnet, RotateCcw, Star, Undo2 } from 'lucide-react'

function dropOverlay() {
  const o = getMap().overlay
  if (o) { URL.revokeObjectURL(o.url); setMap({ overlay: null }) }
}

/** Plot your own route: tap the map to add points; magnetic mode follows real paths. */
export default function PlanPanel({ onSaved }: { onSaved: (t: Trail) => void }) {
  const plan = usePlan()
  const map = useMapState()
  const [name, setName] = useState(plan.suggestName ?? '')
  const [climb, setClimb] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const km = planKm(plan)
  const line = planLine(plan)
  const shape = plan.outBack ? 'out-back' : line.length > 2 ? shapeOf({ lines: [line], tags: {} }) : null

  // Climb for what's drawn so far (online only), a moment after you stop tapping.
  useEffect(() => {
    if (line.length < 2 || navigator.onLine === false || plan.busy) { setClimb(null); return }
    let live = true
    const t = setTimeout(() => {
      fetchProfile({ lines: [line], distanceKm: km } as Trail).then((p) => live && setClimb(plan.outBack ? p.ascent + p.descent : p.ascent)).catch(() => {})
    }, 900)
    return () => { live = false; clearTimeout(t) }
  }, [plan.legs, plan.busy, plan.outBack]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true)
    try {
      const t = await savePlan(name)
      if (!t) return
      if (navigator.onLine !== false) {
        const p = await fetchProfile(t).catch(() => null)
        if (p) { Object.assign(t, p); await db.trails.update(t.id, p) }
      }
      dropOverlay()
      clearPlan()
      setPlanActive(false)
      setMap({ trails: [t, ...getMap().trails.filter((x) => x.id !== t.id)], selectedId: t.id })
      onSaved(t)
    } finally {
      setSaving(false)
    }
  }

  function close() {
    dropOverlay()
    clearPlan()
    setPlanActive(false)
  }

  return (
    <div className="tab-body plan">
      <div className="row between">
        <h3>Plan a route</h3>
        <button className="link-btn" onClick={close}>Cancel</button>
      </div>
      <div className="row gap wrap">
        <button className={`toggle ${plan.magnetic ? 'on' : ''}`} role="switch" aria-checked={plan.magnetic} onClick={() => setMagnetic(!plan.magnetic)}>
          <span className="knob" /> <Magnet size={16} /> Magnetic {plan.magnetic ? 'on' : 'off'}
        </button>
        <div className="seg" role="group" aria-label="Route for">
          <button className={plan.mode === 'walk' ? 'on' : ''} onClick={() => setPlanMode('walk')}><Footprints size={15} /> Walk</button>
          <button className={plan.mode === 'bike' ? 'on' : ''} onClick={() => setPlanMode('bike')}><Bike size={15} /> Bike</button>
        </div>
      </div>
      <p className="muted small">
        {plan.points.length === 0
          ? 'Tap the map where you want to start, then tap each place you want to go through.'
          : plan.magnetic
            ? 'Magnetic is on: each part follows real paths and tracks. Turn it off to draw straight lines (across open ground).'
            : 'Magnetic is off: drawing straight lines between your taps.'}
      </p>
      <div className="stats">
        <div><b>{fmtKm(plan.outBack ? planTripKm(plan) : km)}</b><span>{plan.outBack ? 'there & back' : shape === 'loop' ? 'loop' : 'distance'}</span></div>
        <div><b>{climb != null ? `${climb} m` : '–'}</b><span>climb</span></div>
        <div><b>{plan.points.length}</b><span>points</span></div>
        <div><b>{plan.busy ? <span className="spin" /> : shape === 'loop' ? 'Loop' : shape === 'out-back' ? (plan.outBack ? 'Out & back' : 'One way') : '–'}</b><span>shape</span></div>
      </div>
      {plan.note && <p className="note small">{plan.note}</p>}
      {map.overlay && (
        <div className="row gap wrap trace-bar">
          <span className="small muted grow">{plan.points.length ? 'Now tap along the route on the picture, then Finish as a loop. Each tap snaps to the real path. Wrong start? Tap Undo and tap the start marker.' : 'Tap the start of the route on the picture (often a round marker), then tap along it. Each tap snaps to the real path.'}</span>
          <button className="btn small" onClick={() => setMap({ overlay: { ...map.overlay!, shown: !map.overlay!.shown } })}>{map.overlay.shown ? 'Hide picture' : 'Show picture'}</button>
        </div>
      )}
      {plan.targetKm != null && !plan.busy && plan.points.length > 1 && (
        <p className="note small from-photo-note">
          The picture said {plan.targetKm} km; this comes to {planTripKm(plan).toFixed(1)} km.
          {Math.abs(planTripKm(plan) - plan.targetKm) > Math.max(0.6, plan.targetKm * 0.08) ? ' Tap Undo, then tap the map where the picture\'s route goes, to bring it closer.' : ' That matches.'}
        </p>
      )}
      <div className="row gap wrap">
        <button className="btn small" onClick={undoPoint} disabled={!plan.points.length}><Undo2 size={15} /> Undo</button>
        <button className="btn small" onClick={() => void finishRoute('loop')} disabled={plan.points.length < 2}><RotateCcw size={15} /> Back to start</button>
        <button className={`btn small ${plan.outBack ? 'primary' : ''}`} onClick={() => void finishRoute('back')} disabled={plan.points.length < 2}><ArrowLeftRight size={15} /> Out & back</button>
        <button className="btn small subtle" onClick={clearPlan} disabled={!plan.points.length}><Eraser size={15} /> Clear</button>
      </div>
      <div className="row gap">
        <input className="input grow" placeholder="Name, e.g. Blue Grotto via the river" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn primary" onClick={save} disabled={line.length < 2 || saving || plan.busy > 0}>{saving ? <span className="spin" /> : <><Star size={16} /> Save route</>}</button>
      </div>
      <p className="muted tiny">Saved routes appear under Saved, work offline, and you can use Start this trail on them. Path routing by <a href="https://brouter.de" target="_blank" rel="noreferrer">BRouter</a> using OpenStreetMap data.</p>
    </div>
  )
}
