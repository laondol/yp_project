import { useState, useEffect, useCallback } from 'react'
import Loading from '../components/common/Loading'

interface Review {
  id: number; photo_id: number; photo_image?: string; photo_title: string
  store_name: string; comment: string; reporter_name: string
  status: string; created_at: string
}

export default function AdminStoreReviews() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [msg, setMsg] = useState('')

  const fetchReviews = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/construction/admin/reviews?status=${tab}`).then(res => res.json())
      setReviews(r.reviews || [])
    } catch {}
    setLoading(false)
  }, [tab])

  useEffect(() => { fetchReviews() }, [fetchReviews])

  const handleAction = async (id: number, action: 'approve' | 'reject') => {
    setMsg('')
    const r = await fetch(`/construction/admin/review/${id}/${action}`, { method: 'POST' }).then(res => res.json())
    if (r.success) {
      setMsg(r.msg)
      fetchReviews()
    } else {
      setMsg(r.error || '실패')
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }} className="p-3">
      <h5 className="fw-bold mb-3">📋 가게 사진 정보 검토</h5>

      {/* 탭 */}
      <div className="d-flex gap-2 mb-3">
        {(['pending', 'approved', 'rejected'] as const).map(t => (
          <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setTab(t)}>
            {t === 'pending' ? '⏳ 대기' : t === 'approved' ? '✅ 반영' : '❌ 반려'}
          </button>
        ))}
      </div>

      {msg && <div className="alert alert-info py-2 small">{msg}</div>}

      {loading ? <Loading /> : reviews.length === 0 ? (
        <div className="text-center text-muted py-4">없음</div>
      ) : (
        <div className="list-group">
          {reviews.map(r => (
            <div key={r.id} className="list-group-item">
              <div className="d-flex gap-3">
                {r.photo_image && (
                  <img src={r.photo_image} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8 }} alt="" />
                )}
                <div className="flex-grow-1">
                  <div className="small fw-bold">{r.store_name || '미등록'} 📷 사진#{r.photo_id}</div>
                  <div className="small text-primary fw-bold">"{r.comment}"</div>
                  <div className="small text-muted">제보자: {r.reporter_name} | {r.created_at}</div>
                  {r.status === 'pending' && (
                    <div className="d-flex gap-2 mt-2">
                      <button className="btn btn-sm btn-success" onClick={() => handleAction(r.id, 'approve')}>
                        ✅ 반영 (1니아 지급)
                      </button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleAction(r.id, 'reject')}>
                        ❌ 반려
                      </button>
                    </div>
                  )}
                  {r.status !== 'pending' && (
                    <div className="small mt-1">
                      <span className={`badge ${r.status === 'approved' ? 'bg-success' : 'bg-secondary'}`}>
                        {r.status === 'approved' ? '반영됨' : '반려됨'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
