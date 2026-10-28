import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'

interface BikeAnalysis {
  distance_m?: number
  duration_min?: number
  avg_speed_kmh?: number
  bike_road_pct?: number
  dedicated_pct?: number
  lane_pct?: number
  shared_pct?: number
  general_pct?: number
  busy_road_pct?: number
  unpaved_pct?: number
  max_grade_pct?: number
  max_grade_deg?: number
  max_grade_length_m?: number
  max_grade_at_m?: number
  ascent_m?: number
  descent_m?: number
  bike_friendly?: string
  bike_friendly_label?: string
  bike_reason?: string
}

interface PlaceDetail {
  name: string
  type?: string
  category?: string
  address?: string
  overview?: string
  homepage?: string
  tel?: string
  opening_hours?: string
  closed_days?: string
  image_url?: string
  images?: string[]
  lat?: number
  lng?: number
  origin_lat?: number | null
  origin_lng?: number | null
  stamped?: boolean
  source?: string
  bike?: BikeAnalysis | null
}

const friendlyClass = (level?: string) => {
  if (level === 'good') return 'bg-success'
  if (level === 'ok') return 'bg-warning text-dark'
  return 'bg-danger'
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="d-flex gap-3 py-2 border-bottom">
      <div className="text-muted small flex-shrink-0" style={{ width: 76 }}>{label}</div>
      <div className="small flex-grow-1">{children}</div>
    </div>
  )
}

