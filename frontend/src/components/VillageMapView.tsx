import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export interface VillagePlaceCategoryData {
  id: number
  myeon?: string
  ri?: string
  name: string
  icon: string
  color: string
  sort_order?: number
}

export interface VillagePlaceMedia {
  type: 'image' | 'video'
  url: string
}

export interface VillagePlaceData {
  id: number
  myeon?: string
  ri?: string
  category_id?: number | null
  category?: VillagePlaceCategoryData | null
  name: string
  address?: string
  latitude?: number
  longitude?: number
  description?: string
  story?: string
  open_hr?: string
  tel?: string
  website?: string
  media?: VillagePlaceMedia[]
  tags?: string
  status: string
  submitted_by?: number
  submitted_name?: string
  approved_by?: number
  approved_name?: string
  created_at?: string
  updated_at?: string
}

interface Props {
  myeon: string
  ri: string
  editable?: boolean
  onPendingCountChange?: (count: number) => void
}

function categoryColor(place: VillagePlaceData) {
  return place.category?.color || '#6c757d'
}

function categoryIcon(place: VillagePlaceData) {
  return place.category?.icon || '📍'
}

function markerHtml(place: VillagePlaceData, color: string) {
  const icon = categoryIcon(place)
  return `<div style="width:30px;height:30px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;">${icon}</div>`
}

