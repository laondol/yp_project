import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'
import { formatKST } from '../utils/format'

interface DiscussionRoom {
  id: number; topic: string; status: string
  created_by: string; end_at?: string
  message_count: number; participant_count: number
  has_summary: boolean; created_at?: string
}

export default function DiscussionListPage() {
  const navigate = useNavigate()
  const [rooms, setRooms] = useState<DiscussionRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await fetch('/api/discussion/rooms').then(r => r.json())
      setRooms(data.rooms || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold text-success">토론방</h3>
      </div>

      {rooms.length === 0 ? (
        <EmptyState icon="💬" title="참여 중인 토론방이 없습니다." />
      ) : (
        rooms.map(r => {
          const isClosed = r.status === 'closed'
          const isEnded = r.end_at && new Date(r.end_at) < new Date()
          return (
            <div key={r.id} className="card mb-2 border-0 shadow-sm"
              style={{ borderRadius: 14, cursor: 'pointer', opacity: isClosed ? 0.7 : 1 }}
              onClick={() => navigate(`/discussion/${r.id}`)}>
              <div className="card-body p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h6 className="mb-1 fw-bold">{r.topic}</h6>
                    <small className="text-muted">개설: {r.created_by}</small>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    {isClosed && <span className="badge bg-secondary">종료</span>}
                    {r.has_summary && <span className="badge bg-info">요약 완료</span>}
                    {isEnded && !isClosed && <span className="badge bg-warning text-dark">마감</span>}
                  </div>
                </div>
                <div className="d-flex gap-3 mt-2">
                  <small className="text-muted">💬 {r.message_count}개</small>
                  <small className="text-muted">👥 {r.participant_count}명</small>
                  {r.end_at && (
                    <small className="text-muted">⏰ 마감: {formatKST(r.end_at)}</small>
                  )}
                </div>
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
