import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'

interface LaborIssue {
  id: number
  title: string
  content?: string
  summary?: string
  author_name?: string
  comment_count?: number
  comments_count?: number
  labor_approved?: boolean
  source_url?: string
  like_count?: number
  dislike_count?: number
  created_at?: string
  type?: 'post' | 'news'
  is_selected?: boolean
}

interface AdminNewsItem {
  id: number
  title: string
  summary: string
  category: string
  source_url?: string
  is_selected: boolean
  created_at: string
}

export default function LegalIssuesPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [issues, setIssues] = useState<LaborIssue[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const isLegalManager = user?.role === 'admin' || user?.role === 'leader'
  const [showNewsModal, setShowNewsModal] = useState(false)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [importMsgOk, setImportMsgOk] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [adminNews, setAdminNews] = useState<AdminNewsItem[]>([])

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetch('/api/legal/issues')
      if (!res.ok) throw new Error('불러오기 실패')
      const data = await res.json()
      setIssues(Array.isArray(data) ? data : data.issues || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  const loadAdminNews = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/labor-news?page=1')
      if (!res.ok) return
      const data = await res.json()
      setAdminNews(data.items ?? [])
    } catch { /* ignore */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (showNewsModal && isLegalManager) loadAdminNews() }, [showNewsModal, isLegalManager, loadAdminNews])

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return
    setImporting(true); setImportMsg('')
    try {
      const fd = new FormData()
      fd.append('url', importUrl.trim())
      const res = await fetch('/admin/labor-news/import-url', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        setImportMsg('✅ 뉴스를 가져왔습니다!')
        setImportMsgOk(true)
        setImportUrl('')
        loadAdminNews()
      } else {
        setImportMsg(data.msg || '가져오기 실패')
        setImportMsgOk(false)
      }
    } catch { setImportMsg('오류가 발생했습니다.'); setImportMsgOk(false) }
    finally { setImporting(false) }
  }

  const handleAiSuggest = async () => {
    setSuggesting(true)
    try {
      const fd = new FormData()
      fd.append('tab', 'kr_yp')
      const res = await fetch('/admin/labor-news/ai-suggest', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        alert(data.msg || `✅ ${data.count}개의 노사 뉴스를 가져왔습니다.`)
        loadAdminNews()
      } else {
        alert(data.msg || '추천 실패')
      }
    } catch { alert('오류가 발생했습니다.') }
    finally { setSuggesting(false) }
  }

  const handleToggleNews = async (id: number) => {
    try {
      const res = await fetch(`/admin/labor-news/toggle/${id}`)
      const data = await res.json()
      if (data.status === 'success') {
        setAdminNews(prev => prev.map(n => n.id === id ? { ...n, is_selected: data.is_selected } : n))
      } else { alert(data.msg || '토글 실패') }
    } catch { alert('오류가 발생했습니다.') }
  }

  const handleDeleteNews = async (id: number) => {
    if (!confirm('이 뉴스를 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/admin/labor-news/delete/${id}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success') {
        setAdminNews(prev => prev.filter(n => n.id !== id))
      } else { alert(data.msg || '삭제 실패') }
    } catch { alert('오류가 발생했습니다.') }
  }

  const handleVote = async (id: number, vote: 'like' | 'dislike') => {
    try {
      const res = await fetch(`/labor-news/${vote}/${id}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success') {
        setIssues(prev => prev.map(i => 
          i.id === id && i.type === 'news' 
            ? { ...i, like_count: data.likes, dislike_count: data.dislikes } 
            : i
        ))
        if (data.cost) {
          alert(`${vote === 'like' ? '좋아요' : '별로예요'} 완료! (${data.cost}.Xml 차감)`)
        }
      } else {
        alert(data.msg || '투표 실패')
      }
    } catch { alert('오류가 발생했습니다.') }
  }

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="fw-bold mb-0">노동이슈</h4>
        <div className="d-flex gap-2">
          {isLegalManager && (
            <button className="btn btn-sm btn-outline-warning" onClick={() => navigate('/legal/issues/admin')}>
              ⚙️ 관리
            </button>
          )}
          {isLegalManager && (
            <button className="btn btn-sm btn-success" onClick={() => navigate('/legal/issues/write')}>
              글쓰기
            </button>
          )}
        </div>
      </div>

      {issues.length === 0 ? (
        <EmptyState icon="📋" title="등록된 게시글이 없습니다." />
      ) : (
        <div className="row g-3">
          {issues.map(issue => (
            <div key={`${issue.type}-${issue.id}`} className="col-12">
              {issue.type === 'news' ? (
                <div className="card border-0 shadow-sm" style={{ borderRadius: 12 }}>
                  <div className="card-body p-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <h6 className="fw-bold mb-1">{issue.title}</h6>
                      <span className="small text-muted">{formatDate(issue.created_at)}</span>
                    </div>
                    <div className="mt-1">
                      <small className="text-muted">뉴스</small>
                      {issue.source_url && (
                        <a href={issue.source_url} target="_blank" rel="noopener noreferrer" className="small text-primary ms-2">
                          🔗 원문보기
                        </a>
                      )}
                    </div>
                    <div className="d-flex gap-2 mt-2">
                      <button 
                        className="btn btn-sm btn-outline-success py-0" 
                        onClick={(e) => { e.stopPropagation(); handleVote(issue.id, 'like'); }}
                      >
                        👍 {issue.like_count ?? 0} <span className="text-muted">(1.Xml)</span>
                      </button>
                      <button 
                        className="btn btn-sm btn-outline-danger py-0" 
                        onClick={(e) => { e.stopPropagation(); handleVote(issue.id, 'dislike'); }}
                      >
                        👎 {issue.dislike_count ?? 0} <span className="text-muted">(1.Xml)</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="card border-0 shadow-sm"
                  style={{ borderRadius: 12, cursor: 'pointer' }}
                  onClick={() => navigate(`/legal/issues/${issue.id}`)}
                >
                  <div className="card-body p-3">
                    <div className="d-flex justify-content-between align-items-start">
                      <h6 className="fw-bold mb-1">{issue.title}</h6>
                      <span className="small text-muted">{formatDate(issue.created_at)}</span>
                    </div>
                    <div className="d-flex justify-content-between align-items-center mt-2">
                      <small className="text-muted">{issue.author_name || '익명'}</small>
                      <small className="text-muted">
                        💬 {issue.comment_count ?? issue.comments_count ?? 0}
                      </small>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showNewsModal && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content" style={{ borderRadius: 16 }}>
              <div className="modal-header">
                <h5 className="fw-bold">AI 추천뉴스 관리</h5>
                <button type="button" className="btn-close" onClick={() => { setShowNewsModal(false); load() }} />
              </div>
              <div className="modal-body">
                <div className="input-group mb-2">
                  <input
                    type="url"
                    className="form-control"
                    placeholder="뉴스 URL을 붙여넣으세요..."
                    value={importUrl}
                    onChange={e => setImportUrl(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
                  />
                  <button
                    className="btn btn-outline-primary"
                    onClick={handleImportUrl}
                    disabled={importing || !importUrl.trim()}
                  >
                    {importing ? '⏳' : '🌐 가져오기'}
                  </button>
                </div>
                {importMsg && (
                  <div className={`small mb-2 ${importMsgOk ? 'text-success' : 'text-danger'}`}>{importMsg}</div>
                )}

                <div className="d-flex gap-2 mb-3">
                  <button className="btn btn-outline-success btn-sm" onClick={handleAiSuggest} disabled={suggesting}>
                    {suggesting ? '⏳ 추천 중...' : '🤖 AI 노사 뉴스 추천'}
                  </button>
                </div>

                {adminNews.length > 0 && (
                  <div>
                    <div className="fw-bold small mb-2 text-muted">가져온 뉴스</div>
                    {adminNews.map(n => (
                      <div key={n.id} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                        <div className="flex-grow-1 me-2">
                          <div className="small fw-bold">{n.title.length > 50 ? n.title.slice(0, 50) + '...' : n.title}</div>
                          {n.summary && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{n.summary.length > 60 ? n.summary.slice(0, 60) + '...' : n.summary}</div>}
                          {n.source_url && <a href={n.source_url} target="_blank" rel="noopener noreferrer" className="text-primary" style={{ fontSize: '0.7rem' }}>🔗 원문</a>}
                        </div>
                        <div className="d-flex gap-1 flex-shrink-0">
                          <button
                            className={`btn btn-sm py-0 ${n.is_selected ? 'btn-success' : 'btn-outline-secondary'}`}
                            onClick={() => handleToggleNews(n.id)}
                            title={n.is_selected ? '표시중' : '숨김'}
                            style={{ fontSize: '0.8rem' }}
                          >
                            {n.is_selected ? '👁️' : '🚫'}
                          </button>
                          <a href={`/admin/labor-news/edit/${n.id}`} className="btn btn-sm btn-outline-primary py-0" title="편집" style={{ fontSize: '0.8rem' }}>
                            ✏️
                          </a>
                          <button
                            className="btn btn-sm btn-outline-danger py-0"
                            onClick={() => handleDeleteNews(n.id)}
                            title="삭제"
                            style={{ fontSize: '0.8rem' }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
