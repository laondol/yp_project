import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { constructionApi } from '../lib/api'
import type { ConstructionNotice } from '../lib/types'
import { useAuth } from '../contexts/AuthContext'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'
import FacilityMap from '../components/FacilityMap'
import { formatKST } from '../utils/format';

interface HeritageItem {
  name: string; lat: number; lng: number; description?: string
  category?: string; type?: string; image_url?: string; dist?: number
  stamped?: boolean; near_home?: boolean; dist_from_home?: number
}
interface SceneryItem {
  id: number; title: string; image_path: string; description?: string; created_at?: string
}
interface StoreGroup {
  name: string; lat: number; lng: number; image?: string; store_link?: string
  link_label?: string; posts: { id: number; title: string; image?: string }[]
}
interface AlertItem {
  id: number; title: string; content?: string; town?: string; village?: string
  alert_type?: string; urgency?: string; author_name?: string; created_at?: string
}

const typeLabels: Record<string, string> = {
  traffic_incident: '교통돌발', traffic_congestion: '지정체', road_construction: '도로공사', building_permit: '건축공사',
}
const typeColors: Record<string, string> = {
  traffic_incident: 'bg-danger', traffic_congestion: 'bg-secondary', road_construction: 'bg-warning text-dark', building_permit: 'bg-info',
}

