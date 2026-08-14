import { useEffect, useRef, type CSSProperties } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface LeafletMarkerSpec {
  position: [number, number]
  popup?: string
  iconHtml?: string
  imageUrl?: string
  iconSize?: [number, number]
  iconAnchor?: [number, number]
  draggable?: boolean
  id?: string | number
}

interface Props {
  center?: [number, number]
  zoom?: number
  markers?: LeafletMarkerSpec[]
  className?: string
  style?: CSSProperties
  onMarkerDragEnd?: (info: { id?: string | number; lat: number; lng: number }) => void
  onMarkerClick?: (info: { id?: string | number; lat: number; lng: number }) => void
}

function buildIcon(spec: LeafletMarkerSpec): L.DivIcon | undefined {
  if (spec.imageUrl) {
    const size = spec.iconSize || [32, 32]
    const anchor = spec.iconAnchor || [size[0] / 2, size[1] / 2]
    return L.divIcon({
      className: '',
      html: `<img src="${spec.imageUrl}" style="width:${size[0]}px;height:${size[1]}px;border-radius:6px;border:2px solid white;object-fit:cover;" />`,
      iconSize: size,
      iconAnchor: anchor,
    })
  }
  if (spec.iconHtml) {
    const size = spec.iconSize || [28, 28]
    const anchor = spec.iconAnchor || [size[0] / 2, size[1] / 2]
    return L.divIcon({ className: '', html: spec.iconHtml, iconSize: size, iconAnchor: anchor })
  }
  return undefined
}

export default function LeafletMap({
  center,
  zoom = 15,
  markers = [],
  className,
  style,
  onMarkerDragEnd,
  onMarkerClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<L.Marker[]>([])
  const onDragEndRef = useRef(onMarkerDragEnd)
  const onClickRef = useRef(onMarkerClick)
  onDragEndRef.current = onMarkerDragEnd
  onClickRef.current = onMarkerClick

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { zoomControl: true }).setView(
      center || [37.5, 127.5],
      zoom,
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 200)
    return () => {
      map.remove()
      mapRef.current = null
      markersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []
    markers.forEach(spec => {
      const opts: L.MarkerOptions = {}
      const icon = buildIcon(spec)
      if (icon) opts.icon = icon
      if (spec.draggable) opts.draggable = true
      const marker = L.marker(spec.position, opts).addTo(map)
      if (spec.popup) marker.bindPopup(spec.popup)
      if (spec.draggable) {
        marker.on('dragend', (e: any) => {
          const ll = e.target.getLatLng()
          onDragEndRef.current?.({ id: spec.id, lat: ll.lat, lng: ll.lng })
        })
      }
      marker.on('click', (e: any) => {
        const ll = e.target.getLatLng()
        onClickRef.current?.({ id: spec.id, lat: ll.lat, lng: ll.lng })
      })
      markersRef.current.push(marker)
    })
    setTimeout(() => map.invalidateSize(), 200)
  }, [markers])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !center) return
    map.setView(center, zoom)
    setTimeout(() => map.invalidateSize(), 200)
  }, [center, zoom])

  return <div ref={containerRef} className={className} style={style} />
}
