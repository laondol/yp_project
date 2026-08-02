import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface Facility {
  id: number; name: string; lat: number; lng: number; address?: string
  status: string; is_community: boolean; source?: string
  verified_count: number; reject_count: number
  open_hr?: string; tel?: string; notes?: string
  my_report?: string | null
  gender_type?: string; accessible?: boolean
  facility_type?: string
}

interface Props { type?: string }
type FilterType = 'all' | 'mixed' | 'separate' | 'male' | 'female' | 'accessible'

const FACILITY_TYPES = [
  { type: 'toilet', label: '화장실', icon: '🚻', color: '#0d6efd' },
  { type: 'tourist_info', label: '관광안내소', icon: '🗺️', color: '#fd7e14' },
  { type: 'shelter', label: '함께사는피난소', icon: '🏠', color: '#e74c3c' },
]

function rejectRatio(f: Facility) {
  const total = (f.verified_count || 0) + (f.reject_count || 0)
  if (total === 0) return 0
  return (f.reject_count || 0) / total
}

function markerContent(f: Facility) {
  const ft = f.facility_type || 'toilet'
  const ratio = ft === 'toilet' ? rejectRatio(f) : 0
  const opacity = 1 - ratio * 0.5
  const blur = ratio > 0 ? Math.max(1, Math.round(ratio * 4)) : 0
  const dim = `filter:blur(${blur}px);opacity:${opacity.toFixed(2)};`
  const base = (bg: string, size = 28) =>
    `width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:13px;color:#fff;font-weight:bold;${dim}`
  if (ft === 'toilet') {
    const g = f.gender_type || 'mixed'
    if (g === 'separate') {
      const badge = f.accessible
        ? '<div style="position:absolute;right:-5px;top:-5px;width:14px;height:14px;border-radius:50%;background:#28a745;border:1.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:8px;color:#fff;">♿</div>'
        : ''
      return `<div style="position:relative;width:28px;height:28px;${dim}"><div style="width:28px;height:28px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3);overflow:hidden;display:flex;"><div style="flex:1;background:#0d6efd;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:bold;">남</div><div style="flex:1;background:#dc3545;display:flex;align-items:center;justify-content:center;font-size:11px;color:#fff;font-weight:bold;">여</div></div>${badge}</div>`
    }
    if (f.accessible) return `<div style="${base('#28a745')}">♿</div>`
    if (g === 'male_only') return `<div style="${base('#0d6efd')}">♂</div>`
    if (g === 'female_only') return `<div style="${base('#dc3545')}">♀</div>`
    return `<div style="${base('#6c757d')}">공</div>`
  }
  if (ft === 'tourist_info') return `<div style="${base('#fd7e14')}">ℹ</div>`
  if (ft === 'shelter') return `<div style="${base('#e74c3c')}">🏠</div>`
  return `<div style="${base('#6c757d')}">?</div>`
}

const GPS_CALIB_KEY = 'gps_calib_offset'

function typeLabel(t?: string) {
  if (t === 'tourist_info') return '관광안내소'
  if (t === 'shelter') return '함께사는피난소'
  return '화장실'
}

