import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Check, FolderPlus, Plus, Star, X } from 'lucide-react'
import { db, type Trail } from '../db'
import { createGroup, saveTrailTo } from '../groups'

const IDEAS = ['Drakensberg', 'Bucket list', 'Weekend walks', 'Done it']

/** Pop-up from the star: save a trail into one or more of your groups, or make a new group. */
export default function SaveSheet({ trail, onClose, onSaved }: { trail: Trail; onClose: () => void; onSaved: (t: Trail) => void }) {
  const groups = useLiveQuery(() => db.groups.orderBy('createdAt').toArray(), [])
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>()
    for (const t of await db.trails.filter((x) => !!x.starred).toArray()) for (const g of t.groups ?? []) m.set(g, (m.get(g) ?? 0) + 1)
    return m
  }, [])
  const [picked, setPicked] = useState<string[]>(trail.groups ?? [])
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  async function add(n = name) {
    const g = await createGroup(n)
    if (!g) return
    setPicked((p) => (p.includes(g.id) ? p : [...p, g.id]))
    setName('')
    setAdding(false)
  }
  async function done() {
    if (name.trim()) await add()
    const pickedNow = name.trim() ? [...picked, ...((await db.groups.toArray()).filter((g) => g.name.toLowerCase() === name.trim().toLowerCase()).map((g) => g.id))] : picked
    onSaved(await saveTrailTo(trail, true, [...new Set(pickedNow)]))
    onClose()
  }
  async function remove() {
    onSaved(await saveTrailTo(trail, false, []))
    onClose()
  }

  return (
    <div className="modal-back sheet-back" onClick={onClose}>
      <div className="modal sheet" role="dialog" aria-label="Save to a group" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            <h3>Save to a group</h3>
            <p className="muted small one-line">{trail.name}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        <ul className="group-list">
          {groups?.map((g) => {
            const on = picked.includes(g.id)
            return (
              <li key={g.id}>
                <button className={`group-row ${on ? 'on' : ''}`} onClick={() => toggle(g.id)} aria-pressed={on}>
                  <span className="group-ico">{g.name.slice(0, 1).toUpperCase()}</span>
                  <span className="grow"><b>{g.name}</b><span className="muted tiny">{counts?.get(g.id) ?? 0} saved</span></span>
                  <span className="check">{on && <Check size={15} strokeWidth={3} />}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {adding || !groups?.length ? (
          <div className="new-group">
            <div className="row gap">
              <input className="input grow" autoFocus placeholder="New group name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} aria-label="New group name" />
              <button className="btn" onClick={() => void add()} disabled={!name.trim()}><Plus size={16} /> Add</button>
            </div>
            {!groups?.length && (
              <div className="chips">
                {IDEAS.map((i) => <button key={i} className="chip" onClick={() => void add(i)}>{i}</button>)}
              </div>
            )}
          </div>
        ) : (
          <button className="btn subtle new-group-btn" onClick={() => setAdding(true)}><FolderPlus size={17} /> New group</button>
        )}
        <div className="sheet-foot">
          {trail.starred && <button className="btn danger" onClick={() => void remove()}>Remove from saved</button>}
          <button className="btn primary grow" onClick={() => void done()}><Star size={16} fill="currentColor" /> {picked.length ? `Save to ${picked.length} group${picked.length > 1 ? 's' : ''}` : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}