export default function ConstructionPage() {
  const { user } = useAuth()
  const role = (user as any)?.role
  const [searchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'heritage')
  const [notices, setNotices] = useState<ConstructionNotice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [heritage, setHeritage] = useState<HeritageItem[]>([])
  const [heritageLoading, setHeritageLoading] = useState(false)

  const [scenery, setScenery] = useState<SceneryItem[]>([])
  const [stores, setStores] = useState<StoreGroup[]>([])
  const [trafficHtml, setTrafficHtml] = useState('')
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [sceneryVillage, setSceneryVillage] = useState('')
  const [sceneryTown, setSceneryTown] = useState('')
  const [scenerySeason, setScenerySeason] = useState('')
  const [scenerySubTab, setScenerySubTab] = useState(() => searchParams.get('sub') || 'scenery')
  const [sceneryLoading, setSceneryLoading] = useState(false)
  const [storesLoading, setStoresLoading] = useState(false)
  const [trafficLoading, setTrafficLoading] = useState(false)
  const [alertsLoading, setAlertsLoading] = useState(false)

  const [homeLat, setHomeLat] = useState(0)
  const [homeLng, setHomeLng] = useState(0)

  const [transitSuggestion, setTransitSuggestion] = useState<any>(null)
  const [transitLoading, setTransitLoading] = useState(false)
  const [transitError, setTransitError] = useState('')
  const [corrAddress, setCorrAddress] = useState('')
  const [corrLoading, setCorrLoading] = useState(false)

  const [heritageStampLoading, setHeritageStampLoading] = useState<Record<string, boolean>>({})
  const [heritageLat, setHeritageLat] = useState(0)
  const [heritageLng, setHeritageLng] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await constructionApi.notices()
      setNotices(data?.notices || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (activeTab !== 'heritage') return
    setHeritageLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        setHeritageLat(pos.coords.latitude)
        setHeritageLng(pos.coords.longitude)
        fetch(`/construction/heritage?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`)
          .then(r => r.json())
          .then(d => setHeritage(Array.isArray(d) ? d : []))
          .catch(() => setHeritage([]))
          .finally(() => setHeritageLoading(false))
      },
      () => { setHeritageLoading(false); setHeritage([]) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'scenery') return
    setSceneryLoading(true)
    fetch('/construction/local-scenery')
      .then(r => r.json())
      .then(d => {
        setScenery(d.sceneries || [])
        setSceneryVillage(d.village || '')
        setSceneryTown(d.town || '')
        setScenerySeason(d.season || '')
      })
      .catch(() => {})
      .finally(() => setSceneryLoading(false))
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'scenery' || scenerySubTab !== 'localstore') return
    setStoresLoading(true)
    fetch('/construction/local-stores')
      .then(r => r.json())
      .then(d => setStores(d.stores || []))
      .catch(() => {})
      .finally(() => setStoresLoading(false))
  }, [activeTab, scenerySubTab])

  useEffect(() => {
    if (activeTab !== 'scenery' || scenerySubTab !== 'traffic') return
    setTrafficLoading(true)
    fetch('/construction/traffic/gg')
      .then(r => r.json())
      .then(d => {
        if (!d.available || !d.incidents || d.incidents.length === 0) {
          setTrafficHtml('<div class="text-muted text-center py-2 small">현재 양평군 교통 이슈가 없습니다.</div>')
          return
        }
        let html = `<div class="small mb-1 text-muted">🕐 UTIC 실시간 (${d.yangpyeong}건)</div>`
        d.incidents.forEach((i: any) => {
          html += `<div class="card mb-2 border-start border-3 border-danger"><div class="card-body p-2 small">`
          html += `<span class="badge bg-danger me-1">${i.type}</span><strong>${i.title}</strong>`
          if (i.road) html += `<br><small>🛣️ ${i.road}</small>`
          if (i.start) html += `<br><small>🕐 ${i.start}</small>`
          html += `</div></div>`
        })
        setTrafficHtml(html)
      })
      .catch(() => setTrafficHtml('<div class="text-danger">불러오기 실패</div>'))
      .finally(() => setTrafficLoading(false))
  }, [activeTab, scenerySubTab])

  useEffect(() => {
    if (activeTab !== 'scenery' || scenerySubTab !== 'alert') return
    setAlertsLoading(true)
    fetch('/api/construction/alerts')
      .then(r => r.json())
      .then(d => setAlerts(Array.isArray(d) ? d : d?.alerts || []))
      .catch(() => {})
      .finally(() => setAlertsLoading(false))
  }, [activeTab, scenerySubTab])

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      pos => { setHomeLat(pos.coords.latitude); setHomeLng(pos.coords.longitude) },
      () => {},
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [])

  useEffect(() => {
    if (activeTab !== 'home') return
    setTransitLoading(true)
    setTransitError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        fetch(`/construction/transit/suggest?from_lat=${lat}&from_lng=${lng}`)
          .then(r => r.json())
          .then(d => {
            if (d.error) { setTransitError(d.error); return }
            setTransitSuggestion(d)
          })
          .catch(() => setTransitError('위치 정보를 불러올 수 없습니다.'))
          .finally(() => setTransitLoading(false))
      },
      () => { setTransitLoading(false); setTransitError('GPS 위치를 가져올 수 없습니다.') },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }, [activeTab])

  const handleStamp = async (name: string) => {
    setHeritageStampLoading(prev => ({ ...prev, [name]: true }))
    try {
      await fetch('/construction/heritage/stamp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, lat: homeLat, lng: homeLng }),
      })
      setHeritage(prev => prev.map(h => h.name === name ? { ...h, stamped: true } : h))
    } catch {}
    setHeritageStampLoading(prev => ({ ...prev, [name]: false }))
  }

  const handleCorrection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!corrAddress.trim()) return
    setCorrLoading(true)
    try {
      const res = await fetch('/user/location/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manual_loc: corrAddress, gps_lat: homeLat, gps_lng: homeLng }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        alert(data.msg || '위치가 보정되었습니다.')
        setCorrAddress('')
        setTransitLoading(true)
        setTransitError('')
        navigator.geolocation.getCurrentPosition(
          pos => {
            fetch(`/construction/transit/suggest?from_lat=${pos.coords.latitude}&from_lng=${pos.coords.longitude}`)
              .then(r => r.json())
              .then(d => { if (!d.error) setTransitSuggestion(d) })
              .finally(() => setTransitLoading(false))
          },
          () => setTransitLoading(false),
          { enableHighAccuracy: true, timeout: 10000 }
        )
      } else {
        alert(data.msg || '보정 실패')
      }
    } catch { alert('오류 발생') }
    setCorrLoading(false)
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  const tabs = [
    { key: 'heritage', label: '🏛️ 국가유산' },
    { key: 'scenery', label: '🌄 ' + (sceneryVillage || '풍경') },
    { key: 'home', label: '🏠 집으로' },
    { key: 'building', label: '🏗️ 건축공사' },
  ]

  return (
    <div className="container">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold mb-0">📍 위치기반 안내</h3>
        {role === 'admin' || role === 'leader' ? (
          <a href="/construction/refresh" className="btn btn-sm btn-outline-primary" onClick={e => { if (!confirm('API에서 최신 정보를 가져옵니다.')) e.preventDefault() }}>🔄 정보갱신</a>
        ) : null}
      </div>

      <ul className="nav nav-tabs mb-4">
        {tabs.map(t => (
          <li key={t.key} className="nav-item">
            <button className={`nav-link ${activeTab === t.key ? 'active' : ''}`} onClick={() => setActiveTab(t.key)}>{t.label}</button>
          </li>
        ))}
      </ul>

      {/* Heritage Tab */}
      {activeTab === 'heritage' && (
        <div>
          {heritageLoading ? (
            <div className="text-center py-5 text-muted"><Loading /></div>
          ) : heritage.length === 0 ? (
            <EmptyState icon="🏛️" title="주변 국가유산이 없습니다." />
          ) : (
            <div className="row g-2">
              {heritage.map(h => (
                <div key={h.name} className="col-6 col-md-4 col-lg-3 p-2">
                  <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
                    <div className="card-body p-3">
                      <div className="d-flex align-items-center gap-2 mb-2">
                        <span className="badge bg-success small">{h.type || h.category}</span>
                        <span className="fw-bold flex-grow-1 small">{(h.stamped ? '⭐ ' : '') + h.name}</span>
                        {h.dist != null && <small className="text-muted flex-shrink-0">{h.dist}km</small>}
                      </div>
                      {h.description && <p className="small text-muted mb-2">{h.description}</p>}
                      <div className="d-flex gap-1 flex-wrap mb-2">
                        <a href={`https://ko.wikipedia.org/w/index.php?search=${encodeURIComponent(h.name)}`} target="_blank" className="btn btn-sm btn-outline-secondary" rel="noopener noreferrer">📖 위키백과</a>
                        <a href={`https://search.naver.com/search.naver?query=${encodeURIComponent(h.name + ' 문화재')}`} target="_blank" className="btn btn-sm btn-outline-success" rel="noopener noreferrer">🔍 자세히보기</a>
                        <div className="btn-group">
                          <a href={`/compass?popup=1&lat=${h.lat}&lng=${h.lng}&name=${encodeURIComponent(h.name || '국가유산')}`} className="btn btn-sm btn-outline-primary">🧭 나침반</a>
                          {h.stamped ? (
                            <span className="btn btn-sm btn-warning disabled">✅ 방문완료</span>
                          ) : (
                            <button className="btn btn-sm btn-outline-danger" onClick={() => handleStamp(h.name)} disabled={heritageStampLoading[h.name]}>
                              {heritageStampLoading[h.name] ? '...' : '🔖 스탬프'}
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="d-flex gap-1 flex-wrap">
                        <a href={`https://www.google.com/maps/dir/?api=1&origin=${heritageLat},${heritageLng}&destination=${h.lat},${h.lng}`} target="_blank" className="btn btn-sm btn-outline-secondary" rel="noopener noreferrer">Google</a>
                        <a href={`https://map.kakao.com/link/to/${encodeURIComponent(h.name)},${h.lat},${h.lng}`} target="_blank" className="btn btn-sm btn-outline-warning" rel="noopener noreferrer">카카오</a>
                        <a href={`https://map.naver.com/index.nhn?slat=${heritageLat}&slng=${heritageLng}&elat=${h.lat}&elng=${h.lng}&etitle=${encodeURIComponent(h.name)}`} target="_blank" className="btn btn-sm btn-outline-success" rel="noopener noreferrer">네이버</a>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Scenery Tab */}
      {activeTab === 'scenery' && (
        <div>
          <div className="mb-3 d-flex gap-2 flex-wrap">
            {[
              { key: 'scenery', label: '🌄 풍경' },
              { key: 'localstore', label: '🏪 가게' },
              { key: 'traffic', label: '🚗 교통' },
              { key: 'facility', label: '편의시설' },
              { key: 'alert', label: '🚨 알림' },
            ].map(st => (
              <button key={st.key} className={`btn btn-sm ${scenerySubTab === st.key ? 'btn-secondary' : 'btn-outline-secondary'}`} onClick={() => setScenerySubTab(st.key)}>{st.label}</button>
            ))}
          </div>

          {scenerySubTab === 'scenery' && (
            sceneryLoading ? <Loading /> : scenery.length === 0 ? (
              <EmptyState icon="🌄" title={`${sceneryTown} ${sceneryVillage}의 풍경이 없습니다.`} />
            ) : (
              <>
                <p className="text-muted small mb-3">{sceneryTown} {sceneryVillage} · {scenerySeason} season</p>
                <div className="row g-3">
                  {scenery.map(s => (
                    <div key={s.id} className="col-6 col-md-4">
                      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
                        <a href={s.image_path} target="_blank" rel="noopener noreferrer">
                          <img src={s.image_path} className="card-img-top" style={{ height: 160, objectFit: 'cover', borderRadius: '16px 16px 0 0' }} alt={s.title} />
                        </a>
                        <div className="card-body p-2">
                          <small className="fw-bold">{s.title}</small>
                          {s.description && <p className="small text-muted mb-0">{s.description}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          )}

          {scenerySubTab === 'localstore' && (
            storesLoading ? <Loading /> : stores.length === 0 ? (
              <EmptyState icon="🏪" title="등록된 가게가 없습니다." />
            ) : (
              <div className="row g-2">
                {stores.map((g, i) => (
                  <div key={i} className="col-6">
                    <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
                      {g.image ? (
                        <img src={g.image} className="card-img-top" style={{ height: 120, objectFit: 'cover', borderRadius: '16px 16px 0 0' }} alt={g.name} />
                      ) : (
                        <div className="d-flex align-items-center justify-content-center" style={{ height: 120, background: '#f0f0f0', borderRadius: '16px 16px 0 0' }}>🏪</div>
                      )}
                      <div className="card-body p-2">
                        <small className="fw-bold d-block">{g.name}</small>
                        {g.store_link && <a href={g.store_link} target="_blank" className="small" rel="noopener noreferrer">{g.link_label || '🔗'}</a>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {scenerySubTab === 'traffic' && (
            trafficLoading ? <Loading /> : <div dangerouslySetInnerHTML={{ __html: trafficHtml }} />
          )}

          {scenerySubTab === 'facility' && (
            <FacilityMap type="toilet" />
          )}

          {scenerySubTab === 'alert' && (
            alertsLoading ? <Loading /> : alerts.length === 0 ? (
              <EmptyState icon="🚨" title="현재 마을에 긴급 알림이 없습니다." />
            ) : (
              <div className="row g-3">
                {alerts.map(a => (
                  <div key={a.id} className="col-12">
                    <div className={`card border-0 shadow-sm ${a.urgency === 'urgent' ? 'border-start border-4 border-danger' : a.urgency === 'important' ? 'border-start border-4 border-warning' : ''}`} style={{ borderRadius: 16 }}>
                      <div className="card-body p-3">
                        <div className="d-flex justify-content-between">
                          <h6 className="fw-bold mb-2">{a.urgency === 'urgent' ? '🔴' : a.urgency === 'important' ? '🟡' : '🔵'} {a.title}</h6>
                          <span className={`badge ${a.alert_type === 'missing' ? 'bg-danger' : a.alert_type === 'disaster' ? 'bg-dark' : a.alert_type === 'safety' ? 'bg-warning text-dark' : 'bg-info'}`}>{a.alert_type}</span>
                        </div>
                        {a.content && <p className="small text-muted mb-2">{a.content}</p>}
                        <div className="small text-muted d-flex gap-3">
                          <span>📍 {a.town} {a.village}</span>
                          <span>👤 {a.author_name || '-'}</span>
                          <span>📅 {a.created_at ? formatKST(a.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* Home Tab */}
      {activeTab === 'home' && (
        <div>
          {transitLoading ? (
            <div className="text-center py-5"><Loading /><p className="text-muted small mt-2">귀가 경로를 분석하고 있습니다...</p></div>
          ) : transitError ? (
            <div className="card border-0 shadow-sm p-4" style={{ borderRadius: 16 }}>
              <div className="text-center">
                <p className="text-danger mb-2">⚠️ {transitError}</p>
                <button className="btn btn-outline-secondary btn-sm" onClick={() => setActiveTab('home')}>🔄 다시 시도</button>
              </div>
            </div>
          ) : transitSuggestion?.already_home ? (
            <div className="card border-0 shadow-sm p-4 text-center" style={{ borderRadius: 16 }}>
              <h4 className="mb-2">🏠</h4>
              <h5 className="fw-bold">이미 집 근처입니다!</h5>
              <p className="text-muted small">{transitSuggestion.home_address}</p>
              {transitSuggestion.current_address && <p className="text-muted small">📍 {transitSuggestion.current_address}</p>}
            </div>
          ) : transitSuggestion ? (
            <div>
              <div className="card border-0 shadow-sm mb-3 p-4" style={{ borderRadius: 16, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white' }}>
                <div className="text-center">
                  <p className="mb-1 small opacity-75">⏰ 이 시간까지 출발하세요</p>
                  <h1 className="fw-bold mb-1" style={{ fontSize: '2.5rem' }}>{transitSuggestion.optimal_departure}</h1>
                  <p className="small opacity-75 mb-0">{transitSuggestion.time_to_station_min}분 후 도착 (막차 {transitSuggestion.last_transit_from_station} 출발)</p>
                </div>
              </div>

              <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
                <div className="card-body p-3">
                  <div className="d-flex align-items-center gap-2 mb-2">
                    <span className="badge bg-primary">{transitSuggestion.mode}</span>
                    <span className="fw-bold">{transitSuggestion.line}</span>
                  </div>
                  <div className="small text-muted mb-2">
                    <div>🚉 {transitSuggestion.transfer_station} ({transitSuggestion.direction})</div>
                    <div>📏 역까지 {transitSuggestion.distance_to_station_km}km · 도보 약 {transitSuggestion.time_to_station_min}분</div>
                    <div>🕐 막차 {transitSuggestion.last_transit_from_station} 출발</div>
                    {transitSuggestion.home_distance_km != null && <div>🏠 역에서 집까지 약 {transitSuggestion.home_distance_km}km</div>}
                  </div>
                  {transitSuggestion.deep_links && (
                    <div className="d-flex gap-2">
                      <a href={transitSuggestion.deep_links.kakao} target="_blank" className="btn btn-sm btn-warning" rel="noopener noreferrer">카카오맵</a>
                      <a href={transitSuggestion.deep_links.naver} target="_blank" className="btn btn-sm btn-success" rel="noopener noreferrer">네이버맵</a>
                    </div>
                  )}
                </div>
              </div>

              <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
                <div className="card-body p-3">
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <small className="text-muted">🏠 집</small>
                    <small className="fw-bold">{transitSuggestion.home_address || `${transitSuggestion.home_town} ${transitSuggestion.home_village}`}</small>
                  </div>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <small className="text-muted">📍 현재 위치</small>
                    <small className="fw-bold">{transitSuggestion.current_address || 'GPS 수신 중'}</small>
                  </div>
                  <form onSubmit={handleCorrection} className="border-top pt-3">
                    <label className="form-label small fw-bold text-muted">📍 현재 위치가 틀렸나요? 직접 입력 후 보정하세요 (1닢 지급)</label>
                    <div className="d-flex gap-2">
                      <input type="text" className="form-control form-control-sm" placeholder="예: 양수리 935" value={corrAddress} onChange={e => setCorrAddress(e.target.value)} required />
                      <button type="submit" className="btn btn-sm btn-outline-primary" disabled={corrLoading}>{corrLoading ? '...' : '보정'}</button>
                    </div>
                  </form>
                </div>
              </div>

              {transitSuggestion.all_options && transitSuggestion.all_options.length > 1 && (
                <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
                  <div className="card-body p-3">
                    <h6 className="fw-bold mb-2">📋 다른 교통수단</h6>
                    {transitSuggestion.all_options.map((opt: any, i: number) => (
                      <div key={i} className={`d-flex justify-content-between align-items-center p-2 rounded mb-1 ${i === 0 ? 'bg-primary bg-opacity-10' : ''}`}>
                        <div>
                          <span className="badge bg-secondary me-1">{opt.mode}</span>
                          <small className="fw-bold">{opt.transfer_station}</small>
                        </div>
                        <small className="fw-bold text-primary">{opt.optimal_departure} 출발</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-5 text-muted">
              <p>위치를 가져오는 중...</p>
            </div>
          )}
        </div>
      )}

      {/* Building Tab */}
      {activeTab === 'building' && (
        <div>
          {notices.length === 0 ? (
            <EmptyState icon="📡" title="현재 등록된 정보가 없습니다." />
          ) : (
            <div className="row g-3">
              {notices.map(n => (
                <div key={n.id} className="col-12">
                  <div className="card border-0 shadow-sm" style={{ borderRadius: 16, borderLeft: n.notice_type === 'traffic_incident' ? '4px solid #dc3545' : undefined }}>
                    <div className="card-body p-3">
                      <div className="d-flex justify-content-between">
                        <h6 className="fw-bold mb-2">{n.title}</h6>
                        <span className={`badge ${typeColors[n.notice_type as string] || 'bg-info'}`}>
                          {typeLabels[n.notice_type as string] || n.notice_type}
                        </span>
                      </div>
                      {n.description && <p className="small text-muted mb-2">{n.description}</p>}
                      <div className="d-flex gap-3 flex-wrap small text-muted">
                        {n.location && <span>📍 {n.location}</span>}
                        {n.start_date && <span>📅 시작: {formatKST(n.start_date, { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>}
                        {n.end_date && <span>➡ 종료: {formatKST(n.end_date, { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>}
                        {n.source && <span>🔗 {{ gg_traffic: '경기교통정보', cals: '건설CALS', yp_gov: '양평군청' }[n.source] || n.source}</span>}
                      </div>
                      {n.latitude && n.longitude && (
                        <a href={`https://maps.google.com/?q=${n.latitude},${n.longitude}`} target="_blank" className="btn btn-sm btn-outline-secondary mt-2" rel="noopener noreferrer">🗺️ 지도보기</a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
