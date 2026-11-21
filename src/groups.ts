import { db, uid, type Trail } from './db'
import { getMap, setMap } from './mapbus'
import { saveTrails } from './trails'

/** Groups for saved trails ("Drakensberg", "Bucket list", ...). */
export async function createGroup(name: string) {
  const clean = name.trim().slice(0, 40)
  if (!clean) return null
  const existing = (await db.groups.toArray()).find((g) => g.name.toLowerCase() === clean.toLowerCase())
  if (existing) return existing
  const g = { id: uid(), name: clean, createdAt: Date.now() }
  await db.groups.put(g)
  return g
}

export async function renameGroup(id: string, name: string) {
  if (name.trim()) await db.groups.update(id, { name: name.trim().slice(0, 40) })
}

/** Delete a group. Trails in it stay saved. */
export async function deleteGroup(id: string) {
  await db.transaction('rw', db.groups, db.trails, async () => {
    await db.groups.delete(id)
    const inIt = await db.trails.filter((t) => !!t.groups?.includes(id)).toArray()
    for (const t of inIt) await db.trails.update(t.id, { groups: t.groups!.filter((g) => g !== id) })
  })
}

/** Save (or unsave) a trail, in the given groups. */
export async function saveTrailTo(t: Trail, saved: boolean, groups: string[]) {
  const next: Trail = { ...t, starred: saved, groups: saved ? groups : [] }
  if (await db.trails.get(t.id)) await db.trails.update(t.id, { starred: next.starred, groups: next.groups })
  else await saveTrails([next])
  setMap({ trails: getMap().trails.map((x) => (x.id === t.id ? { ...x, starred: next.starred, groups: next.groups } : x)) })
  return next
}
