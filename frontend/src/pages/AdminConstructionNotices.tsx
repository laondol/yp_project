import { useState, useEffect } from 'react'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'

const TYPE_LABELS: Record<string, string> = {
  traffic_incident: '교통돌발', traffic_congestion: '지정체', road_construction: '도로공사', building_permit: '건축공사',
}

interface CNotice {
  id: number; title: string; location: string | null; notice_type: string; source: string | null
  start_date: string | null; end_date: string | null; is_active: boolean; latitude: number | null; longitude: number | null
}

export default function AdminConstructionNotices() {
  const [notices, setNotices] = useState<CNotice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<number | null>(null)

  const fetchNotices = async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/admin/construction-notices')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setNotices(Array.isArray(data.notices) ? data.notices : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }

  useEffect(() => { fetchNotices() }, [])

  const toggle = async (id: number) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/construction-notices/${id}/toggle`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setNotices(ns => ns.map(n => n.id === id ? { ...n, is_active: d.is_active } : n))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '변경 실패')
    } finally { setBusy(null) }
  }

  return (
    <div className="px-0 px-md-2">
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-4">🚧 공사알림 관리 (개시 / 비개시)</h5>
          {loading ? (
            <Loading />
          ) : error ? (
            <ErrorMessage message={error} onRetry={fetchNotices} />
          ) : notices.length === 0 ? (
            <div className="text-center py-5 text-muted">공사 알림이 없습니다.</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0" style={{ fontSize: '0.85rem' }}>
                <thead className="table-light">
                  <tr>
                    <th>ID</th><th>구분</th><th>제목</th><th>지역</th><th>시작일</th><th>상태</th><th>개시 토글</th>
                  </tr>
                </thead>
                <tbody>
                  {notices.map(n => (
                    <tr key={n.id}>
                      <td className="text-muted small">{n.id}</td>
                      <td><span className="badge bg-secondary">{TYPE_LABELS[n.notice_type] || n.notice_type}</span></td>
                      <td className="fw-semibold">{n.title}</td>
                      <td>{n.location || '-'}</td>
                      <td>{n.start_date || '-'}</td>
                      <td className="text-center">{n.is_active ? '✅' : '❌'}</td>
                      <td className="text-center">
                        <button className="btn btn-sm btn-outline-primary" disabled={busy === n.id}
                          onClick={() => toggle(n.id)}>
                          {n.is_active ? '비개시로' : '개시하기'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