export default function VillageMapView({ myeon, ri, editable = false, onPendingCountChange }: Props) {
  const { user } = useAuth()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapObj = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const [places, setPlaces] = useState<VillagePlaceData[]>([])
  const [categories, setCategories] = useState<VillagePlaceCategoryData[]>([])
  const [selected, setSelected] = useState<VillagePlaceData | null>(null)
  const [catFilter, setCatFilter] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [reportMsg, setReportMsg] = useState('')
  const isLeader = user && (user.role === 'leader' || user.role === 'admin')

  const loadPlaces = useCallback(async () => {
    setLoading(true)
    try {
      const d = await api.get<{ places: VillagePlaceData[] }>('/api/village/map/places', { myeon, ri, approved: 1 })
      setPlaces(d.places || [])
    } catch {
      setPlaces([])
    } finally {
      setLoading(false)
    }
  }, [myeon, ri])

  const loadCategories = useCallback(async () => {
    try {
      const d = await api.get<{ categories: VillagePlaceCategoryData[] }>('/api/village/map/categories', { myeon, ri })
      setCategories(d.categories || [])
    } catch {
      setCategories([])
    }
  }, [myeon, ri])

  useEffect(() => {
    loadCategories()
    loadPlaces()
  }, [loadCategories, loadPlaces])

  useEffect(() => {
    if (!mapRef.current || mapObj.current) return
    const startLat = 37.49
    const startLng = 127.57
    const map = L.map(mapRef.current).setView([startLat, startLng], 13)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    mapObj.current = map

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }

    return () => {
      if (mapObj.current) {
        mapObj.current.remove()
      }
      mapObj.current = null
      markersRef.current = []
    }
  }, [])

  useEffect(() => {
    const map = mapObj.current
    if (!map) return
    markersRef.current.forEach(m => map.removeLayer(m))
    markersRef.current = []

    const filtered = places.filter(p => {
      if (catFilter !== 'all' && p.category_id !== Number(catFilter)) return false
      return p.latitude && p.longitude
    })

    filtered.forEach(p => {
      const icon = L.divIcon({
        className: '',
        html: markerHtml(p, categoryColor(p)),
        iconSize: [30, 30],
        iconAnchor: [15, 15],
      })
      const marker = L.marker([p.latitude!, p.longitude!], { icon }).addTo(map)
      marker.on('click', () => {
        setSelected(p)
      })
      markersRef.current.push(marker)
    })

    if (filtered.length > 0) {
      const latSum = filtered.reduce((s, p) => s + (p.latitude || 0), 0)
      const lngSum = filtered.reduce((s, p) => s + (p.longitude || 0), 0)
      map.fitBounds(L.latLngBounds(filtered.map(p => L.latLng(p.latitude!, p.longitude!))).pad(0.3))
      void latSum
      void lngSum
    }
  }, [places, catFilter])

  useEffect(() => {
    if (!onPendingCountChange) return
    const load = async () => {
      try {
        const d = await api.get<{ pending: VillagePlaceData[] }>('/api/village/map/pending')
        onPendingCountChange((d.pending || []).length)
      } catch {
        onPendingCountChange(0)
      }
    }
    load()
  }, [onPendingCountChange])

  const handleReport = async (pid: number, reportType: string, comment: string) => {
    try {
      const d = await api.post<{ success: boolean; msg: string }>(`/api/village/map/report/${pid}`, { report_type: reportType, comment })
      setReportMsg(d.msg || '보고가 접수되었습니다.')
      setTimeout(() => setReportMsg(''), 3000)
    } catch (e: any) {
      setReportMsg(e.message || '보고 실패')
      setTimeout(() => setReportMsg(''), 3000)
    }
  }

  const [reportComment, setReportComment] = useState('')

  if (loading && places.length === 0) {
    return <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
  }

  return (
    <div>
      {categories.length > 0 && (
        <div className="d-flex gap-1 flex-wrap mb-2" style={{ fontSize: 12 }}>
          <button className="btn btn-sm"
            style={{ background: catFilter === 'all' ? '#343a40' : '#e9ecef', color: catFilter === 'all' ? '#fff' : '#333', border: 'none', borderRadius: 20 }}
            onClick={() => setCatFilter('all')}>전체</button>
          {categories.map(c => (
            <button key={c.id} className="btn btn-sm"
              style={{ background: catFilter === String(c.id) ? c.color : '#e9ecef', color: catFilter === String(c.id) ? '#fff' : '#333', border: 'none', borderRadius: 20 }}
              onClick={() => setCatFilter(String(c.id))}>{c.icon} {c.name}</button>
          ))}
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <div ref={mapRef} style={{ width: '100%', height: 400, borderRadius: 12, border: '1px solid #dee2e6', position: 'relative', zIndex: 1 }} />
      </div>

      {reportMsg && <div className="mt-2 alert alert-info py-1 px-2 mb-0" style={{ fontSize: 12 }}>{reportMsg}</div>}

      {selected && (
        <div className="card mt-2 shadow-sm" style={{ borderRadius: 12 }}>
          <div className="card-body p-3">
            <div className="d-flex justify-content-between align-items-start">
              <div>
                <h6 className="fw-bold mb-1" style={{ fontSize: 14 }}>
                  {categoryIcon(selected)} {selected.name}
                  {selected.category && (
                    <span className="badge ms-2" style={{ background: selected.category.color + '22', color: selected.category.color, fontSize: 10 }}>
                      {selected.category.icon} {selected.category.name}
                    </span>
                  )}
                </h6>
                {selected.address && <small className="text-muted d-block">📍 {selected.address}</small>}
                {selected.open_hr && <small className="text-muted d-block">🕐 {selected.open_hr}</small>}
                {selected.tel && <small className="text-muted d-block">📞 {selected.tel}</small>}
                {selected.website && <small className="text-muted d-block">🔗 <a href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a></small>}
              </div>
              <button className="btn btn-sm py-0 px-1" style={{ fontSize: 12 }} onClick={() => setSelected(null)}>✕</button>
            </div>

            {selected.media && selected.media.length > 0 && (
              <div className="d-flex gap-2 overflow-auto mt-2" style={{ maxWidth: '100%' }}>
                {selected.media.map((m, i) => (
                  <div key={i} style={{ minWidth: 120 }}>
                    {m.type === 'video' ? (
                      <video src={m.url} controls preload="metadata" style={{ width: 120, height: 90, borderRadius: 8, objectFit: 'cover' }} />
                    ) : (
                      <a href={m.url} target="_blank" rel="noreferrer">
                        <img src={m.url} alt={`${selected.name} ${i + 1}`} style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8 }} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {selected.description && <p className="mt-2 mb-1" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{selected.description}</p>}
            {selected.story && (
              <div className="mt-2" style={{ fontSize: 13, background: '#f8f9fa', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                <small className="text-muted d-block mb-1">📖 이야기/역사</small>
                {selected.story}
              </div>
            )}

            {selected.latitude && selected.longitude && (
              <a className="btn btn-sm btn-outline-primary mt-2"
                href={`/compass?popup=1&lat=${selected.latitude}&lng=${selected.longitude}&name=${encodeURIComponent(selected.name)}`}>
                🧭 나침반 내비
              </a>
            )}

            {user && (
              <div className="mt-2 pt-2 border-top">
                <div className="d-flex gap-2 flex-wrap align-items-center" style={{ fontSize: 12 }}>
                  <button className="btn btn-sm btn-outline-success" onClick={() => handleReport(selected.id, 'confirm', '')}>✅ 정보 맞음</button>
                  <button className="btn btn-sm btn-outline-warning" onClick={() => handleReport(selected.id, 'fix', '')}>✏️ 정보 수정 필요</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => handleReport(selected.id, 'flag', '')}>🚩 문제 신고</button>
                  <input className="form-control form-control-sm" style={{ maxWidth: 180 }} placeholder="메모"
                    value={reportComment} onChange={e => setReportComment(e.target.value)} />
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => handleReport(selected.id, 'memo', reportComment)}>메모 남기기</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {places.length === 0 && (
        <div className="mt-2 text-muted" style={{ fontSize: 12 }}>
          아직 등록된 장소가 없습니다.{editable ? ' 회원들이 장소를 제안하면 지도가 완성됩니다.' : ''}
        </div>
      )}
      {editable && isLeader && (
        <div className="mt-2" style={{ fontSize: 12, color: '#666' }}>
          💡 회원이 제안한 장소는 <a href="/village/map-admin">관리 페이지</a>에서 승인/반려할 수 있습니다.
        </div>
      )}
    </div>
  )
}
