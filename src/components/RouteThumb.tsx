import type { LatLng } from '../db'

/** A tiny drawing of a route's shape, for list rows. */
export default function RouteThumb({ lines, color, size = 56 }: { lines: LatLng[][]; color: string; size?: number }) {
  let s = 90, w = 180, n = -90, e = -180
  for (const l of lines) for (const [la, lo] of l) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo) }
  const k = Math.cos(((s + n) / 2) * (Math.PI / 180))
  const spanX = (e - w) * k || 1e-6, spanY = n - s || 1e-6
  const pad = 8, inner = size - pad * 2
  const scale = inner / Math.max(spanX, spanY)
  const ox = pad + (inner - spanX * scale) / 2, oy = pad + (inner - spanY * scale) / 2
  const d = lines
    .map((l) => {
      const step = Math.max(1, Math.floor(l.length / 60))
      return l.filter((_, i) => i % step === 0 || i === l.length - 1).map(([la, lo], i) => `${i ? 'L' : 'M'}${(ox + (lo - w) * k * scale).toFixed(1)} ${(oy + (n - la) * scale).toFixed(1)}`).join('')
    })
    .join('')
  const first = lines.find((l) => l.length)?.[0]
  return (
    <svg className="route-thumb" viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--thumb-halo)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {first && <circle cx={ox + (first[1] - w) * k * scale} cy={oy + (n - first[0]) * scale} r="3.5" fill="#16a34a" stroke="#fff" strokeWidth="1.5" />}
    </svg>
  )
}
