import { useState, useEffect, useMemo } from 'react'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'

interface ShareReport {
  id: number
  title: string
  description: string
  author_name: string
  town: string
  village: string
  address?: string
  status: 'pending' | 'approved' | 'rejected' | 'draft' | 'flagged' | 'pending_review' | 'pending_person'
  ai_danger_alert: boolean
  auto_sent?: boolean
  image_path: string | null
  extra_images?: string
  drawing_path: string | null
  video_path: string | null
  ai_category: string
  ai_summary: string
  ai_confidence?: number | null
  is_moderated: boolean
  moderation_result: string | null
  moderation_reason?: string | null
  user_id?: number | null
  like_count?: number
  latitude?: number | null
  longitude?: number | null
  created_at: string
  updated_at: string
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'draft'

const statusBadge = (s: ShareReport['status']) => {
  if (s === 'pending') return <span className="badge bg-warning text-dark">승인대기</span>
  if (s === 'approved') return <span className="badge bg-success">승인완료</span>
  if (s === 'draft') return <span className="badge bg-secondary">자동보관</span>
  if (s === 'pending_review') return <span className="badge bg-info text-dark">영상대기</span>
  if (s === 'pending_person') return <span className="badge bg-warning text-dark">인물확인</span>
  if (s === 'flagged') return <span className="badge bg-danger">차단</span>
  return <span className="badge bg-danger">반려</span>
}

const truncate = (text: string | null | undefined, max: number) => {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

function DetailModal({ r, onClose }: { r: ShareReport; onClose: () => void }) {
  const allImages: string[] = []
  if (r.image_path) allImages.push(r.image_path)
  if (r.extra_images) {
    for (const p of r.extra_images.split(',')) {
      if (p.trim() && !allImages.includes(p.trim())) allImages.push(p.trim())
    }
  }

  const fmt = (s: string | null | undefined) => {
    if (!s) return '-'
    return new Date(s).toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }} onClick={onClose}>
      <div
        className="bg-white"
        style={{ borderRadius: 14, width: '100%', maxWidth: 640, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
          <strong>📍 #{r.id} 상세 검토</strong>
          <button type="button" className="btn btn-sm btn-light" style={{ borderRadius: '50%', width: 30, height: 30, lineHeight: '20px', padding: 0 }} onClick={onClose}>&times;</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: 12 }}>
          {/* 상태/메타 */}
          <div className="d-flex flex-wrap gap-1 mb-3">
            {statusBadge(r.status)}
            {r.auto_sent && <span className="badge bg-warning text-dark">자동보관</span>}
            {r.ai_danger_alert && <span className="badge bg-danger">⚠️ 위험</span>}
            {r.video_path && <span className="badge bg-info text-dark">🎬 동영상</span>}
            {r.drawing_path && <span className="badge bg-secondary">✏️ 그리기</span>}
            <span className="badge bg-light text-dark">🏷️ {r.ai_category || '-'}</span>
            <span className="badge bg-light text-dark">👤 {r.author_name || '비회원'}</span>
          </div>

          {/* 내용 */}
          <h6 className="fw-bold mb-1">{r.title || '(제목 없음)'}</h6>
          <div className="small text-muted mb-3">
            #{r.id} · {fmt(r.created_at)}
            {r.address ? ` · ${r.address}` : (r.town || r.village ? ` · ${r.town} ${r.village}` : '')}
            {r.latitude && r.longitude ? ` · 📍 ${r.latitude.toFixed(6)}, ${r.longitude.toFixed(6)}` : ''}
          </div>

          {r.description && (
            <div className="p-3 bg-light rounded mb-3" style={{ whiteSpace: 'pre-wrap' }}>
              {r.description}
            </div>
          )}

          {r.ai_summary && (
            <div className="p-3 bg-light rounded mb-3 border-start border-5 border-info">
              <strong>🤖 AI 요약:</strong><br />{r.ai_summary}
            </div>
          )}

          {r.moderation_reason && (
            <div className="small text-danger mb-3">🚫 반려 사유: {r.moderation_reason}</div>
          )}

          <div className="small text-muted mb-3">
            검토: {r.is_moderated ? '✅ 완료' : '⏳ 대기'} · 결과: {r.moderation_result || '-'}
          </div>

          {/* 사진 전체 */}
          {allImages.length > 0 && (
            <div className="mb-3">
              <div className="fw-bold small mb-2">📷 사진 ({allImages.length})</div>
              <div className="d-flex flex-column gap-2">
                {allImages.map((img, i) => (
                  <a key={i} href={img} target="_blank" rel="noreferrer">
                    <img src={img} alt="" className="w-100 rounded" style={{ maxHeight: 420, objectFit: 'contain', background: '#f8f9fa', border: '1px solid #eee' }} />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* 동영상 */}
          {r.video_path && (
            <div className="mb-3">
              <div className="fw-bold small mb-2">🎬 동영상</div>
              <video controls className="w-100 rounded" style={{ maxHeight: 420, background: '#000' }}>
                <source src={r.video_path} />
              </video>
            </div>
          )}

          {/* 그리기 */}
          {r.drawing_path && (
            <div className="mb-3">
              <div className="fw-bold small mb-2">✏️ 직접 그리기</div>
              <a href={r.drawing_path} target="_blank" rel="noreferrer">
                <img src={r.drawing_path} alt="" className="w-100 rounded" style={{ maxHeight: 420, objectFit: 'contain', background: '#fff', border: '1px solid #eee' }} />
              </a>
            </div>
          )}

          {!allImages.length && !r.video_path && !r.drawing_path && (
            <div className="text-center text-muted py-4 bg-light rounded">첨부 미디어 없음</div>
          )}

          <div className="small text-muted text-center mt-2">
            사진/그리기는 클릭하면 새 탭에서 원본 크기로 열립니다.
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminShareReports() {
  const [reports, setReports] = useState<ShareReport[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('draft')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ type: 'success' | 'danger'; text: string } | null>(null)
  const [detail, setDetail] = useState<ShareReport | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/share-reports')
      if (!res.ok) throw new Error('불러오기 실패')
      const data = await res.json()
      setReports(Array.isArray(data) ? data : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const flash = (type: 'success' | 'danger', text: string) => {
    setMsg({ type, text })
    setTimeout(() => setMsg(null), 3000)
  }

  const act = async (id: number, action: 'approve' | 'reject' | 'delete') => {
    setBusyId(id)
    setMsg(null)
    try {
      const res = await fetch(`/share-report/${action === 'delete' ? 'delete' : 'toggle'}/${id}${action === 'delete' ? '' : '/' + action}`, { method: 'POST' })
      const data = await res.json()
      if (data.status !== 'success') {
        flash('danger', data.msg || '처리 실패')
      } else if (action === 'approve') {
        flash('success', `#${id} 승인 완료`)
      } else if (action === 'reject') {
        flash('success', `#${id} 반려 처리`)
      } else {
        flash('success', `#${id} 삭제 완료`)
      }
      load()
    } catch {
      flash('danger', '서버 연결 실패')
    } finally {
      setBusyId(null)
    }
  }

  const notify = async (id: number) => {
    setBusyId(id)
    setMsg(null)
    try {
      const res = await fetch(`/share-report/notify/${id}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success') {
        flash('success', data.msg || `#${id} 작성자에게 안내 쪽지 발송`)
      } else {
        flash('danger', data.msg || '쪽지 발송 실패')
      }
    } catch {
      flash('danger', '서버 연결 실패')
    } finally {
      setBusyId(null)
    }
  }

  const counts = useMemo(() => ({
    all: reports.length,
    pending: reports.filter(r => r.status === 'pending').length,
    approved: reports.filter(r => r.status === 'approved').length,
    rejected: reports.filter(r => r.status === 'rejected').length,
    draft: reports.filter(r => r.status === 'draft').length,
  }), [reports])

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase()
    return reports.filter(r => {
      if (filter !== 'all' && r.status !== filter) return false
      if (!kw) return true
      const hay = [r.title, r.description, r.author_name, r.town, r.village, r.ai_category, r.ai_summary]
        .join(' ').toLowerCase()
      return hay.includes(kw)
    })
  }, [reports, filter, search])

  const tabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: '전체' },
    { key: 'pending', label: '승인대기' },
    { key: 'approved', label: '승인완료' },
    { key: 'rejected', label: '반려' },
    { key: 'draft', label: '자동보관' },
  ]

  if (loading) return (
    <div className="px-0 px-md-2">
      <Loading />
    </div>
  )

  if (error) return (
    <div className="px-0 px-md-2">
      <ErrorMessage message={error} onRetry={load} />
    </div>
  )

  return (
    <div className="px-0 px-md-2">
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <h5 className="fw-bold mb-0">📍 공유마당 관리</h5>
            <button className="btn btn-sm btn-outline-secondary" onClick={load}>🔄 새로고침</button>
          </div>

          {msg && (
            <div className={`alert alert-${msg.type} py-2 small mb-3`}>{msg.text}</div>
          )}

          <div className="d-flex flex-wrap gap-1 mb-3">
            {tabs.map(t => (
              <button key={t.key} className={`btn btn-sm ${filter === t.key ? 'btn-success' : 'btn-outline-success'}`}
                onClick={() => setFilter(t.key)}>
                {t.label} ({counts[t.key]})
              </button>
            ))}
          </div>

          <input className="form-control form-control-sm mb-3"
            placeholder="제목 · 내용 · 작성자 · 마을 · 분류 검색"
            value={search} onChange={e => setSearch(e.target.value)} />

          {filtered.length === 0 ? (
            <EmptyState icon="📍" title="표시할 공유글이 없습니다" />
          ) : (
            <div className="row g-3">
              {filtered.map(r => (
                <div key={r.id} className="col-12 col-lg-6">
                  <div className="card h-100 border-0 shadow-xs" style={{ borderRadius: 12, background: '#fafafa' }}>
                    <div className="card-body p-3">
                      <div className="d-flex justify-content-between align-items-start mb-2">
                        <h6 className="fw-bold mb-0">
                          <span className="text-muted me-1" style={{ fontSize: 12 }}>#{r.id}</span>
                          {r.title}
                        </h6>
                        <div className="d-flex gap-1 flex-shrink-0">
                          {statusBadge(r.status)}
                          {r.auto_sent && <span className="badge bg-warning text-dark" title="10초 자동 발송 - 작성자 확인 대기">📬 자동</span>}
                          {r.ai_danger_alert && <span className="badge bg-danger" title="AI 위험 신호">⚠️</span>}
                        </div>
                      </div>

                      <p className="text-muted small mb-2">{truncate(r.description, 80)}</p>

                      <div className="d-flex flex-wrap gap-2 mb-2">
                        <span className="small text-secondary">👤 {r.author_name || '비회원'}</span>
                        <span className="small text-secondary">📍 {r.village || r.town || '-'}</span>
                        {r.address && <span className="small text-secondary">🏠 {truncate(r.address, 20)}</span>}
                        {r.video_path && <span className="badge bg-info text-dark">🎬 동영상</span>}
                        {typeof r.ai_confidence === 'number' && (
                          <span className="small text-secondary">🤖 신뢰도 {Math.round(r.ai_confidence * 100)}%</span>
                        )}
                        {typeof r.like_count === 'number' && r.like_count > 0 && (
                          <span className="small text-secondary">👍 {r.like_count}</span>
                        )}
                      </div>

                      {(r.image_path || r.drawing_path) && (
                        <div className="d-flex gap-2 mb-2">
                          {r.image_path && (
                            <img
                              src={r.image_path}
                              alt=""
                              style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8 }}
                            />
                          )}
                          {r.drawing_path && (
                            <img
                              src={r.drawing_path}
                              alt=""
                              style={{ width: 80, height: 60, objectFit: 'cover', borderRadius: 8 }}
                            />
                          )}
                        </div>
                      )}

                      {r.ai_category && (
                        <div className="mb-1">
                          <span className="badge bg-light text-dark me-1">🏷️ {r.ai_category}</span>
                          {r.ai_summary && (
                            <span className="small text-muted">{truncate(r.ai_summary, 90)}</span>
                          )}
                        </div>
                      )}

                      {r.moderation_reason && (
                        <div className="small text-danger mb-2">🚫 반려 사유: {truncate(r.moderation_reason, 60)}</div>
                      )}

                      <div className="d-flex justify-content-between align-items-center border-top pt-2 mt-1">
                        <span
                          className="small"
                          title={r.moderation_result ? `검토 결과: ${r.moderation_result}` : undefined}
                          style={{ cursor: r.moderation_result ? 'help' : undefined }}
                        >
                          {r.is_moderated ? '✅ 검토완료' : '⏳ 검토대기'}
                        </span>
                        <span className="small text-muted">
                          {new Date(r.created_at).toLocaleDateString('ko-KR')}
                        </span>
                      </div>

                      <div className="d-flex gap-1 mt-2">
                        <button className="btn btn-sm btn-outline-success flex-fill" onClick={() => setDetail(r)}>
                          👁 상세보기
                        </button>
                        <button className="btn btn-sm btn-outline-primary flex-fill" disabled={busyId === r.id}
                          onClick={() => notify(r.id)}
                          title="작성자에게 자동보관 안내 쪽지 보내기">
                          {busyId === r.id ? '처리 중...' : '📨 쪽지'}
                        </button>
                        {r.status !== 'approved' && (
                          <button className="btn btn-sm btn-success flex-fill" disabled={busyId === r.id}
                            onClick={() => act(r.id, 'approve')}>
                            {busyId === r.id ? '처리 중...' : '✅ 승인'}
                          </button>
                        )}
                        {r.status !== 'rejected' && (
                          <button className="btn btn-sm btn-warning flex-fill" disabled={busyId === r.id}
                            onClick={() => { if (confirm(`#${r.id} '${r.title}' 공유를 반려하시겠습니까?`)) act(r.id, 'reject') }}>
                            {busyId === r.id ? '처리 중...' : '⛔ 반려'}
                          </button>
                        )}
                        <button className="btn btn-sm btn-outline-danger flex-fill" disabled={busyId === r.id}
                          onClick={() => { if (confirm(`#${r.id} '${r.title}' 공유를 삭제하시겠습니까?`)) act(r.id, 'delete') }}>
                          {busyId === r.id ? '처리 중...' : '🗑️ 삭제'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {detail && <DetailModal r={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}