export default function FacilityMap({ type = 'toilet' }: Props) {
  const { user } = useAuth()
  const mapRef = useRef<HTMLDivElement>(null)
  const mapObj = useRef<any>(null)
  const markersRef = useRef<any[]>([])
  const myMarkerRef = useRef<any>(null)
  const [facilities, setFacilities] = useState<Facility[]>([])
  const [selected, setSelected] = useState<Facility | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addPos, setAddPos] = useState<{ lat: number; lng: number } | null>(null)
  const [addType, setAddType] = useState<string>('toilet')
  const [addForm, setAddForm] = useState<any>({ name: '', open_hr: '', notes: '', male: false, female: false, shared: false, accessible: false })
  const [reportForm, setReportForm] = useState({ comment: '' })
  const [editing, setEditing] = useState<Facility | null>(null)
  const [editPos, setEditPos] = useState<{ x: number; y: number } | null>(null)
  const [editForm, setEditForm] = useState<any>({ name: '', open_hr: '', notes: '', male: false, female: false, shared: false, accessible: false })
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterType>('all')
  const [facFilter, setFacFilter] = useState<string>('all')
  const [provider, setProvider] = useState<'leaflet' | null>(null)
  const [typePopup, setTypePopup] = useState<{ lat: number; lng: number; x: number; y: number } | null>(null)
  const [myPos, setMyPos] = useState<{ lat: number; lng: number } | null>(null)
  const myPosRef = useRef(myPos)
  myPosRef.current = myPos
  const [calibOffset, setCalibOffset] = useState<{ lat: number; lng: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(GPS_CALIB_KEY) || '{}')
      if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number') return saved
    } catch {}
    return { lat: 0, lng: 0 }
  })
  const calibRef = useRef(calibOffset)
  calibRef.current = calibOffset

  const displayPos = myPos
    ? { lat: myPos.lat + calibOffset.lat, lng: myPos.lng + calibOffset.lng }
    : null

  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      pos => setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  useEffect(() => {
    let cancelled = false

    fetch(`/api/facilities/map?type=all`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setFacilities(d.facilities || [])
        setLoading(false)
        setProvider('leaflet')
      })
      .catch(() => { if (!cancelled) { setLoading(false); setProvider('leaflet') } })

    return () => { cancelled = true }
  }, [type])

  useEffect(() => {
    if (!provider || !mapRef.current || mapObj.current) return

    const startLat = myPosRef.current?.lat ?? 37.49
    const startLng = myPosRef.current?.lng ?? 127.57
    const maxZoom = 19

    const map = L.map(mapRef.current).setView([startLat, startLng], maxZoom)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)
    map.on('click', (e: any) => {
      if (!user) return
      const { lat, lng } = e.latlng
      const point = map.latLngToContainerPoint([lat, lng])
      setSelected(null); setShowAdd(false); setEditing(null); setEditPos(null)
      setTypePopup({ lat, lng, x: point.x, y: point.y })
    })
    mapObj.current = map

    return () => {
      if (mapObj.current) {
        mapObj.current.remove()
      }
      mapObj.current = null
      markersRef.current = []
      myMarkerRef.current = null
    }
  }, [provider, user])

  useEffect(() => {
    const map = mapObj.current
    if (!map || !provider || !displayPos) return
    map.setView([displayPos.lat, displayPos.lng], 19)
  }, [displayPos, provider])

  useEffect(() => {
    const map = mapObj.current
    if (!map || !provider) return

    markersRef.current.forEach(m => {
      map.removeLayer(m)
    })
    markersRef.current = []

    const filtered = facilities.filter(f => {
      if (facFilter !== 'all' && (f.facility_type || 'toilet') !== facFilter) return false
      if (filter === 'all') return true
      if (filter === 'accessible') return f.accessible
      if (filter === 'male') return f.gender_type === 'separate' || f.gender_type === 'male_only'
      if (filter === 'female') return f.gender_type === 'separate' || f.gender_type === 'female_only'
      return f.gender_type === filter
    })

    filtered.forEach(f => {
      if (!f.lat || !f.lng) return
      const html = markerContent(f)
      const icon = L.divIcon({
        className: '',
        html,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      })
      const marker = L.marker([f.lat, f.lng], { icon }).addTo(map)
      marker.on('click', (e: any) => {
        const mapEl = mapRef.current
        if (mapEl) {
          const p = map.latLngToContainerPoint(e.latlng)
          const rect = mapEl.getBoundingClientRect()
          setEditPos({ x: rect.left + p.x, y: rect.top + p.y })
        }
        setSelected(f); setEditing(null); setTypePopup(null); setShowAdd(false)
      })
      markersRef.current.push(marker)
    })
  }, [facilities, filter, facFilter, provider])

  useEffect(() => {
    const map = mapObj.current
    if (!map || !provider || !displayPos || !myPos) return
    if (myMarkerRef.current) {
      map.removeLayer(myMarkerRef.current)
      myMarkerRef.current = null
    }
    const onDragEnd = (newLat: number, newLng: number) => {
      const off = { lat: newLat - myPos.lat, lng: newLng - myPos.lng }
      setCalibOffset(off)
      try { localStorage.setItem(GPS_CALIB_KEY, JSON.stringify(off)) } catch {}
    }
    const personHtml = `<div style="width:26px;height:26px;border-radius:50%;background:#007bff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:15px;line-height:1;overflow:hidden;">🧍</div>`
    const icon = L.divIcon({
      className: '',
      html: personHtml,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    })
    const marker = L.marker([displayPos.lat, displayPos.lng], { icon, zIndexOffset: 1000, draggable: true }).addTo(map)
    marker.on('dragend', () => {
      const ll = marker.getLatLng()
      onDragEnd(ll.lat, ll.lng)
    })
    myMarkerRef.current = marker
  }, [displayPos, myPos, provider])

  const handleTypeSelect = (facType: string) => {
    if (!typePopup) return
    setAddType(facType)
    setAddPos({ lat: typePopup.lat, lng: typePopup.lng })
    setAddForm({ name: '', open_hr: '', notes: '', male: false, female: false, shared: false, accessible: false })
    setTypePopup(null)
    setShowAdd(true)
  }

  const computeGender = (f: any) => {
    if (f.male && f.female) return 'separate'
    if (f.male) return 'male_only'
    if (f.female) return 'female_only'
    return 'mixed'
  }

  const handleAdd = async () => {
    if (!addPos) return
    const name = addForm.name.trim() || `${typeLabel(addType)} ${facilities.length + 1}`
    try {
      const res = await fetch('/api/facilities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, open_hr: addForm.open_hr, notes: addForm.notes,
          gender_type: addType === 'toilet' ? computeGender(addForm) : 'mixed',
          accessible: addType === 'toilet' ? addForm.accessible : false,
          latitude: addPos.lat, longitude: addPos.lng, facility_type: addType,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setShowAdd(false); setAddPos(null); setAddType('toilet')
        setAddForm({ name: '', open_hr: '', notes: '', male: false, female: false, shared: false, accessible: false })
        const r2 = await fetch(`/api/facilities/map?type=all`)
        setFacilities((await r2.json()).facilities || [])
      } else {
        alert(d.error || '등록에 실패했습니다.')
      }
    } catch (e) {
      alert('등록 중 오류가 발생했습니다: ' + (e as Error).message)
    }
  }

  const handleReport = async (fid: number, reportType: string) => {
    const res = await fetch(`/api/facilities/${fid}/report`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_type: reportType, comment: reportForm.comment }),
    })
    const d = await res.json()
    if (d.success && selected && selected.id === fid) {
      setSelected({ ...selected, verified_count: d.verified_count, reject_count: d.reject_count, my_report: reportType })
      setReportForm({ comment: '' })
      const r2 = await fetch(`/api/facilities/map?type=all`)
      setFacilities((await r2.json()).facilities || [])
    }
  }

  const genderLabel = (g?: string) => g === 'mixed' ? '남여공용' : g === 'separate' ? '남여분리' : g === 'male_only' ? '남자만' : g === 'female_only' ? '여자만' : '공용'

  const computeEditPos = (f: Facility) => {
    const map = mapObj.current
    const el = mapRef.current
    if (!map || !el) return null
    const p = map.latLngToContainerPoint([f.lat, f.lng])
    const rect = el.getBoundingClientRect()
    return { x: rect.left + p.x, y: rect.top + p.y }
  }

  const startEdit = (f: Facility) => {
    const g = f.gender_type || 'mixed'
    setEditForm({
      name: f.name || '',
      open_hr: f.open_hr || '',
      notes: f.notes || '',
      male: g === 'male_only' || g === 'separate',
      female: g === 'female_only' || g === 'separate',
      shared: g === 'mixed',
      accessible: !!f.accessible,
    })
    setEditPos(computeEditPos(f))
    setEditing(f)
  }

  const handleEditSave = async () => {
    if (!editing) return
    const g = editForm.male && editForm.female ? 'separate' : editForm.male ? 'male_only' : editForm.female ? 'female_only' : editForm.shared ? 'mixed' : 'mixed'
    try {
      const res = await fetch(`/api/facilities/${editing.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim() || editing.name,
          open_hr: editForm.open_hr,
          notes: editForm.notes,
          gender_type: editing.facility_type === 'toilet' ? g : 'mixed',
          accessible: editing.facility_type === 'toilet' ? editForm.accessible : false,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setEditing(null)
        setEditPos(null)
        setSelected(null)
        const r2 = await fetch(`/api/facilities/map?type=all`)
        setFacilities((await r2.json()).facilities || [])
      } else if (res.status === 401) {
        setEditing(null)
        setEditPos(null)
        if (confirm('로그인이 필요합니다. 로그인 페이지로 이동할까요?')) {
          window.location.href = '/login'
        }
      } else {
        alert(d.error || '수정에 실패했습니다.')
      }
    } catch (e) {
      alert('수정 중 오류가 발생했습니다: ' + (e as Error).message)
    }
  }

  if (loading) return <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>

  const filteredCount = facilities.filter(f => {
    if (facFilter !== 'all' && (f.facility_type || 'toilet') !== facFilter) return false
    if (filter === 'all') return true
    if (filter === 'accessible') return f.accessible
    if (filter === 'male') return f.gender_type === 'separate' || f.gender_type === 'male_only'
    if (filter === 'female') return f.gender_type === 'separate' || f.gender_type === 'female_only'
    return f.gender_type === filter
  }).length

  return (
    <div style={{ position: 'relative' }}>
      <div className="d-flex gap-1 flex-wrap mb-1" style={{ fontSize: 12 }}>
        {FACILITY_TYPES.map(ft => (
          <button key={ft.type} className="btn btn-sm"
            style={{ background: facFilter === ft.type ? ft.color : '#e9ecef', color: facFilter === ft.type ? '#fff' : '#333', border: 'none', borderRadius: 20, fontSize: 11 }}
            onClick={() => setFacFilter(ft.type)}>{ft.icon} {ft.label}</button>
        ))}
        <button className="btn btn-sm"
          style={{ background: facFilter === 'all' ? '#343a40' : '#e9ecef', color: facFilter === 'all' ? '#fff' : '#333', border: 'none', borderRadius: 20, fontSize: 11 }}
          onClick={() => setFacFilter('all')}>전체</button>
      </div>
      <div className="d-flex gap-1 flex-wrap mb-2" style={{ fontSize: 12 }}>
        {([
          ['all', '전체', '#6c757d'], ['mixed', '공용', '#6c757d'],
          ['male', '♂ 남자', '#0d6efd'], ['female', '♀ 여자', '#dc3545'],
          ['accessible', '♿ 장애인', '#28a745'],
        ] as const).map(([k, l, c]) => (
          <button key={k} className="btn btn-sm"
            style={{ background: filter === k ? c : '#e9ecef', color: filter === k ? '#fff' : '#333', border: 'none', borderRadius: 20, fontSize: 11 }}
            onClick={() => setFilter(k as FilterType)}>{l}          </button>
        ))}
      </div>

      <div style={{ position: 'relative' }}>
        <div ref={mapRef} id="map" style={{ width: '100%', height: 400, borderRadius: 12, border: '1px solid #dee2e6', position: 'relative', zIndex: 1 }} />

        {typePopup && (
          <div style={{
            position: 'absolute',
            left: typePopup.x + 14,
            top: typePopup.y - 50,
            display: 'flex', flexDirection: 'column', gap: 4,
            background: '#fff', borderRadius: 10, padding: '6px',
            boxShadow: '0 2px 12px rgba(0,0,0,.25)',
            zIndex: 1000,
            transform: 'translateX(-50%)',
          }}>
            <div style={{ fontSize: 10, color: '#666', padding: '2px 4px' }}>무엇을 등록할까요?</div>
            {FACILITY_TYPES.map(ft => (
              <button key={ft.type} onClick={() => handleTypeSelect(ft.type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  border: 'none', background: '#f8f9fa', borderRadius: 8,
                  padding: '5px 8px', cursor: 'pointer', fontSize: 12, textAlign: 'left',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = ft.color + '22')}
                onMouseLeave={e => (e.currentTarget.style.background = '#f8f9fa')}
              ><span style={{ fontSize: 16 }}>{ft.icon}</span> {ft.label}</button>
            ))}
            <button onClick={() => setTypePopup(null)}
              style={{
                width: 20, height: 20, borderRadius: '50%',
                background: '#e9ecef', border: 'none',
                color: '#666', fontSize: 11, lineHeight: 1,
                cursor: 'pointer', position: 'absolute', top: -6, right: -6,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}              >✕</button>
          </div>
        )}
      </div>

      <div className="mt-2 d-flex gap-3" style={{ fontSize: 11, color: '#666' }}>
        <span>총 <strong>{filteredCount}</strong>개</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#6c757d', verticalAlign: 'middle' }} /> 공용</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#0d6efd', verticalAlign: 'middle' }} /> 남자</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#dc3545', verticalAlign: 'middle' }} /> 여자</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: 'linear-gradient(90deg,#0d6efd 50%,#dc3545 50%)', verticalAlign: 'middle' }} /> 남·여 분리</span>
        <span>♿ 장애인</span>
        <span>🗺️ 안내소</span>
        <span>🏠 피난소</span>
      </div>

      {myPos && (calibOffset.lat !== 0 || calibOffset.lng !== 0) && (
        <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: 11, color: '#0c5460', background: '#e8f4fd', borderRadius: 8, padding: '4px 8px' }}>
          <span>📐 GPS 보정 적용 중 (위도 {calibOffset.lat.toFixed(6)}, 경도 {calibOffset.lng.toFixed(6)})</span>
          <button className="btn btn-sm py-0 px-1" style={{ fontSize: 11 }} onClick={() => {
            setCalibOffset({ lat: 0, lng: 0 })
            try { localStorage.removeItem(GPS_CALIB_KEY) } catch {}
          }}>초기화</button>
        </div>
      )}

      {myPos && (
        <div className="mt-1" style={{ fontSize: 11, color: '#888' }}>📍 내 위치(🧍)를 드래그하면 그 위치만큼 GPS가 보정됩니다.</div>
      )}

      {selected && editPos && (
        <div style={{
          position: 'fixed',
          left: Math.min(editPos.x + 14, window.innerWidth - 260),
          top: Math.max(8, Math.min(editPos.y - 40, window.innerHeight - 460)),
          width: 240,
          background: '#fff',
          borderRadius: 12,
          padding: '10px 12px',
          boxShadow: '0 4px 16px rgba(0,0,0,.25)',
          zIndex: 3000,
          maxHeight: 440,
          overflowY: 'auto',
        }}>
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h6 className="fw-bold mb-1" style={{ fontSize: 13 }}>
                {selected.facility_type === 'tourist_info' ? '🗺️' : selected.facility_type === 'shelter' ? '🏠' : '🚻'} {selected.name}
                {selected.is_community && <span className="badge bg-primary bg-opacity-10 text-primary ms-2" style={{ fontSize: 10 }}>주민</span>}
              </h6>
              <div style={{ fontSize: 12, color: '#888' }}>
                {typeLabel(selected.facility_type)}
                {selected.facility_type === 'toilet' && ` · ${genderLabel(selected.gender_type)}`}
                {selected.accessible && ' ♿ 장애인가능'}
              </div>
              {selected.address && <small className="text-muted d-block">{selected.address}</small>}
              {selected.open_hr && <small className="text-muted d-block">🕐 {selected.open_hr}</small>}
              {selected.notes && <small className="text-muted d-block">📝 {selected.notes}</small>}
              <div className="d-flex gap-3 mt-1" style={{ fontSize: 12 }}>
                <span>✅ {selected.verified_count}</span><span>❌ {selected.reject_count}</span>
                {selected.facility_type === 'toilet' && rejectRatio(selected) > 0 && (
                  <span className="text-danger">⚠ 사용불가 {Math.round(rejectRatio(selected) * 100)}%</span>
                )}
              </div>
            </div>
            <button className="btn btn-sm py-0 px-1" style={{ fontSize: 12 }} onClick={() => { setSelected(null); setEditPos(null); setEditing(null) }}>✕</button>
          </div>
          <a
            className="btn btn-sm btn-outline-primary w-100 mt-2"
            href={`/compass?popup=1&lat=${selected.lat}&lng=${selected.lng}&name=${encodeURIComponent(selected.name || typeLabel(selected.facility_type))}`}
          >🧭 나침반 내비</a>
          {!editing && selected.is_community && (
            <button className="btn btn-sm btn-outline-secondary w-100 mt-1"
              onClick={() => startEdit(selected)}>✏️ 수정</button>
          )}
          {editing && (
            <>
              <div className="d-flex justify-content-between align-items-center mt-2">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#b8860b' }}>✏️ 수정 중</div>
                <button className="btn btn-sm py-0 px-1" style={{ fontSize: 12 }} onClick={() => setEditing(null)}>편집 취소</button>
              </div>
              <input type="text" className="form-control form-control-sm mb-1" placeholder="이름"
                value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
              {editing.facility_type === 'toilet' && (
                <>
                  <div className="mb-1" style={{ fontSize: 11, color: '#666' }}>화장실 유형 선택 (여러 개 선택 가능)</div>
                  <div className="d-flex gap-2 flex-wrap mb-1">
                    {([
                      ['accessible', '♿ 장애인', '#28a745'],
                      ['male', '♂ 남자', '#0d6efd'],
                      ['female', '♀ 여자', '#dc3545'],
                      ['shared', '🚻 공용', '#6c757d'],
                    ] as const).map(([key, label, color]) => (
                      <label key={key} className="form-check form-check-inline mb-0" style={{ fontSize: 12 }}>
                        <input className="form-check-input" type="checkbox"
                          checked={!!editForm[key]}
                          onChange={() => setEditForm({ ...editForm, [key]: !editForm[key] })} />
                        <label className="form-check-label" style={{ fontSize: 12 }}>
                          <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, verticalAlign: 'middle', marginRight: 3 }} />
                          {label}
                        </label>
                      </label>
                    ))}
                  </div>
                </>
              )}
              <input type="text" className="form-control form-control-sm mb-1" placeholder="운영시간 (선택)"
                value={editForm.open_hr} onChange={e => setEditForm({ ...editForm, open_hr: e.target.value })} />
              <input type="text" className="form-control form-control-sm mb-2" placeholder="메모 (선택)"
                value={editForm.notes} onChange={e => setEditForm({ ...editForm, notes: e.target.value })} />
              <div className="d-flex gap-2">
                <button className="btn btn-sm btn-warning" onClick={handleEditSave}>저장</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)}>취소</button>
              </div>
            </>
          )}
          {user && (
            <div className="mt-2 pt-2 border-top">
              <div className="d-flex gap-2 mb-2">
                <button className={`btn btn-sm ${selected.my_report === 'verify' ? 'btn-success' : 'btn-outline-success'}`}
                  onClick={() => handleReport(selected.id, 'verify')}>✅ 사용가능</button>
                <button className={`btn btn-sm ${selected.my_report === 'reject' ? 'btn-danger' : 'btn-outline-danger'}`}
                  onClick={() => handleReport(selected.id, 'reject')}>❌ 사용불가</button>
              </div>
              <div className="input-group input-group-sm">
                <input type="text" className="form-control" placeholder="메모"
                  value={reportForm.comment} onChange={e => setReportForm({ comment: e.target.value })} />
                <button className="btn btn-outline-secondary" onClick={() => handleReport(selected.id, 'memo')}>메모</button>
              </div>
            </div>
          )}
        </div>
      )}

      {showAdd && addPos && (
        <div className="card mt-2 border-primary" style={{ borderRadius: 12 }}>
          <div className="card-body p-3">
            <h6 className="fw-bold mb-2">📍 새 {typeLabel(addType)} 등록</h6>
            <small className="text-muted d-block mb-2">위치: {addPos.lat.toFixed(5)}, {addPos.lng.toFixed(5)}</small>
            <input type="text" className="form-control form-control-sm mb-1" placeholder="이름 (비워두면 자동생성)"
              value={addForm.name} onChange={e => setAddForm({ ...addForm, name: e.target.value })} />
            {addType === 'toilet' && (
              <>
                <div className="mb-1" style={{ fontSize: 11, color: '#666' }}>화장실 유형 선택 (여러 개 선택 가능)</div>
                <div className="d-flex gap-2 flex-wrap mb-1">
                  {([
                    ['accessible', '♿ 장애인', '#28a745'],
                    ['male', '♂ 남자', '#0d6efd'],
                    ['female', '♀ 여자', '#dc3545'],
                    ['shared', '🚻 공용', '#6c757d'],
                  ] as const).map(([key, label, color]) => (
                    <label key={key} className="form-check form-check-inline mb-0" style={{ fontSize: 12 }}>
                      <input className="form-check-input" type="checkbox"
                        checked={!!addForm[key]}
                        onChange={() => setAddForm({ ...addForm, [key]: !addForm[key] })} />
                      <label className="form-check-label" style={{ fontSize: 12 }}>
                        <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: color, verticalAlign: 'middle', marginRight: 3 }} />
                        {label}
                      </label>
                    </label>
                  ))}
                </div>
                <div className="d-flex align-items-center gap-2 mb-1" style={{ fontSize: 11, color: '#666' }}>
                  <span>선택결과 미리보기:</span>
                  <div dangerouslySetInnerHTML={{
                    __html: markerContent({
                      gender_type: addForm.accessible ? 'mixed' : computeGender(addForm),
                      accessible: addForm.accessible,
                      lat: 0, lng: 0, id: 0, name: '', status: 'active', is_community: false,
                      verified_count: 0, reject_count: 0, facility_type: 'toilet',
                    } as any)
                  }} />
                </div>
              </>
            )}
            <input type="text" className="form-control form-control-sm mb-1" placeholder="운영시간 (선택)"
              value={addForm.open_hr} onChange={e => setAddForm({ ...addForm, open_hr: e.target.value })} />
            <input type="text" className="form-control form-control-sm mb-2" placeholder="메모 (선택)"
              value={addForm.notes} onChange={e => setAddForm({ ...addForm, notes: e.target.value })} />
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-primary" onClick={handleAdd}>등록</button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => { setShowAdd(false); setAddPos(null); setAddType('toilet') }}>취소</button>
            </div>
          </div>
        </div>
      )}

      {user && !showAdd && !typePopup && (
        <div className="mt-2" style={{ fontSize: 12, color: '#888' }}>💡 지도를 클릭하면 유형(화장실·관광안내소·피난소)을 선택해 등록할 수 있습니다.</div>
      )}
    </div>
  )
}
