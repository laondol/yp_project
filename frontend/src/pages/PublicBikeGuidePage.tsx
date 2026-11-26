import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

interface BikeBrand {
  id: string
  name: string
  region: string
  available: boolean
  operator?: string
  homepage?: string
  app?: string
  fee?: string
  note?: string
}

interface BikeStation {
  name: string
  lat: number
  lng: number
  racks: number
  bikes: number
  distance_m: number
}

export default function PublicBikeGuidePage() {
  const [brands, setBrands] = useState<BikeBrand[]>([])
  const [status, setStatus] = useState<{ available: boolean; stations: number; reason: string } | null>(null)
  const [stations, setStations] = useState<BikeStation[]>([])
  const [nearBusy, setNearBusy] = useState(false)
  const [nearMsg, setNearMsg] = useState('')

  useEffect(() => {
    fetch('/api/bot/bike/near', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setBrands(Array.isArray(d?.brands) ? d.brands : [])
        setStatus(d?.status || null)
      })
      .catch(() => {})
  }, [])

  function loadNearby() {
    if (!navigator.geolocation) {
      setNearMsg('이 브라우저는 위치 기능을 지원하지 않습니다.')
      return
    }
    setNearBusy(true)
    setNearMsg('')
    navigator.geolocation.getCurrentPosition(async pos => {
      try {
        const { latitude, longitude } = pos.coords
        const d = await fetch(`/api/bot/bike/near?lat=${latitude}&lng=${longitude}&radius=1&limit=10&brands=ttaereung`,
          { credentials: 'include' }).then(r => r.json())
        const list = Array.isArray(d?.stations) ? d.stations : []
        setStations(list)
        if (!list.length) setNearMsg('주변 1km 안에 대여소가 없습니다.')
      } catch {
        setNearMsg('대여소 정보를 불러오지 못했습니다.')
      } finally {
        setNearBusy(false)
      }
    }, () => {
      setNearMsg('위치 권한이 필요합니다. HTTPS 접속 또는 권한 허용 후 다시 시도해 주세요.')
      setNearBusy(false)
    }, { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="container py-4" style={{ maxWidth: 860 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="fw-bold mb-0">🚲 공공자전거 이용 안내</h5>
        <Link to="/schedule" className="btn btn-sm btn-outline-secondary">일정으로</Link>
      </div>

      <div className="alert alert-light small">
        공공자전거는 지자체별 브랜드마다 앱과 요금이 다릅니다. 아래에서 브랜드를 확인하고,
        경로 수정 → ⚙️ 대중교통 설정에서 사용할 브랜드를 선택하면 추천 경로에 자전거 구간이 포함됩니다.
      </div>

      <div className="card p-3 mb-3" style={{ borderRadius: 12 }}>
        <div className="fw-bold mb-2">브랜드</div>
        {!brands.length && <div className="small text-muted">브랜드 정보를 불러오는 중...</div>}
        <div className="row g-2">
          {brands.map(b => (
            <div className="col-12 col-md-6" key={b.id}>
              <div className="border rounded p-2 h-100">
                <div className="fw-semibold">
                  {b.name} <span className="text-muted small">({b.region})</span>
                  {b.available
                    ? <span className="badge bg-success ms-1" style={{ fontSize: 10 }}>위치 조회 가능</span>
                    : <span className="badge bg-secondary ms-1" style={{ fontSize: 10 }}>위치 조회 미지원</span>}
                </div>
                {b.operator && <div className="small text-muted">운영: {b.operator}</div>}
                {b.app && <div className="small text-muted">앱: {b.app}</div>}
                {b.fee && <div className="small text-muted">요금: {b.fee}</div>}
                {b.homepage && (
                  <a className="small" href={b.homepage} target="_blank" rel="noreferrer">홈페이지 →</a>
                )}
              </div>
            </div>
          ))}
        </div>
        {status && (
          <div className={`small mt-2 ${status.available ? 'text-success' : 'text-danger'}`}>
            {status.available
              ? `실시간 대여소 ${status.stations.toLocaleString()}곳 조회 가능`
              : `대여소 조회 불가: ${status.reason}`}
          </div>
        )}
      </div>

      <div className="card p-3 mb-3" style={{ borderRadius: 12 }}>
        <div className="fw-bold mb-2">따릉이 이용 방법</div>
        <ol className="small mb-2">
          <li className="mb-1"><b>준비물</b> — 스마트폰, 따릉이 앱, 결제수단(카드/간편결제), 만 15세 이상</li>
          <li className="mb-1"><b>회원가입</b> — 앱에서 가입 후 이용권 구매(일반권 1시간 1,000원, 정기권 30일 5,000원)</li>
          <li className="mb-1"><b>대여</b> — 앱 지도에서 대여소 선택 → 자전거 QR/번호 입력 또는 앱 잠금 해제</li>
          <li className="mb-1"><b>이용</b> — 자전거도로 우선 이용, 1시간 초과 시 추가 요금(5분 단위) 발생</li>
          <li className="mb-1"><b>반납</b> — 가까운 대여소 거치대에 세우고 잠금 → 앱에서 반납 확인</li>
        </ol>
        <div className="small text-muted">
          대여소 위치·잔여 대수는 실시간으로 바뀝니다. 반납 전 앱에서 거치대 여유를 확인하세요.
        </div>
      </div>

      <div className="card p-3 mb-3" style={{ borderRadius: 12 }}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <div className="fw-bold">내 주변 대여소</div>
          <button className="btn btn-sm btn-success" onClick={loadNearby} disabled={nearBusy}>
            {nearBusy ? '찾는 중...' : '현재 위치로 찾기'}
          </button>
        </div>
        {nearMsg && <div className="small text-danger mb-2">{nearMsg}</div>}
        {!stations.length && !nearMsg && (
          <div className="small text-muted">버튼을 누르면 현재 위치 기준 1km 안의 따릉이 대여소를 보여줍니다. (위치 권한 필요)</div>
        )}
        {stations.map((s, i) => (
          <div key={i} className="d-flex justify-content-between border-bottom py-1 small">
            <span>{s.name}</span>
            <span className="text-muted">
              {s.distance_m}m · 잔여 <b className={s.bikes > 0 ? 'text-success' : 'text-danger'}>{s.bikes}대</b> / 거치대 {s.racks}
            </span>
          </div>
        ))}
      </div>

      <div className="card p-3" style={{ borderRadius: 12 }}>
        <div className="fw-bold mb-2">주의사항</div>
        <ul className="small mb-0">
          <li>안전모 착용과 야간 라이트 사용은 필수입니다.</li>
          <li>음주 상태에서는 이용할 수 없습니다.</li>
          <li>대여소가 아닌 곳에 반납하면 추가 요금이 발생할 수 있습니다.</li>
          <li>고장 난 자전거는 반납 후 앱에서 신고해 주세요.</li>
        </ul>
      </div>
    </div>
  )
}
