import { useEffect, useState } from 'react'
import { CloudDownload, ShieldCheck } from 'lucide-react'
import type { Trail } from '../db'
import { areaSaved, saveTrailOffline, trailPackPlan, useJobs } from '../packs'

/** "No signal on the trail?" A one-tap offer to save the trail's map, trails and wildlife for offline use. */
export default function OfflinePrompt({ trail }: { trail: Trail }) {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [packId, setPackId] = useState<string | null>(null)
  const job = useJobs().find((j) => j.packId === packId)
  useEffect(() => { void areaSaved(trail.bbox).then(setSaved) }, [trail.id, trail.bbox])
  if (saved === null) return null
  if (packId && job) return <p className="note small offline-prompt"><CloudDownload size={16} /> {job.stage} ({Math.round(job.pct)}%)</p>
  if (saved || packId) return <p className="note good small offline-prompt"><ShieldCheck size={16} /> Map, trails and wildlife for this area are saved offline.</p>
  const plan = trailPackPlan(trail)
  return (
    <div className="offline-prompt card-lite">
      <p className="small"><b>No signal out there?</b> Save the map, trails and the plants and animals of this area to your phone (about {Math.max(1, Math.round(plan.mb))} MB).</p>
      <button className="btn" onClick={async () => setPackId(await saveTrailOffline(trail))}><CloudDownload size={17} /> Save for offline</button>
    </div>
  )
}
