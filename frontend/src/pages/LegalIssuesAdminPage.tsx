import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format'

interface LaborNewsItem {
  id: number
  title: string
  summary: string
  category: string
  source_url: string
  ai_reason: string
  is_selected: boolean
  created_at: string
}

export default function LegalIssuesAdminPage() {
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const [news, setNews] = useState<LaborNewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [importMsgOk, setImportMsgOk] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [collecting, setCollecting] = useState(false)

  useEffect(() => {
    if (!authLoading && (!user || (user.role !== 'admin' && user.role !== 'leader'))) {
      navigate('/legal/issues')
    }
  }, [user, authLoading, navigate])

  const fetchNews = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/labor-news?page=${page}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setNews(data.items ?? [])
      setTotalPages(data.total_pages ?? 1)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchNews()
  }, [page])

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    setImportMsg('')
    try {
      const formData = new FormData()
      formData.append('url', importUrl)
      const res = await fetch('/admin/labor-news/import-url', { method: 'POST', body: formData })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        setImportMsg('가져오기 성공!')
        setImportMsgOk(true)
        setImportUrl('')
        fetchNews()
      } else {
        setImportMsg(data.msg || data.message || '가져오기 실패')
        setImportMsgOk(false)
      }
    } catch {
      setImportMsg('오류가 발생했습니다.')
      setImportMsgOk(false)
    } finally {
      setImporting(false)
    }
  }

  const handleAiSuggest = async () => {
    setSuggesting(true)
    try {
      const res = await fetch('/admin/labor-news/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'tab=kr_yp',
      })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        alert(data.msg || `✅ ${data.count}개의 노동 뉴스를 가져왔습니다.`)
        fetchNews()
      } else {
        alert(data.msg || data.message || '추천 실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    } finally {
      setSuggesting(false)
    }
  }

  const handleCollect = async () => {
    setCollecting(true)
    try {
      const res = await fetch('/admin/labor-news/collect', { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        alert(data.msg || `✅ ${data.count}건 수집 완료`)
        fetchNews()
      } else {
        alert(data.msg || data.message || '수집 실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    } finally {
      setCollecting(false)
    }
  }

  const handleToggle = async (id: number) => {
    try {
      const res = await fetch(`/admin/labor-news/toggle/${id}`)
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        fetchNews()
      } else {
        alert(data.msg || data.message || '토글 실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/admin/labor-news/delete/${id}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        setNews(prev => prev.filter(n => n.id !== id))
      } else {
        alert(data.msg || data.message || '삭제 실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    }
  }

  if (authLoading) return <Loading />

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold mb-0">📋 노동뉴스 관리</h3>
        <a href="/admin/labor-news/create" className="btn btn-success">✏️ 직접 작성</a>
      </div>

      {/* URL Import + AI Suggest */}
      <div className="card border-0 shadow-sm mb-4 p-3">
        <div className="input-group">
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
            {importing ? '⏳ 가져오는 중...' : '🌐 가져오기 + AI 요약'}
          </button>
        </div>
        {importMsg && (
          <div className={`mt-2 small ${importMsgOk ? 'text-success' : 'text-danger'}`}>{importMsg}</div>
        )}
        <div className="mt-2">
          <button className="btn btn-outline-success btn-sm" onClick={handleAiSuggest} disabled={suggesting}>
            {suggesting ? '⏳ 생성 중...' : '🤖 AI 뉴스 추천'}
          </button>
          <button className="btn btn-outline-info btn-sm ms-1" onClick={handleCollect} disabled={collecting}>
            {collecting ? '⏳ 수집 중...' : '📰 10개 사이트 자동 수집'}
          </button>
          <small className="text-muted ms-2">매일 오전 6시 자동 수집 / 수동 수집 가능</small>
        </div>
      </div>

      {/* News Table */}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage message={error} onRetry={fetchNews} />
      ) : news.length === 0 ? (
        <div className="card border-0 shadow-sm">
          <div className="text-center py-5 text-muted">
            등록된 노동뉴스가 없습니다. AI 추천 또는 직접 작성해 주세요.
          </div>
        </div>
      ) : (
        <div className="card border-0 shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr className="text-center small">
                  <th style={{ width: '5%' }}>ID</th>
                  <th style={{ width: '25%' }}>제목</th>
                  <th style={{ width: '8%' }}>분류</th>
                  <th style={{ width: '15%' }}>AI 선정 이유</th>
                  <th style={{ width: '10%' }}>원본링크</th>
                  <th style={{ width: '8%' }}>등록일</th>
                  <th style={{ width: '12%' }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {news.map(item => (
                  <tr key={item.id} className="text-center">
                    <td className="text-muted">{item.id}</td>
                    <td className="text-start ps-3">
                      <div className="fw-bold text-dark">
                        {item.title.length > 60 ? item.title.slice(0, 60) + '...' : item.title}
                      </div>
                      <small className="text-muted">
                        {item.summary && item.summary.length > 80
                          ? item.summary.slice(0, 80) + '...'
                          : item.summary}
                      </small>
                    </td>
                    <td><span className="badge bg-secondary">{item.category}</span></td>
                    <td className="text-start small" style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.ai_reason || ''}>
                      {item.ai_reason ? (
                        <span className="text-success" title={item.ai_reason}>
                          💡 {item.ai_reason.length > 50 ? item.ai_reason.slice(0, 50) + '...' : item.ai_reason}
                        </span>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      {item.source_url ? (
                        <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">🔗 원문</a>
                      ) : (
                        <span className="text-muted small">-</span>
                      )}
                    </td>
                    <td className="small text-muted">
                      {item.created_at ? formatKST(item.created_at, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td>
                      <button className={`btn btn-sm ${item.is_selected ? 'btn-outline-success' : 'btn-outline-secondary'} me-1`} onClick={() => handleToggle(item.id)} title={item.is_selected ? '표시중' : '비활성'}>
                        {item.is_selected ? '👁️' : '🚫'}
                      </button>
                      <a href={`/admin/labor-news/edit/${item.id}`} className="btn btn-sm btn-outline-success me-1">편집</a>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(item.id)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="mt-3">
          <ul className="pagination justify-content-center">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <li key={p} className={`page-item ${p === page ? 'active' : ''}`}>
                <button className="page-link" onClick={() => setPage(p)}>{p}</button>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
