// leaflet-rotate reads Leaflet from the global L, so set it before that plugin loads.
import L from 'leaflet'
;(globalThis as unknown as { L: typeof L }).L = L
export default L
