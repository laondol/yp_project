import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import AuthorName from '../components/AuthorName'
import { useAuth } from '../contexts/AuthContext'

interface Comment { user: string; text: string; date: string }
interface PhotoVote {
  image: string; title: string; id: number
  description?: string; author?: string; created_at?: string; meal_note?: string; share_url?: string
  up_count: number; down_count: number; my_vote?: string | null
  my_comment?: string | null; comments: Comment[]
}
interface ManagerInfo { username: string | null; verified: boolean; requested: boolean; verified_at?: string | null }
interface StoreData {
  store_name: string; store_info_id?: number | null; category?: string
  phone?: string; address?: string; store_link?: string
  ai_profile?: string | null; lat?: number; lng?: number
  business_hours?: string | null; reservation_url?: string | null
  detail_info?: string | null; last_share_at?: string | null
  member_basic?: { titles: string[]; summary: string; content_count: number; last_share_at?: string | null } | null
  can_edit?: boolean
  manager?: ManagerInfo | null
  gallery: PhotoVote[]
  menus?: { name: string; category: string; price?: string }[]
  correct_count: number; wrong_count: number
  user_points: number
}

export default function StoreDetailPage() {
  const { user } = useAuth()
  const { storeName } = useParams<{ storeName: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const town = searchParams.get('town') || ''
  const village = searchParams.get('village') || ''
  const lat = searchParams.get('lat') || ''
  const lng = searchParams.get('lng') || ''
  const [data, setData] = useState<StoreData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [votingId, setVotingId] = useState<number | null>(null)
  const [selPhoto, setSelPhoto] = useState<PhotoVote | null>(null)
  const [downModal, setDownModal] = useState<{ photoId: number; comment: string } | null>(null)
  const [mgrMsg, setMgrMsg] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editForm, setEditForm] = useState({ business_hours: '', reservation_url: '', detail_info: '', phone: '', category: '' })
  const [editSaving, setEditSaving] = useState(false)

  const openEdit = () => {
    if (!data) return
    setEditForm({
      business_hours: data.business_hours || '',
      reservation_url: data.reservation_url || '',
      detail_info: data.detail_info || '',
      phone: data.phone || '',
      category: data.category || '음식점',
    })
    setEditOpen(true)
  }

  const saveEdit = async () => {
    if (!data?.store_info_id || editSaving) return
    setEditSaving(true)
    try {
      const res = await fetch(`/construction/store-info-edit/${data.store_info_id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      const r = await res.json()
      alert(r.msg || (r.success ? '저장 완료' : '저장 실패'))
      if (r.success) { setEditOpen(false); fetchData() }
    } catch { alert('서버 연결 실패') }
    setEditSaving(false)
  }

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (town) params.set('town', town)
      if (village) params.set('village', village)
      if (lat) params.set('lat', lat)
      if (lng) params.set('lng', lng)
      if (storeName) params.set('store_name', decodeURIComponent(storeName))
      const res = await fetch(`/construction/store-info-json?${params.toString()}`)
      if (!res.ok) { setError('시설 정보를 불러올 수 없습니다.'); return }
      setData(await res.json())
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }, [town, village, lat, lng, storeName])

  useEffect(() => { fetchData() }, [fetchData])

  const requestManager = async () => {
    if (!data?.store_info_id) return
    if (!confirm('이 시설의 책임자로 신청하시겠습니까?\n주민인증 회원만 신청할 수 있으며, 리더/관리자 승인 후 인증됩니다.')) return
    try {
      const res = await fetch(`/construction/store-manager/request/${data.store_info_id}`, { method: 'POST' })
      const r = await res.json()
      setMgrMsg(r.msg || (r.success ? '신청 완료' : '신청 실패'))
      if (r.success) fetchData()
    } catch { setMgrMsg('서버 연결 실패') }
  }

  const handlePhotoVote = async (photoId: number, voteType: 'up' | 'down', comment?: string) => {
    if (votingId) return
    setVotingId(photoId)
    try {
      const body: Record<string, unknown> = { photo_id: photoId, vote_type: voteType }
      if (comment) body.comment = comment
      const res = await fetch('/construction/store-vote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const r = await res.json()
      if (r.success) {
        alert(r.msg || '투표 완료')
        setDownModal(null)
        setSelPhoto(null)
        fetchData()
      } else {
        alert(r.error || r.msg || '투표 실패')
      }
    } catch { alert('서버 연결 실패') }
    setVotingId(null)
  }

  if (loading) return <Loading />
  if (error) return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }} className="p-4">
      <button className="btn btn-sm btn-outline-secondary mb-3" onClick={() => navigate('/construction')}>← 위치기반안내</button>
      <div className="alert alert-warning">{error}</div>
    </div>
  )
  if (!data) return null

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="mb-3 p-2">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/construction')}>← 위치기반안내</button>
      </div>

      {/* 가게 정보 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <div className="d-flex justify-content-between align-items-start">
            <h5 className="fw-bold mb-2" style={{ color: '#198754' }}>
              {data.store_name || decodeURIComponent(storeName || '')}
              {data.category && <span className="badge bg-light text-dark ms-2 border">{data.category}</span>}
            </h5>
            {/* 책임자 배지 + 편집 버튼 */}
            <div className="d-flex gap-1">
              {data.manager?.verified && (
                <span className="badge bg-success">✅ 시설책임자 {data.manager.username}</span>
              )}
              {data.can_edit && (
                <button className="btn btn-sm btn-outline-primary" style={{ fontSize: '0.7rem' }} onClick={openEdit}>
                  ✏️ 수정
                </button>
              )}
            </div>
          </div>
          {data.manager?.requested && !data.manager.verified && (
            <div className="small text-warning mb-1">⏳ 책임자 승인 대기 중</div>
          )}
          {mgrMsg && <div className="small text-info mb-1">{mgrMsg}</div>}
          {!data.manager?.verified && !data.manager?.requested && data.store_info_id && (
            <button className="btn btn-sm btn-outline-success mb-2" onClick={requestManager}>
              🏷️ 시설 책임자 신청
            </button>
          )}
          {data.phone && <div className="small mb-1">📞 <a href={`tel:${data.phone}`}>{data.phone}</a></div>}
          {data.address && <div className="small text-muted mb-1">📍 {data.address}</div>}
          {data.business_hours && (
            <div className="small mb-1">🕐 {data.business_hours}</div>
          )}
          {data.last_share_at && (
            <div className="small text-muted mb-1">🕐 마지막 영업공유: {data.last_share_at}</div>
          )}
          {data.reservation_url && (
            <a href={data.reservation_url} target="_blank" rel="noopener noreferrer"
              className="small text-decoration-none d-block mb-1" style={{ color: '#0d6efd' }}>📞 예약하기</a>
          )}
          {data.detail_info && (
            <div className="mt-2 p-2 rounded small" style={{ background: '#f8f9fa', border: '1px solid #dee2e6' }}
              dangerouslySetInnerHTML={{ __html: data.detail_info }} />
          )}
          {data.store_link && (
            <a href={data.store_link} target="_blank" rel="noopener noreferrer"
              className="small text-decoration-none" style={{ color: '#198754' }}>🔗 가게 보기</a>
          )}
          {/* 회원 공유 기반 기본정보 (StoreInfo 없이 위치로 묶인 경우) */}
          {!data.store_info_id && data.member_basic && (
            <div className="mt-2 p-2 rounded small" style={{ background: '#fff8e6', border: '1px solid #ffe69c' }}>
              <div className="fw-bold mb-1" style={{ color: '#997404' }}>📋 회원 공유 기반 정보 ({data.member_basic.content_count}건)</div>
              {data.member_basic.titles.length > 0 && (
                <div className="mb-1">
                  {data.member_basic.titles.map((t, i) => (
                    <div key={i}>· {t}</div>
                  ))}
                </div>
              )}
              {data.member_basic.summary && (
                <div className="text-muted">{data.member_basic.summary}</div>
              )}
              {!data.store_info_id && (
                <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                  아직 시설 정보가 등록되지 않은 위치입니다. 첫 가게명 입력 또는 시설 책임자 지정으로 시설이 구성됩니다.
                </div>
              )}
            </div>
          )}
          {/* AI 통합 프로필 */}
          {data.ai_profile && (
            <div className="mt-2 p-2 rounded small" style={{ background: '#f0f9f4', border: '1px solid #d4edda' }}>
              <div className="fw-bold mb-1" style={{ color: '#198754' }}>🤖 AI 가게 소개</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{data.ai_profile}</div>
            </div>
          )}
          {/* 메뉴 목록 */}
          {data.menus && data.menus.length > 0 && (
            <div className="mt-2">
              <div className="fw-bold small mb-1" style={{ color: '#198754' }}>🍽️ 메뉴</div>
              <div className="d-flex flex-wrap gap-1">
                {data.menus.map((m, i) => (
                  <span key={i} className="badge bg-light text-dark border">
                    {m.name}{m.price ? ` ${m.price}` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="mt-2 d-flex justify-content-between align-items-center">
            <div className="small">
              ✅ 맞는정보 <strong>{data.correct_count}</strong> &nbsp;|&nbsp; ❌ 틀린정보 <strong>{data.wrong_count}</strong>
            </div>
            <div className="small text-muted">잔여 니아: <strong>{data.user_points}</strong></div>
          </div>
        </div>
      </div>

      {/* 콘텐츠 썸네일 (시간순) */}
      {data.gallery.length > 0 ? (
        <>
          <div className="fw-bold small mb-2 text-muted">📸 회원 콘텐츠 ({data.gallery.length}건 · 최신순)</div>
          <div className="row g-2 mb-4">
            {data.gallery.map((g) => (
              <div key={g.id + g.image} className="col-6 col-md-4 col-lg-3">
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 12, cursor: 'pointer' }}
                  onClick={() => setSelPhoto(g)}>
                  <img src={g.image} className="card-img-top"
                    style={{ height: 140, objectFit: 'cover', borderRadius: '12px 12px 0 0' }}
                    alt={g.title} loading="lazy" />
                  <div className="card-body p-2">
                    <div className="small fw-bold text-truncate">{g.title || '제목 없음'}</div>
                    {g.meal_note && <div className="small text-success">✅ {g.meal_note}</div>}
                    {g.description && <div className="small text-muted text-truncate">{g.description}</div>}
                    <div className="d-flex justify-content-between small text-muted mt-1">
                      {(g as any).author_email ? (
                        (g as any).user_id === user?.id
                          ? <span style={{ fontStyle: 'normal' }}>{(g as any).author_email}</span>
                          : <AuthorName name={g.author} email={(g as any).author_email} userId={(g as any).user_id} />
                      ) : <span>{g.author}</span>}
                      <span>{g.created_at}</span>
                    </div>
                    <div className="d-flex gap-1 mt-1">
                      {g.up_count > 0 && <span className="badge bg-success" style={{ fontSize: '0.6rem' }}>👍{g.up_count}</span>}
                      {g.down_count > 0 && <span className="badge bg-danger" style={{ fontSize: '0.6rem' }}>👎{g.down_count}</span>}
                      {g.share_url && (
                        <a href={g.share_url} className="badge bg-light text-primary border" style={{ fontSize: '0.6rem' }}
                          onClick={e => e.stopPropagation()}>원문</a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center text-muted py-4">등록된 콘텐츠가 없습니다.</div>
      )}

      {/* 사진 상세 모달 (클릭 시) */}
      {selPhoto && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.85)', zIndex: 3000 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered" style={{ margin: '1rem' }}>
            <div className="modal-content" style={{ borderRadius: 14, position: 'relative' }}>
              <button onClick={() => setSelPhoto(null)}
                style={{ position: 'absolute', top: 8, right: 8, zIndex: 10, width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: 14, cursor: 'pointer' }}>✕</button>
              <div className="modal-body p-2">
                {/* 사진 */}
                <img src={selPhoto.image} className="w-100 rounded mb-2"
                  style={{ maxHeight: '50vh', objectFit: 'contain' }} alt={selPhoto.title} />
                {/* 투표 버튼 */}
                <div className="d-flex justify-content-center gap-2 mb-2">
                  <button
                    className="btn btn-sm btn-outline-success"
                    onClick={() => handlePhotoVote(selPhoto.id, 'up')}
                    disabled={votingId === selPhoto.id}>
                    👍 맞는정보 {selPhoto.up_count > 0 && `(${selPhoto.up_count})`}
                  </button>
                  <button
                    className="btn btn-sm btn-outline-danger"
                    onClick={() => setDownModal({ photoId: selPhoto.id, comment: '' })}
                    disabled={votingId === selPhoto.id}>
                    👎 틀린정보 {selPhoto.down_count > 0 && `(${selPhoto.down_count})`}
                  </button>
                </div>
                {/* 코멘트 */}
                {selPhoto.my_comment && (
                  <div className="mb-1 p-2 rounded small" style={{ background: '#fff3cd' }}>
                    💬 내 의견: {selPhoto.my_comment}
                  </div>
                )}
                {selPhoto.comments.length > 0 && (
                  <div className="border-top pt-2 mt-1">
                    <div className="fw-bold small mb-1">의견 ({selPhoto.comments.length})</div>
                    {selPhoto.comments.map((c, i) => (
                      <div key={i} className="d-flex gap-2 mb-1 small">
                        <span className="text-muted">{c.user}</span>
                        <span className="text-primary fw-bold">"{c.text}"</span>
                        <span className="text-muted ms-auto">{c.date}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 틀린정보 코멘트 모달 */}
      {downModal && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)', zIndex: 4000 }}
          onClick={() => setDownModal(null)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 14 }}>
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">❌ 틀린정보 수정 (+1니아)</h6>
                <button type="button" className="btn-close" onClick={() => setDownModal(null)}></button>
              </div>
              <div className="modal-body">
                <div className="small text-muted mb-2">이 사진이 다른 가게라면 실제 가게 이름을 알려주세요.</div>
                <input type="text" className="form-control form-control-sm mb-2" placeholder="예: 이 사진은 멸치국수입니다"
                  value={downModal.comment} onChange={e => setDownModal({ ...downModal, comment: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && downModal.comment.trim()) handlePhotoVote(downModal.photoId, 'down', downModal.comment.trim()) }}
                  autoFocus maxLength={200} />
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-outline-secondary flex-fill" onClick={() => setDownModal(null)}>취소</button>
                  <button className="btn btn-sm btn-danger flex-fill" disabled={!downModal.comment.trim() || votingId === downModal.photoId}
                    onClick={() => handlePhotoVote(downModal.photoId, 'down', downModal.comment.trim())}>
                    {votingId === downModal.photoId ? '처리 중...' : '수정(+1니아)'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 시설 정보 편집 모달 */}
      {editOpen && data?.store_info_id && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)', zIndex: 4000 }}
          onClick={() => setEditOpen(false)}>
          <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 14 }}>
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">✏️ 시설 정보 수정</h6>
                <button type="button" className="btn-close" onClick={() => setEditOpen(false)}></button>
              </div>
              <div className="modal-body">
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">유형</label>
                  <input type="text" className="form-control form-control-sm" placeholder="예: 음식점, 카페, 병원"
                    value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">연락처</label>
                  <input type="text" className="form-control form-control-sm" placeholder="031-xxx-xxxx"
                    value={editForm.phone} onChange={e => setEditForm({ ...editForm, phone: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">영업시간</label>
                  <input type="text" className="form-control form-control-sm" placeholder="예: 09:00-21:00, 일요일 휴무"
                    value={editForm.business_hours} onChange={e => setEditForm({ ...editForm, business_hours: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">예약 링크</label>
                  <input type="url" className="form-control form-control-sm" placeholder="https://..."
                    value={editForm.reservation_url} onChange={e => setEditForm({ ...editForm, reservation_url: e.target.value })} />
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-bold mb-1">상세정보</label>
                  <textarea className="form-control form-control-sm" rows={4} placeholder="시설 상세 정보 (HTML 지원)"
                    value={editForm.detail_info} onChange={e => setEditForm({ ...editForm, detail_info: e.target.value })} />
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditOpen(false)}>취소</button>
                <button className="btn btn-sm btn-primary" disabled={editSaving} onClick={saveEdit}>
                  {editSaving ? '저장 중...' : '저장'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
