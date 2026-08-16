import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatKST } from '../utils/format';

interface PendingSession {
  sessionId: string
  subjectUserId: number
  subjectName: string
  subjectEmail: string
  hasDid: boolean
  createdAt: string
}

export default function VillageQrApprovals() {
  const navigate = useNavigate()
  const [list, setList] = useState<PendingSession[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchPending = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/did/qr-session/pending', { credentials: 'include' })
      if (r.ok) { const d = await r.json(); setList(d) }
    } catch {}
    finally { setLoading(false) }
  }

  const handleAction = async (sessionId: string, action: 'approve' | 'reject') => {
    setActionLoading(sessionId)
    try {
      const r = await fetch(`/api/did/qr-session/${action}`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      if (r.ok) fetchPending()
    } catch {}
    finally { setActionLoading(null) }
  }

  useEffect(() => {
    fetchPending()
    const interval = setInterval(fetchPending, 15000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div style={{ maxWidth: 600, margin: '0 auto' }}>
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4 className="fw-bold mb-0">📋 VC 발급 승인</h4>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/village/qr')}>
              ← QR 페이지
            </button>
          </div>

          {loading ? (
            <p className="text-muted text-center py-3">로딩 중...</p>
          ) : list.length === 0 ? (
            <p className="text-muted text-center py-3">승인 대기 중인 요청이 없습니다.</p>
          ) : (
            <div className="list-group">
              {list.map(session => (
                <div key={session.sessionId} className="list-group-item list-group-item-action d-flex justify-content-between align-items-center">
                  <div>
                    <strong>{session.subjectName}</strong>
                    <div className="small text-muted">{session.subjectEmail}</div>
                    <div className="small text-muted">
                      {session.hasDid ? '🆔 DID 있음' : '⚠️ DID 없음'} · {formatKST(session.createdAt)}
                    </div>
                  </div>
                  <div className="d-flex gap-2">
                    <button className="btn btn-success btn-sm" onClick={() => handleAction(session.sessionId, 'approve')}
                      disabled={actionLoading === session.sessionId}>
                      {actionLoading === session.sessionId ? '...' : '✅ 승인'}
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleAction(session.sessionId, 'reject')}
                      disabled={actionLoading === session.sessionId}>
                      ❌ 거절
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}