export default function HeritageDetailPage() {
  const { placeKey } = useParams<{ placeKey: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const query = searchParams.toString()
  const [detail, setDetail] = useState<PlaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hero, setHero] = useState('')

  const requestParams = useMemo(() => {
    const key = placeKey || ''
    const params = new URLSearchParams(query)
    if (/^\d+$/.test(key)) params.set('content_id', key)
    if (!params.get('name') && !/^\d+$/.test(key)) params.set('name', key)
    return params
  }, [placeKey, query])

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/construction/heritage/detail?${requestParams.toString()}`)
      if (!res.ok) {
        setError('장소 정보를 불러올 수 없습니다.')
        return
      }
      const data = await res.json()
      if (data.error) {
        setError(data.error)
        return
      }
      setDetail(data)
      setHero(data.image_url || data.images?.[0] || '')
    } catch {
      setError('서버 연결에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [requestParams])

  const mapName = encodeURIComponent(detail?.name || '')
  const originLat = detail?.origin_lat
  const originLng = detail?.origin_lng
  const bike = detail?.bike

  return (
    <div className="py-2" style={{ maxWidth: 900, margin: '0 auto' }}>
      <button type="button" className="btn btn-sm btn-outline-secondary mb-3" onClick={() => navigate('/construction?tab=heritage')}>
        ← 가볼만한 곳
      </button>

      {loading ? (
        <Loading text="장소 정보를 불러오는 중..." />
      ) : error ? (
        <ErrorMessage message={error} onRetry={load} />
      ) : detail ? (
        <>
          <div className="card border-0 shadow-sm overflow-hidden" style={{ borderRadius: 18 }}>
            {hero ? (
              <img src={hero} alt={detail.name} className="w-100" style={{ height: 280, objectFit: 'cover' }} />
            ) : (
              <div className="d-flex align-items-center justify-content-center text-white" style={{ height: 180, background: 'linear-gradient(135deg, #198754, #8fd3b4)' }}>
                <div className="text-center">
                  <div style={{ fontSize: 42 }}>📍</div>
                  <div className="small">등록된 사진이 없습니다.</div>
                </div>
              </div>
            )}

            {detail.images && detail.images.length > 1 && (
              <div className="d-flex gap-2 p-2 overflow-auto">
                {detail.images.map(image => (
                  <button
                    type="button"
                    key={image}
                    className={`btn p-0 border ${hero === image ? 'border-success border-2' : 'border-light'}`}
                    onClick={() => setHero(image)}
                    style={{ borderRadius: 8, overflow: 'hidden' }}
                  >
                    <img src={image} alt="" style={{ width: 76, height: 56, objectFit: 'cover' }} />
                  </button>
                ))}
              </div>
            )}

            <div className="card-body p-3 p-md-4">
              <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                <span className="badge bg-success">{detail.type || detail.category || '가볼만한 곳'}</span>
                {detail.stamped && <span className="badge bg-warning text-dark">⭐ 방문완료</span>}
              </div>
              <h3 className="fw-bold mb-2">{detail.name}</h3>
              {detail.address && <div className="text-muted small mb-3">📍 {detail.address}</div>}

              <div className="d-flex gap-1 flex-wrap mb-4">
                {detail.lat != null && detail.lng != null && (
                  <>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1${originLat && originLng ? `&origin=${originLat},${originLng}` : ''}&destination=${detail.lat},${detail.lng}`}
                      target="_blank" className="btn btn-sm btn-outline-secondary" rel="noopener noreferrer"
                    >
                      Google 길찾기
                    </a>
                    <a
                      href={`https://map.kakao.com/link/to/${mapName},${detail.lat},${detail.lng}`}
                      target="_blank" className="btn btn-sm btn-outline-warning" rel="noopener noreferrer"
                    >
                      카카오 길찾기
                    </a>
                    <a
                      href={originLat && originLng
                        ? `https://map.naver.com/index.nhn?slat=${originLat}&slng=${originLng}&elat=${detail.lat}&elng=${detail.lng}&etitle=${mapName}`
                        : `https://map.naver.com/index.nhn?elat=${detail.lat}&elng=${detail.lng}&etitle=${mapName}`}
                      target="_blank" className="btn btn-sm btn-outline-success" rel="noopener noreferrer"
                    >
                      네이버 길찾기
                    </a>
                  </>
                )}
              </div>

              <h5 className="fw-bold">소개</h5>
              <p className="text-muted small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
                {detail.overview || '등록된 소개 정보가 없습니다.'}
              </p>

              <h5 className="fw-bold mt-4">이용 정보</h5>
              <InfoRow label="운영시간">{detail.opening_hours || '정보 없음'}</InfoRow>
              <InfoRow label="휴무일">{detail.closed_days || '정보 없음'}</InfoRow>
              <InfoRow label="문의">
                {detail.tel ? <a href={`tel:${detail.tel.replace(/[^0-9+]/g, '')}`}>{detail.tel}</a> : '정보 없음'}
              </InfoRow>
              {detail.homepage && (
                <InfoRow label="홈페이지">
                  <a href={detail.homepage} target="_blank" rel="noopener noreferrer">{detail.homepage}</a>
                </InfoRow>
              )}

              <h5 className="fw-bold mt-4">자전거 코스</h5>
              {bike ? (
                <>
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <span className="badge bg-success">🚲 약 {bike.duration_min}분</span>
                    <span className="badge bg-light text-dark">약 {(Number(bike.distance_m || 0) / 1000).toFixed(1)}km</span>
                    <span className={`badge ${friendlyClass(bike.bike_friendly)}`}>🚲 {bike.bike_friendly_label}</span>
                    <span className="badge bg-light text-dark">자전거도로 {bike.bike_road_pct}%</span>
                    <span className="badge bg-light text-dark">최대 경사 {bike.max_grade_deg}°</span>
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-6 col-md-3"><div className="border rounded-3 p-2 text-center"><div className="text-muted" style={{ fontSize: 11 }}>자전거 전용</div><div className="fw-bold">{bike.dedicated_pct ?? 0}%</div></div></div>
                    <div className="col-6 col-md-3"><div className="border rounded-3 p-2 text-center"><div className="text-muted" style={{ fontSize: 11 }}>자전거 차로</div><div className="fw-bold">{bike.lane_pct ?? 0}%</div></div></div>
                    <div className="col-6 col-md-3"><div className="border rounded-3 p-2 text-center"><div className="text-muted" style={{ fontSize: 11 }}>보행자 공용</div><div className="fw-bold">{bike.shared_pct ?? 0}%</div></div></div>
                    <div className="col-6 col-md-3"><div className="border rounded-3 p-2 text-center"><div className="text-muted" style={{ fontSize: 11 }}>일반 차도</div><div className="fw-bold">{bike.general_pct ?? 0}%</div></div></div>
                  </div>

                  <div className="border rounded-3 p-3 small text-muted">
                    <div>가장 센 오르막: <strong className="text-dark">{bike.max_grade_deg}°</strong> ({bike.max_grade_pct}%), 길이 <strong className="text-dark">{bike.max_grade_length_m}m</strong>, 출발 후 {bike.max_grade_at_m}m 지점</div>
                    <div className="mt-1">누적 상승 {bike.ascent_m}m · 하강 {bike.descent_m}m · 평균 {bike.avg_speed_kmh}km/h</div>
                    {bike.bike_reason && <div className="mt-1">{bike.bike_reason}</div>}
                  </div>
                </>
              ) : (
                <p className="text-muted small mb-0">현재 위치를 확인하면 자전거 경로를 계산할 수 있습니다.</p>
              )}

              <div className="text-muted mt-4" style={{ fontSize: 11 }}>
                출처: {detail.source === 'tour_api' ? '한국관광공사 TourAPI' : '양평 관광정보'}. 운영시간은 사정에 따라 달라질 수 있습니다.
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
