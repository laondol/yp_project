import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { formatKST } from '../utils/format'

export default function AdminRampApplications() {
  const { user } = useAuth()
  const [data, setData] = useState<{ open: boolean; applications: any[]; volunteers: any[] }>({ open: true, applications: [], volunteers: [] })
  const [loading, setLoading] = useState(true)

  const isLeader = !!user && user.role === 'leader'

  const load = () => {
    setLoading(true)
    fetch('/admin/ramp-applications/api', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { if (!loading) return; load() }, [loading])

  const toggle = async () => {
    if (!isLeader) return
    const res = await fetch('/admin/ramp/apply-toggle', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ open: !data.open }),
    })
    const d = await res.json()
    if (typeof d.open === 'boolean') setData({ ...data, open: d.open })
  }

  return (
    <div className="px-0 px-md-2">
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4 className="fw-bold mb-0">🦽 경사로 신청 관리</h4>
            {isLeader && (
              <button
                type="button"
                className={'btn btn-sm ' + (data.open ? 'btn-success' : 'btn-outline-danger')}
                onClick={toggle}
              >
                {data.open ? '✅ 신청 받는 중' : '⛔ 신청 마감'}
              </button>
            )}
          </div>

          {loading ? (
            <div className="text-muted small">불러오는 중…</div>
          ) : (
            <>
              <h6 className="fw-bold mt-2">📝 경사로 설치 신청 ({data.applications.length})</h6>
              {data.applications.length === 0 ? (
                <div className="text-muted small mb-3">신청 내역이 없습니다.</div>
              ) : (
                <div className="table-responsive mb-4">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr className="small text-muted">
                        <th>#</th><th>이름</th><th>연락처</th><th>위치</th><th>계단높이</th><th>소유</th><th>상태</th><th>신청시각</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.applications.map((a: any) => (
                        <tr key={a.id} className="small">
                          <td>{a.id}</td>
                          <td>{a.name}<br /><span className="text-muted">{a.email}</span></td>
                          <td>{a.phone}</td>
                          <td>{a.location}</td>
                          <td>{a.step_height}</td>
                          <td>{a.ownership}</td>
                          <td>{a.status === 'pending' ? '대기' : a.status}</td>
                          <td className="text-nowrap">{formatKST(a.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <h6 className="fw-bold mt-2">🙋 자원봉사 신청 ({data.volunteers.length})</h6>
              {data.volunteers.length === 0 ? (
                <div className="text-muted small">신청 내역이 없습니다.</div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm align-middle">
                    <thead>
                      <tr className="small text-muted">
                        <th>#</th><th>이름</th><th>이메일</th><th>연락처</th><th>신청시각</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.volunteers.map((v: any) => (
                        <tr key={v.id} className="small">
                          <td>{v.id}</td>
                          <td>{v.name}</td>
                          <td>{v.email}</td>
                          <td>{v.phone}</td>
                          <td className="text-nowrap">{formatKST(v.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
