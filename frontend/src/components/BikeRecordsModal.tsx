import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface RideRecord {
  id: number
  ride_type: 'course' | 'gps'
  place_name: string
  distance_m: number
  duration_sec: number
  avg_speed_kmh: number
  bike_road_pct: number | null
  max_grade_deg: number | null
  bike_friendly: string
  memo: string
  created_at: string
}

interface Props {
  onClose: () => void
}

const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}시간 ${m}분`
  return `${Math.max(1, m)}분`
}

export default function BikeRecordsModal({ onClose }: Props) {
  const [rides, setRides] = useState<RideRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    fetch('/construction/bike-rides')
      .then(async r => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || '기록을 불러오지 못했습니다.')
        setRides(data.rides || [])
      })
      .catch(e => setError(e instanceof Error ? e.message : '기록을 불러오지 못했습니다.'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.55)', zIndex: 5000 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 16 }}>
          <div className="modal-header py-2">
            <h6 className="modal-title fw-bold mb-0">🚴 내 라이딩 기록</h6>
            <button type="button" className="btn-close" onClick={onClose}></button>
          </div>
          <div className="modal-body">
            <div className="d-flex justify-content-end mb-2">
              <button className="btn btn-sm btn-outline-secondary" onClick={load} disabled={loading}>새로고침</button>
            </div>
            {loading ? (
              <div className="text-center text-muted py-4 small">불러오는 중...</div>
            ) : error ? (
              <div className="alert alert-warning small">{error}</div>
            ) : rides.length === 0 ? (
              <div className="text-center text-muted py-4 small">아직 저장한 라이딩 기록이 없습니다.</div>
            ) : (
              <div className="d-flex flex-column gap-2">
                {rides.map(r => (
                  <div key={r.id} className="border rounded p-2">
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div>
                        <span className={`badge ${r.ride_type === 'gps' ? 'bg-primary' : 'bg-success'}`}>
                          {r.ride_type === 'gps' ? '📍 GPS 주행' : '🚲 코스'}
                        </span>
                        <span className="fw-bold small ms-1">{r.place_name || '자전거 주행'}</span>
                      </div>
                      <small className="text-muted">{formatKST(r.created_at)}</small>
                    </div>
                    <div className="small text-muted mt-1">
                      {(Number(r.distance_m || 0) / 1000).toFixed(1)}km · {fmtDuration(Number(r.duration_sec || 0))}
                      {r.avg_speed_kmh ? ` · 평균 ${r.avg_speed_kmh}km/h` : ''}
                      {r.bike_road_pct != null ? ` · 자전거도로 ${r.bike_road_pct}%` : ''}
                      {r.max_grade_deg != null ? ` · 최대 ${r.max_grade_deg}°` : ''}
                    </div>
                    {r.memo && <div className="small mt-1">📝 {r.memo}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
