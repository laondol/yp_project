import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'

interface Comment { user: string; text: string; date: string }
interface PhotoVote {
  image: string; title: string; id: number
  up_count: number; down_count: number; my_vote?: string | null
  my_comment?: string | null; comments: Comment[]
}
interface StoreData {
  store_name: string; phone?: string; address?: string; store_link?: string
  gallery: PhotoVote[]
  correct_count: number; wrong_count: number
  user_points: number
}

export default function StoreDetailPage() {
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

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (town) params.set('town', town)
      if (village) params.set('village', village)
      if (lat) params.set('lat', lat)
      if (lng) params.set('lng', lng)
      const res = await fetch(`/construction/store-info-json?${params.toString()}`)
      if (!res.ok) { setError('가게 정보를 불러올 수 없습니다.'); return }
      setData(await res.json())
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }, [town, village, lat, lng])

  useEffect(() => { fetchData() }, [fetchData])

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
        setDownModal(null)
        fetchData()
      }
    } catch {}
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
          <h5 className="fw-bold mb-2" style={{ color: '#198754' }}>{data.store_name || storeName}</h5>
          {data.phone && <div className="small mb-1">📞 <a href={`tel:${data.phone}`}>{data.phone}</a></div>}
          {data.address && <div className="small text-muted mb-1">📍 {data.address}</div>}
          {data.store_link && (
            <a href={data.store_link} target="_blank" rel="noopener noreferrer"
              className="small text-decoration-none" style={{ color: '#198754' }}>🔗 가게 보기</a>
          )}
          <div className="mt-2 d-flex justify-content-between align-items-center">
            <div className="small">
              ✅ 맞는정보 <strong>{data.correct_count}</strong> &nbsp;|&nbsp; ❌ 틀린정보 <strong>{data.wrong_count}</strong>
            </div>
            <div className="small text-muted">잔여 니아: <strong>{data.user_points}</strong></div>
          </div>
        </div>
      </div>

      {/* 사진 격자 */}
      {data.gallery.length > 0 ? (
        <div className="row g-1">
          {data.gallery.map((g) => (
            <div key={g.id} className="col-4 col-md-3 col-lg-2">
              <div className="position-relative" style={{ cursor: 'pointer' }}
                onClick={() => setSelPhoto(g)}>
                <img src={g.image} className="w-100 rounded"
                  style={{ height: 100, objectFit: 'cover' }}
                  alt={g.title} loading="lazy" />
                {/* 투표 오버레이 */}
                <div className="position-absolute d-flex gap-1"
                  style={{ bottom: 4, right: 4 }}>
                  {g.up_count > 0 && (
                    <span className="badge bg-success" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>👍{g.up_count}</span>
                  )}
                  {g.down_count > 0 && (
                    <span className="badge bg-danger" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>👎{g.down_count}</span>
                  )}
                </div>
                {g.my_vote && (
                  <div className="position-absolute" style={{ top: 4, right: 4 }}>
                    <span className={`badge ${g.my_vote === 'up' ? 'bg-success' : 'bg-danger'}`}
                      style={{ fontSize: '0.6rem', padding: '1px 4px' }}>
                      {g.my_vote === 'up' ? '👍' : '👎'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center text-muted py-4">등록된 사진이 없습니다.</div>
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
    </div>
  )
}
