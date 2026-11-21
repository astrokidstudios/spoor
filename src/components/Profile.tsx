/** Small elevation chart: distance along the bottom, height up the side. */
export default function Profile({ data }: { data: [number, number][] }) {
  if (data.length < 2) return null
  const W = 320, H = 110, P = { l: 34, r: 6, t: 8, b: 18 }
  const maxX = data[data.length - 1][0] || 1
  const ys = data.map((d) => d[1])
  const lo = Math.floor(Math.min(...ys) / 50) * 50
  const hi = Math.max(lo + 100, Math.ceil(Math.max(...ys) / 50) * 50)
  const x = (v: number) => P.l + (v / maxX) * (W - P.l - P.r)
  const y = (v: number) => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b)
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(d[0]).toFixed(1)},${y(d[1]).toFixed(1)}`).join('')
  const area = `${line}L${x(maxX)},${H - P.b}L${x(0)},${H - P.b}Z`
  return (
    <figure className="profile" aria-label={`Elevation from ${Math.round(Math.min(...ys))} m to ${Math.round(Math.max(...ys))} m`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        <path d={area} className="profile-fill" />
        <path d={line} className="profile-line" />
        <text x={P.l - 4} y={y(hi) + 4} textAnchor="end">{hi}</text>
        <text x={P.l - 4} y={y(lo)} textAnchor="end">{lo}</text>
        <text x={x(0)} y={H - 4}>0</text>
        <text x={x(maxX)} y={H - 4} textAnchor="end">{maxX.toFixed(1)} km</text>
      </svg>
    </figure>
  )
}
