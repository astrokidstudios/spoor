import { useEffect, useState } from 'react'
import { CircleDot, CloudDownload, Map as MapIcon, MapPin, Maximize2, PawPrint, Pause, Route as RouteIcon, Settings as SettingsIcon, Siren, WifiOff } from 'lucide-react'
import MapView from './components/MapView'
import TrailsTab from './components/TrailsTab'
import PacksTab from './components/PacksTab'
import ShareTab from './components/ShareTab'
import WildlifeTab from './components/WildlifeTab'
import FollowView from './components/FollowView'
import JoinView from './components/JoinView'
import { parseInvite, resumeGroup } from './group'
import Settings from './components/Settings'
import SosSheet from './components/SosSheet'
import RecordTab from './components/RecordTab'
import { fmtKm } from './geo'
import { resumeRecording, startWalk, useRec } from './record'
import type { Trail } from './db'
import { setMap } from './mapbus'
import { setPlanActive } from './plan'
import { tidyPacks } from './packs'
import { resumeSharing, useShare } from './share'

type Tab = 'trails' | 'record' | 'offline' | 'share' | 'wildlife'
const TABS: { id: Tab; label: string; Icon: typeof RouteIcon }[] = [
  { id: 'trails', label: 'Explore', Icon: RouteIcon },
  { id: 'record', label: 'Record', Icon: CircleDot },
  { id: 'offline', label: 'Offline', Icon: CloudDownload },
  { id: 'share', label: 'Share', Icon: MapPin },
  { id: 'wildlife', label: 'Wildlife', Icon: PawPrint },
]

function parseFollow(hash: string) {
  const m = hash.match(/^#\/follow\/([\w-]+)(?:\?(.*))?$/)
  if (!m) return null
  const p = new URLSearchParams(m[2] ?? '')
  return { topic: m[1], name: p.get('n') ?? '', server: p.get('s') ?? undefined }
}

export default function App() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const follow = parseFollow(hash)
  if (follow) return <FollowView {...follow} />
  const invite = hash.startsWith('#/join/') ? parseInvite(hash) : null
  if (invite) return <JoinView invite={invite} />
  return <Main />
}

function Main() {
  const [tab, setTab] = useState<Tab>(() => {
    try { const t = sessionStorage.getItem('spoor.tab'); sessionStorage.removeItem('spoor.tab'); if (t === 'record') return 'record' } catch { /* ignore */ }
    return 'trails'
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sosOpen, setSosOpen] = useState(false)
  const [mapBig, setMapBig] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const sharing = !!useShare().session
  const rec = useRec().walk

  useEffect(() => {
    void tidyPacks()
    resumeSharing()
    void resumeRecording()
    resumeGroup()
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  const select = (id: string) => { setTab('trails'); setMap({ selectedId: id }) }
  const openSettings = () => setSettingsOpen(true)
  const startTrail = (t: Trail) => { void startWalk({ activity: t.kind === 'running' ? 'run' : 'hike', trail: t }); setTab('record') }

  return (
    <div className={`app tab-${tab} ${mapBig ? 'map-big' : ''}`}>
      <header className="top">
        <div className="brand">
          <img src="./favicon.svg" alt="" width="30" height="30" />
          <span>trailz</span>
        </div>
        {!online && <span className="pill offline"><WifiOff size={13} strokeWidth={2.5} /> Offline</span>}
        {rec && tab !== 'record' && <button className="pill rec-pill" onClick={() => setTab('record')}>{rec.status === 'recording' ? <span className="dot" /> : <Pause size={12} strokeWidth={3} />} {fmtKm(rec.distanceKm)}</button>}
        {sharing && <button className="pill live-pill" onClick={() => setTab('share')}><span className="dot" /> Live</button>}
        <span className="spacer" />
        <button className="sos-btn" onClick={() => setSosOpen(true)} aria-label="Emergency numbers"><Siren size={16} strokeWidth={2.4} /> SOS</button>
        <button className="icon-btn" onClick={openSettings} aria-label="Settings" title="Settings">
          <SettingsIcon size={21} strokeWidth={2} />
        </button>
      </header>
      <main className="body">
        <aside className="panel">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setMapBig(false); if (t.id !== 'trails') setPlanActive(false) }}>
                <span className="tab-ico"><t.Icon size={22} strokeWidth={tab === t.id ? 2.4 : 1.9} /></span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>
          <div className="panel-scroll">
            {tab === 'trails' && <TrailsTab onDownload={() => setTab('offline')} onStart={startTrail} />}
            {tab === 'record' && <RecordTab onOpenSettings={openSettings} />}
            {tab === 'offline' && <PacksTab onOpenSettings={openSettings} />}
            {tab === 'share' && <ShareTab onOpenSettings={openSettings} />}
            {tab === 'wildlife' && <WildlifeTab />}
          </div>
        </aside>
        <section className="map-area">
          <MapView onSelect={select} />
          <button className="map-expand" onClick={() => setMapBig((b) => !b)}>{mapBig ? <><MapIcon size={15} /> Show list</> : <><Maximize2 size={15} /> Bigger map</>}</button>
        </section>
      </main>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {sosOpen && <SosSheet onClose={() => setSosOpen(false)} />}
    </div>
  )
}
