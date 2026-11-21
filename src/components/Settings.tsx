import { setSettings, useSettings } from '../settings'

export default function Settings({ onClose }: { onClose: () => void }) {
  const s = useSettings()
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        <div className="modal-body">
          <h2>Settings</h2>
          <label className="field">
            <span>Your name</span>
            <input className="input" value={s.myName} onChange={(e) => setSettings({ myName: e.target.value })} placeholder="Shown to people following you" />
          </label>
          <label className="field">
            <span>what3words API key</span>
            <input className="input" value={s.w3wKey} onChange={(e) => setSettings({ w3wKey: e.target.value.trim() })} placeholder="Paste your key" autoComplete="off" spellCheck={false} />
            <small className="muted">Free from <a href="https://developer.what3words.com/public-api" target="_blank" rel="noreferrer">developer.what3words.com</a>. Stays on this device.</small>
          </label>
          <label className="field">
            <span>Send location every</span>
            <select className="input" value={s.shareEveryMin} onChange={(e) => setSettings({ shareEveryMin: Number(e.target.value) })}>
              {[2, 5, 10, 15, 30].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </label>
          <label className="field">
            <span>Map style</span>
            <select className="input" value={s.mapStyle} onChange={(e) => setSettings({ mapStyle: e.target.value as never })}>
              <option value="topo">Topo with contours (OpenTopoMap)</option>
              <option value="street">Street (OpenStreetMap)</option>
              <option value="outdoors">Outdoors (Thunderforest, needs key)</option>
            </select>
          </label>
          <label className="field">
            <span>Thunderforest API key (optional)</span>
            <input className="input" value={s.thunderforestKey} onChange={(e) => setSettings({ thunderforestKey: e.target.value.trim() })} placeholder="For bigger offline areas" autoComplete="off" spellCheck={false} />
            <small className="muted">The free community map servers ask apps not to download big areas, so Spoor keeps those small. A free hobby key from <a href="https://www.thunderforest.com/pricing/" target="_blank" rel="noreferrer">thunderforest.com</a> lets you save larger, more detailed areas.</small>
          </label>
          <details>
            <summary className="small">Advanced</summary>
            <label className="field">
              <span>Location relay server</span>
              <input className="input" value={s.ntfyServer} onChange={(e) => setSettings({ ntfyServer: e.target.value.trim() || 'https://ntfy.sh' })} />
              <small className="muted">Live sharing uses a private, random <a href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a> topic. Updates are kept for 12 hours.</small>
            </label>
          </details>
          <p className="muted tiny">Spoor {__APP_VERSION__}. Map data © OpenStreetMap contributors. Wildlife from iNaturalist. Elevation from Open-Meteo.</p>
        </div>
      </div>
    </div>
  )
}
