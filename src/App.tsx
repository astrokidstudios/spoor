import { useEffect, useState } from 'react'
import MapView from './components/MapView'
import TrailsTab from './components/TrailsTab'
import PacksTab from './components/PacksTab'
import ShareTab from './components/ShareTab'
import WildlifeTab from './components/WildlifeTab'
import FollowView from './components/FollowView'
import Settings from './components/Settings'
import SosSheet from './components/SosSheet'
import RecordTab from './components/RecordTab'
import { fmtKm } from './geo'
import { resumeRecording, startWalk, useRec } from './record'
import type { Trail } from './db'
import { setMap } from './mapbus'
import { tidyPacks } from './packs'
import { resumeSharing, useShare } from './share'

type Tab = 'trails' | 'record' | 'offline' | 'share' | 'wildlife'
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'trails', label: 'Trails', icon: 'M4 20c3-6 5-2 8-8s5-3 8-8' },
  { id: 'record', label: 'Record', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z' },
  { id: 'offline', label: 'Offline', icon: 'M12 3v11m0 0-4-4m4 4 4-4M5 19h14' },
  { id: 'share', label: 'Share', icon: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Zm0-9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' },
  { id: 'wildlife', label: 'Wildlife', icon: 'M7 14c-2 0-3-1.5-3-3s1-3 2.5-3S9 9.5 9 11s-.5 3-2 3Zm10 0c-1.5 0-2-1.5-2-3s1-3 2.5-3S20 9.5 20 11s-1 3-3 3ZM9.5 7C8 7 7.5 5.5 7.5 4.5S8.3 2 9.5 2 11.5 3.5 11.5 4.5 11 7 9.5 7Zm5 0C13 7 12.5 5.5 12.5 4.5S13.3 2 14.5 2s2 1.5 2 2.5S16 7 14.5 7ZM12 22c-3 0-5-1.5-5-3.5S9.5 13 12 13s5 3.5 5 5.5-2 3.5-5 3.5Z' },
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
  return <Main />
}

function Main() {
  const [tab, setTab] = useState<Tab>('trails')
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
          <span>Spoor</span>
        </div>
        {!online && <span className="pill offline">Offline</span>}
        {rec && tab !== 'record' && <button className="pill rec-pill" onClick={() => setTab('record')}>{rec.status === 'recording' ? '●' : '❚❚'} {fmtKm(rec.distanceKm)}</button>}
        {sharing && <button className="pill live-pill" onClick={() => setTab('share')}>● Sharing</button>}
        <span className="spacer" />
        <button className="sos-btn" onClick={() => setSosOpen(true)} aria-label="Emergency numbers">SOS</button>
        <button className="icon-btn" onClick={openSettings} aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
        </button>
      </header>
      <main className="body">
        <aside className="panel">
          <nav className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setMapBig(false) }}>
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
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
          <button className="map-expand" onClick={() => setMapBig((b) => !b)}>{mapBig ? 'Show list' : 'Bigger map'}</button>
        </section>
      </main>
      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}
      {sosOpen && <SosSheet onClose={() => setSosOpen(false)} />}
    </div>
  )
}
