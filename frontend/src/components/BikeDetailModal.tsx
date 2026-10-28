import { useEffect, useState } from 'react'

export interface BikePlace {
  name: string
  lat: number
  lng: number
  content_id?: string
  content_type_id?: string
  opening_hours?: string
  closed_days?: string
}

interface BikeAnalysis {
  distance_m: number
  duration_min: number
  duration_sec: number
  avg_speed_kmh: number
  bike_road_pct: number
  dedicated_pct: number
  lane_pct: number
  shared_pct: number
  general_pct: number
  busy_road_pct: number
  unpaved_pct: number
  max_grade_pct: number
  max_grade_deg: number
  max_grade_length_m: number
  max_grade_at_m: number
  ascent_m: number
  descent_m: number
  bike_friendly: string
  bike_friendly_label: string
  bike_reason: string
  source: string
}

interface PlaceDetail {
  opening_hours: string
  closed_days: string
  tel: string
  bike: BikeAnalysis | null
}

interface Props {
  place: BikePlace
  originLat: number
  originLng: number
  loggedIn: boolean
  onClose: () => void
  onStartGps: (place: BikePlace) => void
  onSaved?: () => void
}

const friendlyClass = (level?: string) => {
  if (level === 'good') return 'bg-success'
  if (level === 'ok') return 'bg-warning text-dark'
  return 'bg-danger'
}

export default function BikeDetailModal({ place, originLat, originLng, loggedIn, onClose, onStartGps, onSaved }: Props) {
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({
      to_lat: String(place.lat),
      to_lng: String(place.lng),
    })
    if (originLat && originLng) {
      params.set('from_lat', String(originLat))
      params.set('from_lng', String(originLng))
    }
    if (place.content_id) params.set('content_id', String(place.content_id))
    if (place.content_type_id) params.set('content_type_id', String(place.content_type_id))
    setLoading(true)
    setError('')
    fetch(`/construction/bike-detail?${params.toString()}`)
      .then(r => r.json())
      .then((data: PlaceDetail) => {
        if (!cancelled) setDetail(data)
      })
      .catch(() => {
        if (!cancelled) setError('자전거 코스 정보를 불러오지 못했습니다.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [place, originLat, originLng])

  const bike = detail?.bike || null
  const hours = detail?.opening_hours || place.opening_hours || ''
  const closed = detail?.closed_days || place.closed_days || ''

  const saveCourse = async () => {
    if (!loggedIn) {
      alert('로그인이 필요합니다.')
      return
    }
    if (!bike) return
    setSaving(true)
    try {
      const res = await fetch('/construction/bike-rides', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_name: place.name,
          place_lat: place.lat,
          place_lng: place.lng,
          origin_lat: originLat,
          origin_lng: originLng,
          bike,
          memo,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || '기록 저장에 실패했습니다.')
        return
      }
      setSaved(true)
      onSaved?.()
    } catch {
      alert('기록 저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.55)', zIndex: 5000 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 16 }}>
          <div className="modal-header py-2">
            <div>
              <h6 className="modal-title fw-bold mb-0">🚲 {place.name} 자전거 코스</h6>
              <small className="text-muted">출발지 기준 자전거 경로 분석</small>
            </div>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            {loading ? (
              <div className="text-center text-muted py-4 small">자전거 경로와 운영시간을 확인하는 중...</div>
            ) : error ? (
              <div className="alert alert-warning small mb-3">{error}</div>
            ) : (
              <>
                <div className="mb-3 p-3 rounded" style={{ background: '#f8f9fa' }}>
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span className={`badge ${friendlyClass(bike?.bike_friendly)}`}>
                      {bike ? `자전거 ${bike.bike_friendly_label}` : '경로 정보 없음'}
                    </span>
                    {bike && <span className="small text-muted">평균 {bike.avg_speed_kmh}km/h</span>}
                  </div>
                  {bike ? (
                    <>
                      <div className="fw-bold small mb-1">
                        {bike.distance_m >= 1000 ? `${(bike.distance_m / 1000).toFixed(1)}km` : `${bike.distance_m}m`}
                        {' · '}약 {bike.duration_min}분
                      </div>
                      <div className="small text-muted mb-2">{bike.bike_reason}</div>
                      <div className="row g-2 small">
                        <div className="col-6 col-md-3">
                          <div className="text-muted">자전거도로</div>
                          <div className="fw-bold">{bike.bike_road_pct}%</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                            전용 {bike.dedicated_pct}% · 차로 {bike.lane_pct}% · 공용 {bike.shared_pct}%
                          </div>
                        </div>
                        <div className="col-6 col-md-3">
                          <div className="text-muted">최대 경사</div>
                          <div className="fw-bold">{bike.max_grade_deg}° ({bike.max_grade_pct}%)</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                            {bike.max_grade_length_m}m · 출발 후 {bike.max_grade_at_m}m
                          </div>
                        </div>
                        <div className="col-6 col-md-3">
                          <div className="text-muted">누적 상승</div>
                          <div className="fw-bold">{bike.ascent_m}m</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>하강 {bike.descent_m}m</div>
                        </div>
                        <div className="col-6 col-md-3">
                          <div className="text-muted">일반 차도</div>
                          <div className="fw-bold">{bike.busy_road_pct}%</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                            비포장 {bike.unpaved_pct}%
                          </div>
                        </div>
                      </div>
                      <div className="text-muted mt-2" style={{ fontSize: '0.68rem' }}>
                        BRouter/OpenStreetMap 기준 · 실제 도로·날씨·통제 상황과 다를 수 있습니다.
                      </div>
                    </>
                  ) : (
                    <div className="small text-muted">출발 위치 또는 경로 정보가 없어 자전거 분석을 표시할 수 없습니다.</div>
                  )}
                </div>

                <div className="mb-3">
                  <div className="fw-bold small mb-1">🕘 운영시간</div>
                  <div className="small">{hours || '정보 없음'}</div>
                  {closed && <div className="small text-muted mt-1">휴무: {closed}</div>}
                  {detail?.tel && <div className="small text-muted mt-1">문의: {detail.tel}</div>}
                  <div className="text-muted mt-1" style={{ fontSize: '0.68rem' }}>
                    TourAPI 기준 · 운영시간은 변경될 수 있으니 방문 전 확인하세요.
                  </div>
                </div>

                <div className="mb-3">
                  <div className="fw-bold small mb-1">🚴 코스 기록</div>
                  <div className="d-flex gap-2">
                    <input
                      className="form-control form-control-sm"
                      placeholder="메모 (선택)"
                      value={memo}
                      onChange={e => setMemo(e.target.value)}
                      maxLength={200}
                    />
                    <button className="btn btn-sm btn-success flex-shrink-0" onClick={saveCourse} disabled={!bike || saving || saved || !loggedIn}>
                      {saving ? '저장 중...' : saved ? '저장됨' : '코스 저장'}
                    </button>
                  </div>
                  {!loggedIn && <div className="small text-muted mt-1">로그인 후 기록을 저장할 수 있습니다.</div>}
                  {saved && <div className="small text-success mt-1">코스 기록이 저장되었습니다.</div>}
                  <div className="d-flex gap-2 mt-2">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => onStartGps(place)}>
                      📍 실제 주행 GPS 기록 시작
                    </button>
                    {detail && <span className="small text-muted align-self-center">화면을 켜 둔 상태에서 기록됩니다.</span>}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
