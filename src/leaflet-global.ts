// leaflet-rotate patches the global `L`, so expose Leaflet on window before it loads.
import L from 'leaflet'
;(window as unknown as { L: typeof L }).L = L
