import { useState, useEffect } from 'react'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format';

interface NewsItem {
  id: number
  title: string
  summary: string
  category: string
  source_url: string
  ai_reason: string
  ai_generated: boolean
  ai_approved: boolean
  admin_approved: boolean
  is_selected: boolean
  created_at: string
  published_at?: string
  ai_score?: number
  source_name?: string
}

const TABS = [
  { key: 'all', label: '전체' },
  { key: 'world', label: '🌍 세계와양평' },
  { key: 'kr_yp', label: '🇰🇷 대한민국과양평' },
]

type TabKey = 'all' | 'world' | 'kr_yp'

export default function AdminNews() {
  const [tab, setTab] = useState<TabKey>('all')
  const [news, setNews] = useState<NewsItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [catMenu, setCatMenu] = useState<{ x: number; y: number } | null>(null)
  const [sourceFilter, setSourceFilter] = useState('')
  const [sources, setSources] = useState<string[]>([])
  const [srcMenu, setSrcMenu] = useState<{ x: number; y: number } | null>(null)
  const [totalPages, setTotalPages] = useState(1)
  const [importUrl, setImportUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState('')
  const [importMsgOk, setImportMsgOk] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const [suggesting, setSuggesting] = useState(false)

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

  const fetchNews = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/news?tab=${tab}&page=${page}${categoryFilter ? `&category=${encodeURIComponent(categoryFilter)}` : ''}${sourceFilter ? `&source=${encodeURIComponent(sourceFilter)}` : ''}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setNews(data.items ?? [])
      setTotalPages(data.total_pages ?? 1)
      setCategories(data.categories ?? [])
      setSources(data.sources ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setPage(1)
  }, [tab])

  useEffect(() => {
    fetchNews()
  }, [tab, page, categoryFilter, sourceFilter])

  const handleImportUrl = async () => {
    if (!importUrl.trim()) return
    setImporting(true)
    setImportMsg('')
    try {
      const formData = new FormData()
      formData.append('url', importUrl)
      formData.append('tab', tab)
      const res = await fetch('/admin/news/import-url', { method: 'POST', body: formData })
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

  const handleCleanCjk = async () => {
    if (!confirm('선택한 탭의 모든 뉴스에서 깨진 글자와 어색한 문장을 정리하시겠습니까?\nGroq API를 사용하므로 시간이 소요될 수 있습니다.')) return
    setCleaning(true)
    try {
      const res = await fetch('/admin/news/clean-cjk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tab=${tab}`,
      })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        alert(data.msg || '정리 완료')
        fetchNews()
      } else {
        alert(data.msg || data.message || '정리 실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    } finally {
      setCleaning(false)
    }
  }

  const handleAiSuggest = async () => {
    setSuggesting(true)
    try {
      const res = await fetch('/admin/news/ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `tab=${tab}`,
      })
      const data = await res.json()
      if (data.status === 'success' || data.success) {
        alert(data.msg || `✅ ${data.count}개의 실제 뉴스를 가져왔습니다.`)
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
      const res = await fetch('/admin/news/collect', { method: 'POST' })
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

  const handleCollectWorld = async () => {
    setCollecting(true)
    try {
      const res = await fetch('/admin/news/collect-world', { method: 'POST' })
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

  const handleApproveAll = async () => {
    const ids = news.map(n => n.id)
    if (ids.length === 0) return
    // 화면 즉시 반영 (AI 채택 여부와 무관하게 관리 채택)
    setNews(prev => prev.map(n => ids.includes(n.id) ? { ...n, admin_approved: true } : n))
    try {
      const res = await fetch('/admin/news/approve-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, category: categoryFilter, source: sourceFilter, value: true, ids }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        await fetchNews()
      } else {
        alert(data.msg || '실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    }
  }

  const handleApproveAllAI = async () => {
    const ids = news.map(n => n.id)
    if (ids.length === 0) return
    setNews(prev => prev.map(n => ids.includes(n.id) ? { ...n, ai_approved: true } : n))
    try {
      const res = await fetch('/admin/news/approve-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tab, category: categoryFilter, source: sourceFilter, value: true, approver: 'ai', ids }),
      })
      const data = await res.json()
      if (data.status === 'success') {
        await fetchNews()
      } else {
        alert(data.msg || '실패')
      }
    } catch {
      alert('오류가 발생했습니다.')
    }
  }

  const [translating, setTranslating] = useState(false)
  const [translateMsg, setTranslateMsg] = useState('')

  const handleTranslateUntranslated = async () => {
    if (translating) return
    setTranslating(true)
    setTranslateMsg('번역 시작 중...')
    try {
      const res = await fetch('/admin/news/translate-untranslated', { method: 'POST' })
      const data = await res.json()
      if (data.status !== 'success') {
        alert(data.msg || '시작 실패')
        setTranslating(false)
        return
      }
      // 백그라운드 진행 상황 폴링
      let lastRemain = -1
      let stallCount = 0
      for (let i = 0; i < 400; i++) {
        await new Promise(r => setTimeout(r, 3000))
        const st = await fetch('/admin/news/translate-status').then(r => r.json())
        setTranslateMsg(`번역 중… 남은 ${st.remaining ?? '?'}건 (완료 ${st.done ?? 0}건)`)
        if ((st.remaining ?? 0) === 0) {
          setTranslateMsg('')
          alert(`✅ 번역 완료 (완료 ${st.done}건, 실패 ${st.failed}건)`)
          break
        }
        // 진행이 멈춘 경우(같은 남은 건수가 10회 연속) 종료
        stallCount = (st.remaining === lastRemain) ? stallCount + 1 : 0
        lastRemain = st.remaining
        if (stallCount >= 10) {
          setTranslateMsg('')
          alert(`번역이 멈췄습니다. 남은 ${st.remaining}건 — 다시 실행해 주세요.`)
          break
        }
      }
      fetchNews()
    } catch {
      alert('오류가 발생했습니다.')
    } finally {
      setTranslating(false)
    }
  }

  const [showSources, setShowSources] = useState(false)
  const [sourceList, setSourceList] = useState<any[]>([])
  const [nsKind, setNsKind] = useState('world')
  const [nsName, setNsName] = useState('')
  const [nsDomain, setNsDomain] = useState('')
  const [nsQ, setNsQ] = useState('')
  const [nsCategory, setNsCategory] = useState('')
  const [nsLang, setNsLang] = useState('en')
  const [nsMax, setNsMax] = useState(3)

  const loadSources = async () => {
    const d = await fetch('/admin/news/sources').then(r => r.json()).catch(() => ({}))
    setSourceList(d.items || [])
  }
  const toggleSources = async () => {
    const next = !showSources
    setShowSources(next)
    if (next) await loadSources()
  }
  const addSource = async () => {
    if (!nsName.trim()) { alert('이름을 입력하세요.'); return }
    const res = await fetch('/admin/news/sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: nsKind, name: nsName.trim(), domain: nsDomain.trim(), q: nsQ.trim(),
        category: nsCategory.trim(), lang: nsLang, max_items: nsMax }),
    })
    const d = await res.json().catch(() => ({}))
    if (d.status === 'success') {
      setNsName(''); setNsDomain(''); setNsQ(''); setNsCategory('')
      await loadSources()
    } else alert(d.msg || '추가 실패')
  }
  const delSource = async (id: number) => {
    if (!window.confirm('이 소스를 삭제할까요? (앞으로 수집하지 않습니다)')) return
    await fetch(`/admin/news/sources/${id}`, { method: 'DELETE' })
    await loadSources()
  }
  const toggleSource = async (id: number, enabled: boolean) => {
    await fetch(`/admin/news/sources/${id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !enabled }),
    })
    await loadSources()
  }

  const handleApprove = async (id: number, approver: 'ai' | 'admin') => {
    setNews(prev => prev.map(n => n.id === id ? { ...n, [approver === 'ai' ? 'ai_approved' : 'admin_approved']: !n[approver === 'ai' ? 'ai_approved' : 'admin_approved'] } : n))
    try {
      const res = await fetch(`/admin/news/approve/${id}/${tab}/${approver}`)
      const data = await res.json()
      if (!(data.status === 'success' || data.success)) {
        setNews(prev => prev.map(n => n.id === id ? { ...n, [approver === 'ai' ? 'ai_approved' : 'admin_approved']: !n[approver === 'ai' ? 'ai_approved' : 'admin_approved'] } : n))
        alert(data.msg || data.message || '승인 처리 실패')
      }
    } catch {
      setNews(prev => prev.map(n => n.id === id ? { ...n, [approver === 'ai' ? 'ai_approved' : 'admin_approved']: !n[approver === 'ai' ? 'ai_approved' : 'admin_approved'] } : n))
      alert('오류가 발생했습니다.')
    }
  }

  const handleToggle = async (id: number) => {
    try {
      const res = await fetch(`/admin/news/toggle/${id}`)
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
      const res = await fetch(`/admin/news/delete/${id}`, { method: 'POST' })
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

  return (
    <div className="container mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold mb-0">📰 AI 뉴스 큐레이션</h3>
        <a href="/admin/news/create" className="btn btn-success">✏️ 직접 작성</a>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {TABS.map(t => (
          <li key={t.key} className="nav-item">
            <button
              className={`nav-link ${tab === t.key ? 'active fw-bold' : ''}`}
              onClick={() => setTab(t.key as TabKey)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-3">
        <button className="btn btn-outline-primary btn-sm" onClick={handleTranslateUntranslated} disabled={translating}>
          {translating ? '⏳ 번역 중...' : '🌐 미번역 일괄 번역(백그라운드)'}
        </button>
        {translateMsg && <span className="small text-muted ms-2">{translateMsg}</span>}
      </div>

      <div className="mb-3">
        <button className="btn btn-outline-secondary btn-sm" onClick={toggleSources}>
          🗂️ 수집 소스 관리 {showSources ? '▲' : '▼'}
        </button>
        {showSources && (
          <div className="card border-0 shadow-sm mt-2 p-3">
            <div className="table-responsive" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table className="table table-sm align-middle mb-2">
                <thead><tr><th>구분</th><th>이름</th><th>도메인/검색어</th><th>사용</th><th>삭제</th></tr></thead>
                <tbody>
                  {sourceList.map(src => (
                    <tr key={src.id}>
                      <td className="small text-muted">{src.kind}</td>
                      <td className="small">{src.name}</td>
                      <td className="small text-truncate" style={{ maxWidth: 220 }}>{src.domain || src.q}</td>
                      <td><input type="checkbox" checked={!!src.enabled} onChange={() => toggleSource(src.id, src.enabled)} /></td>
                      <td><button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => delSource(src.id)}>🗑️</button></td>
                    </tr>
                  ))}
                  {sourceList.length === 0 && <tr><td colSpan={5} className="text-center text-muted small">소스가 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="d-flex gap-2 flex-wrap align-items-center border-top pt-2">
              <select className="form-select form-select-sm" style={{ maxWidth: 110 }} value={nsKind} onChange={e => setNsKind(e.target.value)}>
                <option value="world">world</option><option value="local">local</option>
                <option value="official">official</option><option value="kr_yp">kr_yp</option>
              </select>
              <input className="form-control form-control-sm" style={{ maxWidth: 130 }} placeholder="이름" value={nsName} onChange={e => setNsName(e.target.value)} />
              <input className="form-control form-control-sm" style={{ maxWidth: 180 }} placeholder="도메인 (예: example.com)" value={nsDomain} onChange={e => setNsDomain(e.target.value)} />
              <input className="form-control form-control-sm" style={{ maxWidth: 170 }} placeholder="검색어(선택)" value={nsQ} onChange={e => setNsQ(e.target.value)} />
              <input className="form-control form-control-sm" style={{ maxWidth: 110 }} placeholder="분류" value={nsCategory} onChange={e => setNsCategory(e.target.value)} />
              <select className="form-select form-select-sm" style={{ maxWidth: 90 }} value={nsLang} onChange={e => setNsLang(e.target.value)}>
                <option value="en">영어</option><option value="ko">한국어</option>
              </select>
              <input type="number" className="form-control form-control-sm" style={{ maxWidth: 80 }} min={1} max={10} value={nsMax} onChange={e => setNsMax(Number(e.target.value))} />
              <button className="btn btn-sm btn-primary" onClick={addSource}>+ 추가</button>
            </div>
          </div>
        )}
      </div>

      {/* URL Import + Action Buttons (hidden on 'all' tab) */}
      {tab !== 'all' && (
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
            {tab === 'world' && (
              <button className="btn btn-outline-success btn-sm" onClick={handleAiSuggest} disabled={suggesting}>
                {suggesting ? '⏳ 생성 중...' : '🤖 세계와양평 AI 추천'}
              </button>
            )}
            <button className="btn btn-outline-warning btn-sm" onClick={handleCleanCjk} disabled={cleaning}>
              {cleaning ? '⏳ 정리 중...' : '🗣️ 깨진 글자 정리'}
            </button>
            {tab === 'kr_yp' && (
              <button className="btn btn-outline-info btn-sm ms-1" onClick={handleCollect} disabled={collecting}>
                {collecting ? '⏳ 수집 중...' : '📰 대한민국·양평 자동 수집'}
              </button>
            )}
            {tab === 'world' && (
              <button className="btn btn-outline-info btn-sm ms-1" onClick={handleCollectWorld} disabled={collecting}>
                {collecting ? '⏳ 수집 중...' : '🌍 세계 뉴스 자동 수집'}
              </button>
            )}
            <small className="text-muted ms-2">
              {tab === 'world' ? '🌐 영문 검색 → 해외 기사 중심' : '🇰🇷 국내 검색 → 한국 뉴스 중심'} (자동 가져오기)
            </small>
          </div>
        </div>
      )}

      {/* News Table */}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorMessage message={error} onRetry={fetchNews} />
      ) : news.length === 0 ? (
        <div className="card border-0 shadow-sm">
          <div className="text-center py-5 text-muted">
            등록된 뉴스가 없습니다. AI 추천 또는 직접 작성해 주세요.
          </div>
        </div>
      ) : (
        <div className="card border-0 shadow-sm">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr className="text-center small">
                  <th style={{ width: '5%' }}>ID</th>
                  <th style={{ width: '22%' }}>제목</th>
                  <th style={{ width: '9%', cursor: 'pointer' }} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setSrcMenu(prev => prev ? null : { x: r.left, y: r.bottom + 2 }) }} title="출처별 보기">출처 {sourceFilter ? `(${sourceFilter})` : '▾'}</th>
                  <th style={{ width: '7%', cursor: 'pointer' }} onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setCatMenu(prev => prev ? null : { x: r.left, y: r.bottom + 2 }) }} title="분류별 보기">분류 {categoryFilter ? `(${categoryFilter})` : '▾'}</th>
                  <th style={{ width: '12%' }}>기사 날짜</th>
                  <th style={{ width: '8%' }}>원본링크</th>
                  <th style={{ width: '4%' }}>AI</th>
                  <th style={{ width: '18%' }}>채자(AI) <input type="checkbox" checked={news.length > 0 && news.every(n => !!n.ai_approved)} onChange={handleApproveAllAI} title="현재 페이지 AI 전체 채택" /></th>
                  <th style={{ width: '10%' }}>채자(관리) <input type="checkbox" checked={news.length > 0 && news.every(n => !!n.admin_approved)} onChange={handleApproveAll} title="현재 페이지 전체 채택" /></th>
                  <th style={{ width: '10%' }}>관리</th>
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
                    <td className="small text-truncate" style={{ maxWidth: 120 }} title={item.source_name || ''}>
                      {item.source_name ? (
                        <span style={{ cursor: 'pointer' }} onClick={() => { setSourceFilter(item.source_name || ''); setPage(1) }}>{item.source_name}</span>
                      ) : (<span className="text-muted">-</span>)}
                    </td>
                    <td><span className="badge bg-secondary" style={{ cursor: 'pointer' }} onClick={() => { setCategoryFilter(item.category); setPage(1) }} title="이 분류만 보기">{item.category}</span></td>
                    <td className="text-start small" style={{ whiteSpace: 'nowrap' }}>
                      {item.published_at || item.created_at ? (
                        <div>
                          <div className="text-dark">
                            📅 {formatKST((item.published_at || item.created_at) as string, { year: '2-digit', month: '2-digit', day: '2-digit' })}
                          </div>
                          <div className="text-muted">
                            {formatKST((item.published_at || item.created_at) as string, { hour: '2-digit', minute: '2-digit' })}
                            {typeof item.ai_score === 'number' && item.ai_score > 0 && (
                              <span className="badge bg-success ms-1">{item.ai_score}점</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">-</span>
                      )}
                    </td>
                    <td>
                      {item.source_url ? (
                        <div className="d-flex gap-1 justify-content-center">
                          <a href={item.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-sm btn-outline-primary">🔗 원문</a>
                        </div>
                      ) : (
                        <span className="text-muted small">-</span>
                      )}
                    </td>
                    <td>{item.ai_generated ? '🤖' : '✏️'}</td>
                    <td className="small text-start" style={{ maxWidth: 220 }}>
                      <div className="d-flex align-items-start gap-1">
                        <span className={`badge ${((item.ai_score ?? 0) >= 60) ? 'bg-success' : 'bg-secondary'}`} style={{ flexShrink: 0 }}>
                          {item.ai_score ?? 0}점
                        </span>
                        <span className="text-muted" title={item.ai_reason || ''} style={{ lineHeight: 1.3 }}>
                          {(item.ai_reason || '-').replace(/^\[선별 \d+\]\s*/, '').slice(0, 45)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <button
                        className={`btn btn-sm ${item.admin_approved ? 'btn-primary' : 'btn-outline-secondary'}`}
                        style={{ minWidth: 44 }}
                        onClick={() => handleApprove(item.id, 'admin')}
                      >
                        {item.admin_approved ? '✅' : '⭕'}
                      </button>
                    </td>
                    <td>
                      <button className={`btn btn-sm ${item.is_selected ? 'btn-outline-success' : 'btn-outline-secondary'} me-1`} onClick={() => handleToggle(item.id)} title={item.is_selected ? '표시중' : '비활성'}>
                        {item.is_selected ? '👁️' : '🚫'}
                      </button>
                      <a href={`/admin/news/edit/${item.id}`} className="btn btn-sm btn-outline-success me-1">편집</a>
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
      {srcMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1040 }} onClick={() => setSrcMenu(null)} />
          <div
            className="bg-white border rounded shadow"
            style={{ position: 'fixed', top: srcMenu.y, left: srcMenu.x, minWidth: 180, maxHeight: 260, overflowY: 'auto', zIndex: 1050 }}
            onClick={e => e.stopPropagation()}>
            <button className={`dropdown-item ${sourceFilter === '' ? 'active' : ''}`}
              onClick={() => { setSourceFilter(''); setPage(1); setSrcMenu(null) }}>전체</button>
            {sources.map(c => (
              <button key={c} className={`dropdown-item ${sourceFilter === c ? 'active' : ''}`}
                onClick={() => { setSourceFilter(c); setPage(1); setSrcMenu(null) }}>{c}</button>
            ))}
          </div>
        </>
      )}
      {catMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 1040 }} onClick={() => setCatMenu(null)} />
          <div
            className="bg-white border rounded shadow"
            style={{ position: 'fixed', top: catMenu.y, left: catMenu.x, minWidth: 160, maxHeight: 260, overflowY: 'auto', zIndex: 1050 }}
            onClick={e => e.stopPropagation()}>
            <button
              className={`dropdown-item ${categoryFilter === '' ? 'active' : ''}`}
              onClick={() => { setCategoryFilter(''); setPage(1); setCatMenu(null) }}>
              전체
            </button>
            {categories.map(c => (
              <button key={c}
                className={`dropdown-item ${categoryFilter === c ? 'active' : ''}`}
                onClick={() => { setCategoryFilter(c); setPage(1); setCatMenu(null) }}>
                {c}
              </button>
            ))}
          </div>
        </>
      )}

    </div>
  )
}
