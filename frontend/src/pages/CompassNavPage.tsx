import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CompassNav from '../components/CompassNav'

const LS_KEY = 'compass_dest'

export default function CompassNavPage() {
  const [params] = useSearchParams()
  const [manual, setManual] = useState<{ lat: string; lng: string; name: string } | null>(null)
  const [searchAddr, setSearchAddr] = useState('')
  const [searching, setSearching] = useState(false)

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

  const startManual = () => {
    const la = parseFloat(manual?.lat || '')
    const ln = parseFloat(manual?.lng || '')
    if (isNaN(la) || isNaN(ln)) return alert('위도/경도를 숫자로 입력해주세요.')
    setManual({ lat: String(la), lng: String(ln), name: manual?.name || '목적지' })
  }

  const searchAddrSubmit = async () => {
    if (!searchAddr.trim()) return
    setSearching(true)
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(searchAddr)}`)
      const d = await r.json()
      if (d && d.lat && d.lng) {
        setManual({ lat: String(d.lat), lng: String(d.lng), name: searchAddr.trim() })
      } else {
        alert('주소를 찾지 못했습니다.')
      }
    } catch {
      alert('주소 검색 실패 (온라인 필요)')
    } finally { setSearching(false) }
  }

  if (!lat || !lng) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '100vh', background: '#f8f9fa', padding: 20 }}>
        <h5 className="mb-3">🧭 목적지를 설정해주세요</h5>
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

  return <CompassNav destLat={lat} destLng={lng} destName={name} waypoints={waypoints} onClose={() => window.history.back()} />
}
