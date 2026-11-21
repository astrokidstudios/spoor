import 'leaflet'
declare module 'leaflet' {
  interface MapOptions {
    rotate?: boolean
    bearing?: number
    touchRotate?: boolean
    shiftKeyRotate?: boolean
    rotateControl?: boolean | object
    compassBearing?: boolean
  }
  interface Map {
    setBearing(deg: number): this
    getBearing(): number
  }
}
