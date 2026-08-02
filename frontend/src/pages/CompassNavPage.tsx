import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import CompassNav from '../components/CompassNav'

const LS_KEY = 'compass_dest'

const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371000
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const formatDist = (m: number) => {
  if (m < 1000) return `${Math.round(m)}m`
  return `${(m / 1000).toFixed(1)}km`
}

export default function CompassNavPage() {
  const [params] = useSearchParams()
  const [manual, setManual] = useState<{ lat: string; lng: string; name: string } | null>(null)
  const [searchAddr, setSearchAddr] = useState('')
  const [searching, setSearching] = useState(false)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [gpsPos, setGpsPos] = useState<{ lat: number; lng: number } | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)

  let lat = manual ? parseFloat(manual.lat) : parseFloat(params.get('lat') || '0')
  let lng = manual ? parseFloat(manual.lng) : parseFloat(params.get('lng') || '0')
  let name = manual ? manual.name : params.get('name') || '목적지'
  let waypoints: { lat: number; lng: number; name: string; mode?: string; detail?: string }[] = []

  try {
    const wpParam = params.get('waypoints')
    if (wpParam) waypoints = JSON.parse(decodeURIComponent(wpParam))
  } catch {}

  if (!manual && (!lat || !lng) && waypoints.length === 0) {
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
      if (saved.waypoints && saved.waypoints.length > 0) {
        waypoints = saved.waypoints
        lat = saved.lat || waypoints[waypoints.length - 1].lat
        lng = saved.lng || waypoints[waypoints.length - 1].lng
        name = saved.name || name
      } else if (saved.lat && saved.lng) {
        lat = saved.lat
        lng = saved.lng
        name = saved.name || name
      }
    } catch {}
  }

  const manualWaypoint = manual
    ? { lat: parseFloat(manual.lat), lng: parseFloat(manual.lng), name: manual.name || '목적지' }
    : null
  const allWaypoints = manualWaypoint ? [...waypoints, manualWaypoint] : waypoints

  useEffect(() => {
    if (waypoints.length === 0 || gpsPos) return
    if (!navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      pos => { if (!cancelled) setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }) },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    )
    return () => { cancelled = true }
  }, [waypoints, gpsPos])

  const startManual = () => {
    const la = parseFloat(manual?.lat || '')
    const ln = parseFloat(manual?.lng || '')
    if (isNaN(la) || isNaN(ln)) return alert('위도/경도를 숫자로 입력해주세요.')
    setManual({ lat: String(la), lng: String(ln), name: manual?.name || '목적지' })
    setShowManualForm(false)
  }

  const searchAddrSubmit = async () => {
    if (!searchAddr.trim()) return
    setSearching(true)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(searchAddr)}`)
      const d = await r.json()
      if (d && d.lat && d.lng) {
        setManual({ lat: String(d.lat), lng: String(d.lng), name: searchAddr.trim() })
        setShowManualForm(false)
      } else {
        alert('주소를 찾지 못했습니다.')
      }
    } catch {
      alert('주소 검색 실패 (온라인 필요)')
    } finally { setSearching(false) }
  }

  if (selectedIdx === null && allWaypoints.length > 0 && !showManualForm) {
    const sorted = [...allWaypoints].sort((a, b) => {
      if (!gpsPos) return 0
      return haversineDistance(gpsPos.lat, gpsPos.lng, a.lat, a.lng) - haversineDistance(gpsPos.lat, gpsPos.lng, b.lat, b.lng)
    })
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh', background: '#f8f9fa', padding: 20 }}>
        <div className="w-100" style={{ maxWidth: 360 }}>
          <div className="d-flex align-items-center justify-content-between mb-3">
            <h5 className="mb-0">🧭 목적지를 선택하세요</h5>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => window.history.back()}>✕</button>
          </div>
          {!gpsPos && (
            <div className="text-center mb-2">
              <button className="btn btn-sm btn-outline-primary" onClick={() => {
                if (!navigator.geolocation) return
                navigator.geolocation.getCurrentPosition(
                  pos => setGpsPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                  () => {},
                  { enableHighAccuracy: true, timeout: 10000 }
                )
              }}>🛰 GPS 위치 받기 (거리순 정렬)</button>
            </div>
          )}
          <div className="d-flex flex-column gap-2">
            {sorted.map((w, i) => {
              const d = gpsPos ? haversineDistance(gpsPos.lat, gpsPos.lng, w.lat, w.lng) : null
              const badge = d === null ? '' : d < 2000 ? 'bg-success' : d < 5000 ? 'bg-warning text-dark' : 'bg-secondary'
              const label = d === null ? '' : d < 2000 ? '2km 이내' : d < 5000 ? '5km 이내' : '5km 이상'
              return (
                <button key={i} className="btn btn-light border text-start d-flex align-items-center justify-content-between"
                  style={{ borderRadius: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
                  onClick={() => setSelectedIdx(allWaypoints.indexOf(w))}>
                  <span className="fw-bold">{w.name}</span>
                  <span className="d-flex align-items-center gap-2">
                    {d !== null && <span style={{ fontSize: 12, color: '#666' }}>{formatDist(d)}</span>}
                    {label && <span className={`badge ${badge}`} style={{ fontSize: 10 }}>{label}</span>}
                  </span>
                </button>
              )
            })}
          </div>
          <button className="btn btn-sm btn-outline-primary w-100 mt-3" onClick={() => setShowManualForm(true)}>✏️ 직접 입력</button>
        </div>
      </div>
    )
  }

  if (showManualForm || !lat || !lng) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh', background: '#f8f9fa', padding: 20 }}>
        <div className="w-100 d-flex align-items-center justify-content-between mb-3" style={{ maxWidth: 360 }}>
          <h5 className="mb-0">🧭 목적지를 설정해주세요</h5>
          {showManualForm && waypoints.length > 0 && (
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowManualForm(false)}>← 목록</button>
          )}
        </div>
        <div className="card w-100" style={{ maxWidth: 360, borderRadius: 14 }}>
          <div className="card-body">
            <label className="small text-muted d-block mb-1">주소 검색 (온라인)</label>
            <div className="input-group input-group-sm mb-3">
              <input type="text" className="form-control" placeholder="예) 서울역"
                value={searchAddr} onChange={e => setSearchAddr(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchAddrSubmit()} />
              <button className="btn btn-outline-primary" onClick={searchAddrSubmit} disabled={searching}>{searching ? '...' : '검색'}</button>
            </div>
            <label className="small text-muted d-block mb-1">또는 위도·경도 직접 입력 (오프라인 가능)</label>
            <div className="d-flex gap-2 mb-2">
              <input type="number" step="any" className="form-control form-control-sm" placeholder="위도" value={manual?.lat || ''}
                onChange={e => setManual({ lat: e.target.value, lng: manual?.lng || '', name: manual?.name || '' })} />
              <input type="number" step="any" className="form-control form-control-sm" placeholder="경도" value={manual?.lng || ''}
                onChange={e => setManual({ lat: manual?.lat || '', lng: e.target.value, name: manual?.name || '' })} />
            </div>
            <input type="text" className="form-control form-control-sm mb-2" placeholder="목적지 이름 (선택)" value={manual?.name || ''}
              onChange={e => setManual({ lat: manual?.lat || '', lng: manual?.lng || '', name: e.target.value })} />
            <button className="btn btn-sm btn-primary w-100" onClick={startManual}>🧭 네비 시작</button>
          </div>
        </div>
      </div>
    )
  }

  const sel = selectedIdx !== null ? allWaypoints[selectedIdx] : null
  return <CompassNav destLat={sel?.lat ?? lat} destLng={sel?.lng ?? lng} destName={sel?.name ?? name}
    waypoints={sel ? [sel] : allWaypoints}
    onClose={() => window.history.back()}
    onChangeDest={allWaypoints.length > 0 ? () => setSelectedIdx(null) : undefined} />
}
