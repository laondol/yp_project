import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format'

interface NewsItem {
  id: number
  title: string
  summary?: string
  source_name?: string
  source_url?: string
  category?: string
  image_path?: string
  ai_score?: number
  like_count?: number
  dislike_count?: number
  created_at?: string
  published_at?: string
}

const TABS = [
  { key: 'world', label: '🌍 세계와양평' },
  { key: 'kr_yp', label: '🇰🇷 대한민국과양평' },
  { key: '', label: '📰 전체' },
]

export default function NewsTabsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const tabFromPath = location.pathname.includes('world') ? 'world' : 'kr_yp'
  const [tab, setTab] = useState(tabFromPath)
  useEffect(() => { setTab(tabFromPath) }, [location.pathname])
  const [articles, setArticles] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const [winWidth, setWinWidth] = useState(window.innerWidth)
  useEffect(() => {
    const onResize = () => setWinWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const maxVisible = winWidth < 500 ? 5 : winWidth < 768 ? 7 : 9

  const pageRange = (current: number, total: number) => {
    if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1)
    const half = Math.floor((maxVisible - 2) / 2)
    const pages: (number | '...')[] = [1]
    const start = Math.max(2, current - half)
    const end = Math.min(total - 1, current + half)
    if (start > 2) pages.push('...')
    for (let i = start; i <= end; i++) pages.push(i)
    if (end < total - 1) pages.push('...')
    pages.push(total)
    return pages
  }

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams()
      if (tab) params.set('category', tab)
      params.set('page', String(page))
      const res = await fetch(`/api/news?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data && data.items) {
        setArticles(data.items)
        setTotalPages(data.pages || 1)
        setTotal(data.total || 0)
      } else {
        setArticles(Array.isArray(data) ? data : [])
        setTotalPages(1)
        setTotal(Array.isArray(data) ? data.length : 0)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [tab, page])

  useEffect(() => { setPage(1) }, [tab])
  useEffect(() => { load() }, [load])

  const handleVote = async (id: number, vote: 'like' | 'dislike') => {
    try {
      const res = await fetch(`/news/${vote}/${id}`, { method: 'POST', credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success') {
        setArticles(prev => prev.map(a => a.id === id ? {
          ...a,
          like_count: data.likes ?? a.like_count,
          dislike_count: data.dislikes ?? a.dislike_count,
        } : a))
      }
    } catch { /* ignore */ }
  }

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold mb-0">📰 소식</h3>
        <small className="text-muted">{total}건</small>
      </div>

      <ul className="nav nav-tabs mb-4">
        {TABS.map(t => (
          <li className="nav-item" key={t.key}>
            <button className={`nav-link ${tab === t.key ? 'active fw-bold' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage message={error} onRetry={load} />
      ) : articles.length === 0 ? (
        <div className="text-center py-5 text-muted">등록된 뉴스가 없습니다.</div>
      ) : (
        <>
          <div className="row g-4 row-cols-1 row-cols-md-2 row-cols-lg-3">
            {articles.map(a => (
              <div className="col" key={a.id}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 18, overflow: 'hidden', cursor: 'pointer' }}
                  onClick={() => navigate(`/news/${a.id}`)}>
                  {a.image_path && (
                    <img src={a.image_path} className="card-img-top" style={{ height: 180, objectFit: 'cover' }} alt={a.title} />
                  )}
                  <div className="card-body d-flex flex-column">
                    <span className="badge bg-success-subtle text-success align-self-start mb-2">{a.category}</span>
                    <h6 className="fw-bold card-title mb-2">{a.title}</h6>
                    <p className="small text-muted flex-grow-1">
                      {a.summary ? (a.summary.length > 120 ? a.summary.slice(0, 120) + '...' : a.summary) : ''}
                    </p>
                    <small className="text-muted d-block mb-1">
                      {a.published_at ? `개재 ${formatKST(a.published_at)}` : ''}
                      {a.published_at && a.created_at ? ' · ' : ''}
                      {a.created_at ? `수집 ${formatKST(a.created_at)}` : ''}
                    </small>
                    <div className="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
                      <small className="text-muted">{a.source_name || ''}</small>
                      <div className="d-flex gap-1" onClick={e => e.stopPropagation()}>
                        <button className="btn btn-sm btn-outline-success py-0" onClick={() => handleVote(a.id, 'like')}>
                          👍 {a.like_count ?? 0}
                        </button>
                        <button className="btn btn-sm btn-outline-danger py-0" onClick={() => handleVote(a.id, 'dislike')}>
                          👎 {a.dislike_count ?? 0}
                        </button>
                      </div>
                    </div>
                    <div className="d-flex gap-2 mt-2" onClick={e => e.stopPropagation()}>
                      <a className="btn btn-sm btn-outline-secondary py-0 flex-grow-1 text-decoration-none"
                        href={(a.source_url && a.source_url.trim()) || ('https://search.naver.com/search.naver?query=' + encodeURIComponent(a.title || ''))}
                        target="_blank" rel="noopener noreferrer">
                        🔗 원문보기
                      </a>
                      <button className="btn btn-sm btn-outline-info py-0 flex-grow-1" onClick={() => navigate(`/news/${a.id}`)}>
                        💬 자세히보기
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <nav className="mt-4">
              <ul className="pagination justify-content-center flex-nowrap" style={{ overflowX: 'auto' }}>
                <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setPage(p => Math.max(1, p - 1))}>◀</button>
                </li>
                {pageRange(page, totalPages).map((pg, i) =>
                  pg === '...' ? <li key={`e${i}`} className="page-item disabled"><span className="page-link">...</span></li> :
                  <li key={pg} className={`page-item ${pg === page ? 'active' : ''}`}>
                    <button className="page-link" onClick={() => setPage(pg)}>{pg}</button>
                  </li>
                )}
                <li className={`page-item ${page >= totalPages ? 'disabled' : ''}`}>
                  <button className="page-link" onClick={() => setPage(p => Math.min(totalPages, p + 1))}>▶</button>
                </li>
              </ul>
            </nav>
          )}
        </>
      )}
    </div>
  )
}
