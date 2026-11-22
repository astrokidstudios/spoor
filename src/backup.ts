/**
 * Backing up your walks to your Trailz account, so they survive a new phone, a deleted app, or moving
 * between the TestFlight app and the web. Each finished walk (with its full route) and its photos are
 * copied to your account, only readable by you. Signing in on another phone or app copy brings them back.
 * Walks always stay on the phone too: signing out never removes them.
 */
import { useSyncExternalStore } from 'react'
import { db, photoBlob, type Photo, type Walk } from './db'
import { myId, supabase } from './cloud'
import { readJSON, writeJSON } from './settings'

export interface BackupState { state: 'off' | 'working' | 'done' | 'error'; walks: number; at: number; error: string }
let status: BackupState = { state: 'off', walks: 0, at: 0, error: '' }
const listeners = new Set<() => void>()
function setStatus(p: Partial<BackupState>) { status = { ...status, ...p }; listeners.forEach((l) => l()) }
export const useBackup = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => status)

const BUCKET = 'walk-photos'
const DELETED_KEY = 'trailz.backupDeleted'
const doneKey = (uid: string) => `trailz.backup.${uid}`
interface Done { walks: Record<string, string>; photos: Record<string, 1> }

/** Changes whenever a walk changes in a way worth backing up again. */
const sigOf = (w: Walk) => `${w.points.length}|${w.name}|${w.endedAt ?? 0}|${w.distanceKm.toFixed(3)}`
const photoPath = (uid: string, p: Pick<Photo, 'id' | 'walkId'>) => `${uid}/${p.walkId}/${p.id}.jpg`

let running: Promise<void> | null = null
let again = false

/** Back up anything new, bring back anything missing, and apply deletions. Safe to call often. */
export function syncWalks(): Promise<void> {
  if (running) { again = true; return running }
  running = (async () => {
    try {
      do { again = false; await syncOnce() } while (again)
    } finally { running = null }
  })()
  return running
}

async function syncOnce() {
  const uid = myId()
  if (!uid) return setStatus({ state: 'off' })
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  setStatus({ state: 'working', error: '' })
  try {
    const done = readJSON<Done>(doneKey(uid), { walks: {}, photos: {} })
    const save = () => writeJSON(doneKey(uid), done)

    // 1. Walks deleted on this phone: delete their backups too.
    const deleted = readJSON<string[]>(DELETED_KEY, [])
    for (const id of deleted) {
      const { data: ph } = await supabase.from('walk_photo_backups').select('path').eq('walk_id', id)
      if (ph?.length) await supabase.storage.from(BUCKET).remove(ph.map((p) => p.path as string))
      await supabase.from('walk_photo_backups').delete().eq('walk_id', id)
      const { error } = await supabase.from('walk_backups').delete().eq('id', id)
      if (error) throw error
      delete done.walks[id]
    }
    if (deleted.length) { writeJSON(DELETED_KEY, readJSON<string[]>(DELETED_KEY, []).filter((x) => !deleted.includes(x))); save() }

    // 2. Bring back walks and photos that are in the account but not on this phone.
    const { data: remote, error: listErr } = await supabase.from('walk_backups').select('id, updated_at')
    if (listErr) throw listErr
    const localIds = new Set(await db.walks.toCollection().primaryKeys())
    const missing = (remote ?? []).map((r) => r.id as string).filter((id) => !localIds.has(id) && !deleted.includes(id))
    for (let i = 0; i < missing.length; i += 20) {
      const { data } = await supabase.from('walk_backups').select('id, data').in('id', missing.slice(i, i + 20))
      for (const r of data ?? []) {
        const w = { ...(r.data as Walk), id: r.id as string, status: 'done' as const }
        await db.walks.put(w)
        done.walks[w.id] = sigOf(w)
      }
    }
    const { data: remotePhotos } = await supabase.from('walk_photo_backups').select('id, walk_id, at, lat, lng, type, path')
    const localPhotoIds = new Set(await db.photos.toCollection().primaryKeys())
    for (const r of remotePhotos ?? []) {
      done.photos[r.id] = 1
      if (localPhotoIds.has(r.id)) continue
      const { data: blob } = await supabase.storage.from(BUCKET).download(r.path)
      if (!blob) continue
      await db.photos.put({ id: r.id, walkId: r.walk_id, at: Number(r.at), lat: r.lat ?? undefined, lng: r.lng ?? undefined, data: await blob.arrayBuffer(), type: r.type || blob.type || 'image/jpeg' })
    }
    save()

    // 3. Back up finished walks that are new or changed.
    const walks = await db.walks.where('status').equals('done').toArray()
    for (const w of walks) {
      const sig = sigOf(w)
      if (done.walks[w.id] === sig) continue
      const { error } = await supabase.from('walk_backups').upsert({ id: w.id, user_id: uid, data: w, started_at: new Date(w.startedAt).toISOString(), updated_at: new Date().toISOString() })
      if (error) throw error
      done.walks[w.id] = sig
      save()
    }

    // 4. Back up photos of finished walks.
    const doneIds = new Set(walks.map((w) => w.id))
    const photos = (await db.photos.toArray()).filter((p) => doneIds.has(p.walkId) && !done.photos[p.id])
    for (const p of photos) {
      const path = photoPath(uid, p)
      const blob = photoBlob(p)
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
      if (up.error) throw up.error
      const { error } = await supabase.from('walk_photo_backups').upsert({ id: p.id, user_id: uid, walk_id: p.walkId, at: p.at, lat: p.lat ?? null, lng: p.lng ?? null, type: blob.type || 'image/jpeg', path })
      if (error) throw error
      done.photos[p.id] = 1
      save()
    }

    setStatus({ state: 'done', walks: walks.length, at: Date.now() })
  } catch (e) {
    const msg = (e as { message?: string })?.message || String(e)
    setStatus({ state: 'error', error: /fetch|network|load failed/i.test(msg) ? 'No connection. It will carry on when you are back online.' : msg })
  }
}

/** Remember a deleted walk, so its backup goes too (now, or next time there's a connection). */
export function forgetWalkBackup(id: string) {
  writeJSON(DELETED_KEY, [...new Set([...readJSON<string[]>(DELETED_KEY, []), id])])
  void syncWalks()
}

// Run after signing in, when the app comes back to the front, and when the connection returns.
supabase.auth.onAuthStateChange((event, s) => {
  if (s && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) setTimeout(() => void syncWalks(), 1500)
  if (event === 'SIGNED_OUT') setStatus({ state: 'off', walks: 0, at: 0, error: '' })
})
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void syncWalks())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void syncWalks() })
}
