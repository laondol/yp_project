import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api'
import type { VillagePlaceData, VillagePlaceCategoryData } from '../components/VillageMapView'
import VillageMapView from '../components/VillageMapView'

const COLORS = ['#0d6efd', '#dc3545', '#198754', '#fd7e14', '#6f42c1', '#0dcaf0', '#e74c3c', '#2ecc71', '#f39c12', '#8e44ad']
const ICONS = ['📍', '🏛️', '🏥', '🏪', '🍽️', '⛰️', '🏫', '⛪', '🏞️', '🚏', '📚', '🛒', '💊', '🏬', '🌳', '🎣', '🏓', '🕍']

export default function VillageMapAdminPage() {
  const [scopes, setScopes] = useState<{ myeon: string; ri: string }[]>([])
  const [activeScope, setActiveScope] = useState<{ myeon: string; ri: string } | null>(null)
  const [categories, setCategories] = useState<VillagePlaceCategoryData[]>([])
  const [pending, setPending] = useState<VillagePlaceData[]>([])
  const [allPlaces, setAllPlaces] = useState<VillagePlaceData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // 카테고리 폼
  const [catName, setCatName] = useState('')
  const [catIcon, setCatIcon] = useState('📍')
  const [catColor, setCatColor] = useState(COLORS[0])

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const loadScopes = useCallback(async () => {
    try {
      const me = await api.get<{ managed_pages?: string[] }>('/api/me')
      const scopes: { myeon: string; ri: string }[] = []
      for (const p of (me.managed_pages || [])) {
        if (p.startsWith('vi_')) {
          const parts = p.slice(3).split('_')
          if (parts.length >= 2) scopes.push({ myeon: parts[0], ri: parts[1] })
        }
      }
      setScopes(scopes)
      setActiveScope(scopes[0] || null)
    } catch {
      setError('담당 마을 정보를 불러오지 못했습니다.')
    }
  }, [])

  const loadAll = useCallback(async () => {
    if (!activeScope) return
    setLoading(true)
    try {
      const [catD, pendD, allD] = await Promise.all([
        api.get<{ categories: VillagePlaceCategoryData[] }>('/api/village/map/categories', { myeon: activeScope.myeon, ri: activeScope.ri }),
        api.get<{ pending: VillagePlaceData[] }>('/api/village/map/pending'),
        api.get<{ places: VillagePlaceData[] }>('/api/village/map/places', { approved: 0 }),
      ])
      setCategories(catD.categories || [])
      setPending(pendD.pending || [])
      setAllPlaces(allD.places || [])
    } catch (e: any) {
      setError(e.message || '데이터 로딩 실패')
    } finally {
      setLoading(false)
    }
  }, [activeScope])

  useEffect(() => { loadScopes() }, [loadScopes])
  useEffect(() => { loadAll() }, [loadAll])

  const handleAddCategory = async () => {
    if (!activeScope || !catName.trim()) return
    try {
      await api.post('/api/village/map/categories', {
        myeon: activeScope.myeon, ri: activeScope.ri, name: catName.trim(),
        icon: catIcon, color: catColor, sort_order: categories.length,
      })
      setCatName('')
      flash('카테고리가 추가되었습니다.')
      loadAll()
    } catch (e: any) { alert(e.message) }
  }

  const handleDeleteCategory = async (cid: number) => {
    if (!confirm('카테고리를 삭제할까요? 해당 카테고리 장소들은 미분류로 바뀝니다.')) return
    try {
      await api.delete(`/api/village/map/categories/${cid}`)
      flash('카테고리가 삭제되었습니다.')
      loadAll()
    } catch (e: any) { alert(e.message) }
  }

  const handleReview = async (pid: number, action: 'approve' | 'reject') => {
    try {
      const d = await api.post<{ msg: string }>(`/api/village/map/places/${pid}/review`, { action })
      flash(d.msg || '처리 완료')
      loadAll()
    } catch (e: any) { alert(e.message) }
  }

  const handleDeletePlace = async (pid: number) => {
    if (!confirm('장소를 삭제할까요?')) return
    try {
      await api.delete(`/api/village/map/places/${pid}`)
      flash('장소가 삭제되었습니다.')
      loadAll()
    } catch (e: any) { alert(e.message) }
  }

  const handleToggleStatus = async (p: VillagePlaceData, to: string) => {
    try {
      await api.put(`/api/village/map/places/${p.id}`, { status: to })
      flash('상태가 변경되었습니다.')
      loadAll()
    } catch (e: any) { alert(e.message) }
  }

  if (loading && !activeScope) return <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
  if (error && !activeScope) return <div className="alert alert-danger m-4">{error}</div>

  return (
    <div className="container py-4" style={{ maxWidth: 960 }}>
      <h4 className="fw-bold mb-2">🗺️ 마을 지도 관리</h4>
      <div className="mb-3">
        <a className="btn btn-sm btn-outline-secondary" href="/village/page">← 마을 홍보</a>
      </div>

      {msg && <div className="alert alert-info py-1 px-2 mb-2" style={{ fontSize: 12 }}>{msg}</div>}

      {scopes.length > 1 && (
        <div className="d-flex gap-2 flex-wrap mb-3">
          {scopes.map((s, i) => (
            <button key={i} className="btn btn-sm"
              style={{ background: activeScope === s ? '#343a40' : '#e9ecef', color: activeScope === s ? '#fff' : '#333', border: 'none', borderRadius: 20 }}
              onClick={() => setActiveScope(s)}>{s.myeon} {s.ri}</button>
          ))}
        </div>
      )}

      {activeScope && (
        <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
          <div className="card-body p-3">
            <h6 className="fw-bold mb-2">🗂️ 카테고리 관리 (자유 유형)</h6>
            <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
              <input className="form-control form-control-sm" style={{ maxWidth: 180 }} placeholder="카테고리 이름"
                value={catName} onChange={e => setCatName(e.target.value)} />
              <select className="form-select form-select-sm" style={{ width: 'auto' }} value={catIcon}
                onChange={e => setCatIcon(e.target.value)}>
                {ICONS.map(ic => <option key={ic} value={ic}>{ic}</option>)}
              </select>
              <select className="form-select form-select-sm" style={{ width: 'auto' }} value={catColor}
                onChange={e => setCatColor(e.target.value)}>
                {COLORS.map(c => <option key={c} value={c} style={{ background: c }}>{c}</option>)}
              </select>
              <button className="btn btn-sm btn-primary" onClick={handleAddCategory}>+ 추가</button>
            </div>
            {categories.length === 0 ? (
              <small className="text-muted">아직 카테고리가 없습니다. (예: 맛집, 병원, 문화재, 편의시설...)</small>
            ) : (
              <div className="d-flex gap-1 flex-wrap">
                {categories.map(c => (
                  <span key={c.id} className="badge d-inline-flex align-items-center gap-1" style={{ background: c.color + '22', color: c.color, fontSize: 12 }}>
                    {c.icon} {c.name}
                    <button className="btn btn-sm py-0 px-1" style={{ fontSize: 10, color: 'inherit' }} onClick={() => handleDeleteCategory(c.id)}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeScope && (
        <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
          <div className="card-body p-3">
            <h6 className="fw-bold mb-2">⏳ 제안 대기 ({pending.length})</h6>
            {pending.length === 0 ? (
              <small className="text-muted">승인 대기 중인 제안이 없습니다.</small>
            ) : (
              <div className="d-flex flex-column gap-2">
                {pending.map(p => (
                  <div key={p.id} className="border rounded p-2" style={{ background: '#fff' }}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div style={{ fontSize: 13 }}>
                        <strong>{p.category?.icon || '📍'} {p.name}</strong>
                        <span className="text-muted ms-2" style={{ fontSize: 11 }}>{p.submitted_name || `회원#${p.submitted_by}`}</span>
                        {p.address && <div className="text-muted" style={{ fontSize: 12 }}>📍 {p.address}</div>}
                        {p.description && <div style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{p.description.slice(0, 120)}{p.description.length > 120 ? '...' : ''}</div>}
                      </div>
                      <div className="d-flex gap-1 flex-shrink-0">
                        <button className="btn btn-sm btn-success" onClick={() => handleReview(p.id, 'approve')}>승인</button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => handleReview(p.id, 'reject')}>반려</button>
                      </div>
                    </div>
                    {p.media && p.media.length > 0 && (
                      <div className="d-flex gap-2 mt-1 overflow-auto">
                        {p.media.slice(0, 5).map((m, i) => (
                          m.type === 'video'
                            ? <video key={i} src={m.url} style={{ width: 60, height: 45, borderRadius: 6, objectFit: 'cover' }} controls preload="metadata" />
                            : <img key={i} src={m.url} alt="" style={{ width: 60, height: 45, objectFit: 'cover', borderRadius: 6 }} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <h6 className="fw-bold mb-2">📋 전체 장소 ({allPlaces.length})</h6>
          {allPlaces.length === 0 ? (
            <small className="text-muted">등록된 장소가 없습니다.</small>
          ) : (
            <div className="d-flex flex-column gap-1">
              {allPlaces.map(p => (
                <div key={p.id} className="d-flex justify-content-between align-items-center border-bottom py-1" style={{ fontSize: 13 }}>
                  <div>
                    {p.category?.icon || '📍'} {p.name}
                    <span className={`badge ms-2 ${p.status === 'approved' ? 'text-bg-success' : p.status === 'rejected' ? 'text-bg-danger' : 'text-bg-warning'}`} style={{ fontSize: 10 }}>
                      {p.status === 'approved' ? '공개' : p.status === 'rejected' ? '반려' : '대기'}
                    </span>
                    {p.address && <span className="text-muted ms-2" style={{ fontSize: 11 }}>{p.address}</span>}
                  </div>
                  <div className="d-flex gap-1 flex-shrink-0">
                    {p.status !== 'approved' && (
                      <button className="btn btn-sm btn-outline-success py-0 px-1" style={{ fontSize: 11 }} onClick={() => handleToggleStatus(p, 'approved')}>공개</button>
                    )}
                    {p.status !== 'rejected' && p.status !== 'pending' && (
                      <button className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: 11 }} onClick={() => handleToggleStatus(p, 'rejected')}>비공개</button>
                    )}
                    <button className="btn btn-sm btn-outline-danger py-0 px-1" style={{ fontSize: 11 }} onClick={() => handleDeletePlace(p.id)}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {activeScope && (
        <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
          <div className="card-body p-3">
            <h6 className="fw-bold mb-2">🗺️ 지도 미리보기</h6>
            <VillageMapView myeon={activeScope.myeon} ri={activeScope.ri} editable />
          </div>
        </div>
      )}
    </div>
  )
}
