import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AuthorName from '../components/AuthorName'

interface ShareItem {
  id: number | string; title: string; description: string
  image_path: string | null; extra_images: string
  drawing_path: string | null
  video_path?: string | null
  latitude: number; longitude: number
  town: string; village: string; address?: string
  ai_category: string; ai_summary: string
  ai_region_news: string; ai_news_links: string
  like_count: number; dislike_count: number
  author_name: string; user_id: number
  author_email?: string
  status: string; created_at: string
  auto_sent?: boolean
  yard_event_id?: number | null
  db_id?: number
  event_date_display?: string
  repeat_text?: string
  distance_km?: number
  source?: 'share' | 'yard'
  kind_badge?: string
}

function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default function ShareList() {
  const [items, setItems] = useState<ShareItem[]>([])
  const [towns, setTowns] = useState<string[]>([])
  const [town, setTown] = useState('')
  const [village, setVillage] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [nearbyOpen, setNearbyOpen] = useState(false)
  const [nearbyItems, setNearbyItems] = useState<any[]>([])
  const [nearbyLoading, setNearbyLoading] = useState(false)
  const [userLoc, setUserLoc] = useState<{ lat: number; lon: number } | null>(null)
  const [searchParams] = useSearchParams()
  const yardEventFilter = searchParams.get('yard_event')
  const [myId, setMyId] = useState<number | null>(null)
  const categories = ['사건', '풍경', '장소', '맛집', '기타']

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => setUserLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
    fetch('/api/me').then(r => r.json()).then(d => { if (d.id) setMyId(d.id) }).catch(() => {})
  }, [])

  useEffect(() => {
    const params = new URLSearchParams()
    if (town) params.set('town', town)
    if (village) params.set('village', village)
    if (category) params.set('category', category)
    const qs = params.toString()
    const reviewQs = yardEventFilter ? `?yard_event=${yardEventFilter}` : ''
    const sources = yardEventFilter
      ? [Promise.resolve([]), Promise.resolve({ items: [] }), fetch(`/api/yard/reviews${reviewQs}`).then(r => r.json()).catch(() => ({ items: [] }))]
      : [
          fetch(`/api/share/reports${qs ? '?' + qs : ''}`).then(r => r.json()).catch(() => []),
          fetch('/api/yard').then(r => r.json()).catch(() => ({ items: [] })),
          fetch('/api/yard/reviews').then(r => r.json()).catch(() => ({ items: [] })),
        ]
    Promise.all(sources)
      .then(([shareData, yardData, reviewData]) => {
        const shareItems: ShareItem[] = (Array.isArray(shareData) ? shareData : []).map((r: any) => ({
          ...r, source: 'share' as const, kind_badge: '공유',
        }))
        // 마당 행사 후기(노트) - 행사 위치 좌표로 배치 (사진 위주)
        const reviewItems: ShareItem[] = (reviewData.items || []).map((n: any) => ({
          id: n.id, db_id: n.db_id, title: n.title, description: n.content || '',
          image_path: n.image_path || null, extra_images: '', drawing_path: null,
          latitude: n.latitude ?? 0, longitude: n.longitude ?? 0,
          town: '', village: '', address: n.address || '',
          ai_category: '행사후기', ai_summary: n.content || '',
          ai_region_news: '', ai_news_links: '',
          like_count: 0, dislike_count: 0,
          author_name: n.author_name || '익명', user_id: 0,
          status: 'approved', created_at: n.created_at || '',
          source: 'yard' as const, kind_badge: '⭐ 행사후기',
          yard_event_id: n.yard_event_id,
        }))
        // 마당 승인 소식(행사·공지) 병합 - 배지로 구분
        const yardItems: ShareItem[] = (yardData.items || []).map((y: any) => ({
          id: y.id, db_id: y.db_id, title: y.title, description: y.content || '',
          image_path: null, extra_images: '', drawing_path: null,
          latitude: y.latitude ?? 0, longitude: y.longitude ?? 0,
          town: '', village: '', address: y.event_place || '',
          ai_category: y.kind === 'event' ? '행사' : '소식', ai_summary: y.content || '',
          ai_region_news: '', ai_news_links: '',
          like_count: 0, dislike_count: 0,
          author_name: y.author_name || '관리자', user_id: 0,
          status: 'approved', created_at: y.created_at || '',
          source: 'yard' as const, kind_badge: y.kind === 'event' ? '행사' : '마당소식',
          event_date_display: y.event_date_display || '',
          repeat_text: y.repeat_text || '',
        }))
        let merged: ShareItem[] = [...shareItems, ...yardItems, ...reviewItems]
        if (userLoc) {
          merged = merged.map((m: ShareItem) => ({
            ...m,
            distance_km: m.latitude ? Number(haversine(userLoc.lat, userLoc.lon, Number(m.latitude), Number(m.longitude)).toFixed(1)) : undefined,
          }))
          merged.sort((a: ShareItem, b: ShareItem) => (a.distance_km ?? 9999) - (b.distance_km ?? 9999))
        }
        setItems(merged)
        const t = [...new Set(shareItems.map((r: ShareItem) => r.town).filter(Boolean))] as string[]
        setTowns(t)
      })
      .finally(() => setLoading(false))
  }, [town, village, category, userLoc])

  const villages = town
    ? [...new Set(items.filter(r => r.town === town).map(r => r.village).filter(Boolean))] as string[]
    : []

  const resetFilter = () => { setTown(''); setVillage(''); setCategory('') }

  const vote = (id: number, type: 'like' | 'dislike') => {
    if (!confirm(type === 'like' ? '좋아요 하시겠습니까?' : '나빠요 하시겠습니까?')) return
    fetch(`/share-report/${type}/${id}`, { method: 'POST' })
      .then(r => r.json()).then(d => {
        if (d.status === 'success') {
          setItems(prev => prev.map(item =>
            item.id === id ? { ...item, [type === 'like' ? 'like_count' : 'dislike_count']: item[type === 'like' ? 'like_count' : 'dislike_count'] + 1 } : item
          ))
          if (d.cost) {
            alert(`${type === 'like' ? '좋아요' : '별로예요'} 완료! (${d.cost} Xml 차감)`)
          }
        } else alert(d.msg || '오류')
      }).catch(e => alert('오류: ' + e))
  }

  const loadNearby = () => {
    if (!navigator.geolocation) return alert('GPS를 지원하지 않습니다')
    setNearbyLoading(true)
    navigator.geolocation.getCurrentPosition(pos => {
      fetch(`/share/nearby?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&max_km=20`)
        .then(r => r.json()).then(d => {
          setNearbyItems(d.items || [])
          setNearbyOpen(true)
        }).finally(() => setNearbyLoading(false))
    }, () => { alert('GPS 권한 필요'); setNearbyLoading(false) }, { enableHighAccuracy: true, timeout: 10000 })
  }

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">📍 양평 공유마당</h3>

      <div className="alert alert-success small mb-4">
        <strong>📸 사진과 🎨 그리기로 양평을 공유하세요!</strong> 사건·사고뿐만 아니라 우리 동네의 <strong>아름다운 풍경, 추천 장소, 맛집, 숨은 명소</strong> 모두 환영합니다.
        최신순으로 표시되며, 여러분의 공유가 소상공인과 이웃들에게 도움이 됩니다.
      </div>

      <div className="text-center mb-4">
        <a href="/share/report" className="btn btn-success btn-lg px-5 py-3 fw-bold shadow" style={{borderRadius:16}}>
          📸 사진/그림으로 공유하기
        </a>
        <a href="/share/map" className="btn btn-outline-primary btn-lg px-4 py-3 fw-bold shadow ms-2" style={{borderRadius:16}}>
          🗺️ 지도로 보기
        </a>
      </div>

      <div className="d-flex gap-2 mb-3">
        <button className="btn btn-outline-primary btn-sm" onClick={loadNearby} disabled={nearbyLoading}>
          📍 {nearbyLoading ? '불러오는 중...' : '내 주변 보기'}
        </button>
        {userLoc ? (
          <span className="small text-muted align-self-center">📍 현재 위치 기준 가까운 순</span>
        ) : (
          <span className="small text-muted align-self-center">⏳ 위치 수집 중...</span>
        )}
      </div>

      {nearbyOpen && (
        <div className="mb-4">
          <div className="card border-0 shadow-sm p-3" style={{borderRadius:16}}>
            <h6 className="fw-bold mb-3">📍 내 주변 공유 (20km 이내)</h6>
            {nearbyItems.length > 0 ? (
              <div className="row g-2">
                {nearbyItems.map((item: any) => (
                  <div key={item.id} className="col-6 col-md-4 col-lg-3 p-2" style={{cursor:'pointer',borderRadius:12}}
                    onClick={() => window.location.href = (item.source === 'yard' ? '/yard/' + String(item.id).slice(1) : '/share/detail/' + item.id)}>
                    <div className="d-flex gap-2 align-items-start">
                      {item.image ? <img src={item.image} style={{width:50,height:50,objectFit:'cover',borderRadius:8}} />
                        : <div style={{width:50,height:50,background:'#eee',borderRadius:8}} />}
                      <div className="small">
                        <strong>{item.title}</strong><br />
                        <span className="text-muted">{item.category} · {item.town} {item.village}</span><br />
                        <span className="text-primary">📍 {item.distance}km</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-muted small py-3 text-center">
                내 주변 20km 이내에 공유가 없습니다. 첫 공유자가 되어보세요!
              </div>
            )}
            <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setNearbyOpen(false)}>접기</button>
          </div>
        </div>
      )}

      <div className="card border-0 shadow-sm mb-4 p-3" style={{borderRadius:16}}>
        <div className="row g-2">
          <div className="col-md-3">
            <select className="form-select" value={town} onChange={e => { setTown(e.target.value); setVillage('') }}>
              <option value="">전체 읍/면</option>
              {towns.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={village} onChange={e => setVillage(e.target.value)}>
              <option value="">전체 리</option>
              {villages.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={category} onChange={e => setCategory(e.target.value)}>
              <option value="">전체 분류</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-md-3 text-end">
            <button className="btn btn-outline-secondary" onClick={resetFilter}>초기화</button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted"><div className="spinner-border" /></div>
      ) : items.length > 0 ? (
        <div className="row g-3 flex-nowrap flex-sm-wrap" style={{ overflowX: 'auto', paddingBottom: 4 }}>
          {items.map(r => {
            const dist = userLoc && r.latitude ? haversine(userLoc.lat, userLoc.lon, Number(r.latitude), Number(r.longitude)) : null
            const rid = typeof r.id === 'number' ? r.id : null
            return (
            <div key={r.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
              <div className="card border-0 shadow-sm h-100" style={{borderRadius:16,overflow:'hidden'}}>
                {(() => {
                  const extraImgs = r.extra_images ? r.extra_images.split(',').filter(Boolean) : []
                  const allImgs = [r.image_path, ...extraImgs].filter(Boolean) as string[]
                  const showDraw = r.drawing_path && allImgs.length === 0
                  return (
                    <>
                      {allImgs.length > 0 ? (
                        <img src={allImgs[0]} className="card-img-top" />
                      ) : r.drawing_path ? (
                        <img src={r.drawing_path} className="card-img-top" />
                      ) : (
                        <div className="bg-light d-flex align-items-center justify-content-center" style={{height:160}}>
                          <span className="text-muted">이미지 없음</span>
                        </div>
                      )}
                      {allImgs.length > 1 && (
                        <div className="d-flex gap-1 px-2 pt-1 pb-2 bg-white" style={{overflow:'auto'}}>
                          {allImgs.slice(0, 5).map((img, i) => (
                            <img key={i} src={img} style={{width:50,height:50,objectFit:'contain',borderRadius:6,border:'1px solid #eee',flexShrink:0,backgroundColor:'#f8f9fa'}} />
                          ))}
                          {allImgs.length > 5 && <span className="small text-muted align-self-center">+{allImgs.length-5}</span>}
                          {r.drawing_path && <img src={r.drawing_path} style={{width:50,height:50,objectFit:'contain',borderRadius:6,border:'1px solid #dee2fc',flexShrink:0,backgroundColor:'#f8f9fa'}} title="그리기" />}
                        </div>
                      )}
                      {allImgs.length <= 1 && r.drawing_path && !showDraw && (
                        <div className="px-2 pb-2 bg-white">
                          <img src={r.drawing_path} style={{width:50,height:50,objectFit:'contain',borderRadius:6,border:'1px solid #dee2fc',backgroundColor:'#f8f9fa'}} title="그리기" />
                        </div>
                      )}
                    </>
                  )
                })()}
                <div className="card-body p-3 d-flex flex-column">
                  <div className="d-flex gap-1 flex-wrap mb-2">
                    <span className={`badge ${r.source === 'yard' ? 'bg-success' : 'bg-info'}`}>{r.kind_badge}</span>
                    <span className="badge bg-light text-dark">{r.ai_category}</span>
                    <span className="badge bg-light text-dark">{r.address || `${r.town} ${r.village}`}</span>
                    {r.status !== 'approved' && myId === r.user_id && (
                      <span className="badge bg-danger">{r.status === 'pending_person' ? '보류(인물)' : r.status === 'flagged' ? '차단됨' : r.status === 'draft' ? '자동보관' : '승인대기'}</span>
                    )}
                    {(r.auto_sent && myId === r.user_id) && (
                      <span className="badge bg-warning text-dark">자동발송·확인필요</span>
                    )}
                  </div>
                  <h6 className="fw-bold mb-2">{r.title}</h6>
                  <p className="small text-muted flex-grow-1 mb-2">
                    {(r.ai_summary || r.description || '').substring(0, 120)}
                  </p>

                  {r.ai_region_news && r.ai_region_news !== '관련 뉴스 없음' && (
                    <div className="mb-2 p-2 bg-light rounded small border-start border-5 border-info">
                      <strong>📰 관련 지역 소식:</strong><br />
                      {r.ai_region_news.substring(0, 150)}
                    </div>
                  )}

                  <div className="d-flex justify-content-between align-items-center pt-2 border-top">
                    <small className="text-muted">
                      📍 {r.address || `${r.town} ${r.village}`}
                      {dist !== null && typeof dist === 'number' && (
                        <span className="text-primary ms-1 fw-bold">{dist.toFixed(1)}km</span>
                      )}
                      {r.latitude && r.longitude && (
                        <a href={`https://maps.google.com/?q=${r.latitude},${r.longitude}`} target="_blank" className="text-decoration-none ms-1">(지도)</a>
                      )}
                    </small>
                    <div className="d-flex gap-1">
                      {rid !== null && (
                        <>
                          <button onClick={() => vote(rid, 'like')} className="btn btn-sm btn-outline-success">👍 {r.like_count}</button>
                          <button onClick={() => vote(rid, 'dislike')} className="btn btn-sm btn-outline-danger">👎 {r.dislike_count}</button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="d-flex justify-content-between align-items-center mt-2">
                    <a href={r.source === 'yard' ? `/yard/${r.db_id ?? String(r.id).slice(1)}` : `/share/detail/${r.id}`} className="text-decoration-none small text-primary">자세히 보기 →</a>
                  </div>

                  <div className="small text-muted mt-1 pt-2 border-top border-light" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <AuthorName name={r.author_name} email={r.author_email} userId={r.user_id} prefix="👤 " />
                  </div>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-5 text-muted">
          <div className="fs-1 mb-3">📍</div>
          <p>아직 공유된 내용이 없습니다. 첫 공유의 주인공이 되어보세요!</p>
        </div>
      )}
    </div>
  )
}
