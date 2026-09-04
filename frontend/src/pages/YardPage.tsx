import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardItem {
  id: string; db_id: number; kind: 'post' | 'event'
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; author_name?: string
  like_count?: number; dislike_count?: number
  event_date?: string; created_at: string
}

interface YardDetail extends YardItem {
  embed_url?: string
  comments?: {
    id: number; user_id: number; author_name: string; content: string
    image_path?: string; link_url?: string
    like_count?: number; dislike_count?: number; created_at: string
  }[]
}

const platformBadge: Record<string, { label: string; cls: string }> = {
  facebook: { label: '📘 페이스북', cls: 'bg-primary' },
  kakao: { label: '💛 카카오', cls: 'bg-warning text-dark' },
  naverblog: { label: '📝 네이버블로그', cls: 'bg-success' },
  navercafe: { label: '💬 네이버카페', cls: 'bg-success' },
  event: { label: '🌾 마을행사', cls: 'bg-success' },
  manual: { label: '📢 직접 등록', cls: 'bg-secondary' },
  web: { label: '🌐 웹', cls: 'bg-info' },
}

function platformIcon(p?: string): string {
  if (p === 'facebook') return '📘'
  if (p === 'kakao') return '💛'
  if (p === 'naverblog') return '📝'
  if (p === 'navercafe') return '💬'
  if (p === 'event') return '🌾'
  return '📢'
}

export default function YardPage() {
  const [items, setItems] = useState<YardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [me, setMe] = useState<{ id: number } | null>(null)

  // 모달 상세
  const [detail, setDetail] = useState<YardDetail | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentLink, setCommentLink] = useState('')
  const [commentImage, setCommentImage] = useState<File | null>(null)
  const [sending, setSending] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/yard')
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => { if (d.id) setMe({ id: d.id }) }).catch(() => {})
  }, [])

  const filtered = items.filter(i =>
    filter === 'all' ? true : filter === 'event' ? i.kind === 'event' : i.kind === 'post' && i.platform === filter
  )

  const openDetail = (dbId: number) => {
    fetch(`/api/yard/${dbId}`)
      .then(r => r.json())
      .then(d => setDetail(d))
      .catch(() => {})
  }

  const vote = (it: YardItem, v: 'like' | 'dislike') => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (it.kind !== 'post') return
    fetch(`/api/yard/${it.db_id}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote: v }),
    })
      .then(r => r.json())
      .then(d => {
        if (d.status === 'success') {
          setItems(prev => prev.map(x => x.id === it.id ? { ...x, like_count: d.like_count, dislike_count: d.dislike_count } : x))
        } else alert(d.msg || '오류')
      })
      .catch(() => alert('오류가 발생했습니다.'))
  }

  const submitComment = async () => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (!commentText.trim() && !commentImage && !commentLink.trim()) return
    setSending(true)
    try {
      const fd = new FormData()
      if (commentText.trim()) fd.append('content', commentText.trim())
      if (commentLink.trim()) fd.append('link_url', commentLink.trim())
      if (commentImage) fd.append('image', commentImage)
      const res = await fetch(`/api/yard/${detail?.db_id}/comment`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        setCommentText(''); setCommentLink(''); setCommentImage(null)
        // 댓글 목록 갱신
        setDetail(prev => prev ? { ...prev, comments: [...(prev.comments || []), data.comment] } : prev)
      } else alert(data.msg || '등록 실패')
    } catch { alert('댓글 등록 오류') }
    setSending(false)
  }

  const deleteComment = async (cid: number) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return
    const res = await fetch(`/api/yard/comment/${cid}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.status === 'success') {
      setDetail(prev => prev ? { ...prev, comments: (prev.comments || []).filter(c => c.id !== cid) } : prev)
    } else alert(data.msg || '삭제 실패')
  }

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">🌾 마당</h3>
      <div className="alert alert-success small mb-4">
        <strong>양평 공동체의 소식 한 데 모임!</strong> 마을행사, 단체 공지, 지역 소식을 함께 모아 알려 드립니다.
        마음에 드는 소식에 좋아요를 누르고 댓글로 소통하세요.
      </div>

      {/* 필터 */}
      <div className="d-flex gap-2 flex-wrap mb-3">
        {[
          { key: 'all', label: '전체' },
          { key: 'event', label: '🌾 마을행사' },
          { key: 'naverblog', label: '📝 블로그' },
          { key: 'navercafe', label: '💬 카페' },
          { key: 'facebook', label: '📘 페이스북' },
          { key: 'kakao', label: '💛 카카오' },
          { key: 'manual', label: '📢 소식' },
        ].map(f => (
          <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted"><div className="spinner-border" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <div className="fs-1 mb-3">🌾</div>
          <p>아직 등록된 소식이 없습니다.</p>
        </div>
      ) : (
        <div className="row g-3 flex-nowrap flex-sm-wrap" style={{ overflowX: 'auto', paddingBottom: 4 }}>
          {filtered.map(it => {
            const badge = platformBadge[it.platform || ''] || platformBadge.manual
            return (
              <div key={it.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16, overflow: 'hidden' }}>
                  <div className="bg-light d-flex align-items-center justify-content-center" style={{ height: 120 }}>
                    <span style={{ fontSize: '2.5rem' }}>{platformIcon(it.kind === 'event' ? 'event' : it.platform)}</span>
                  </div>
                  <div className="card-body p-3 d-flex flex-column">
                    <div className="d-flex gap-1 flex-wrap mb-2">
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      {it.kind === 'event' && it.event_date && (
                        <span className="badge bg-success">📅 {it.event_date}</span>
                      )}
                    </div>
                    <h6 className="fw-bold mb-2" style={{ cursor: 'pointer' }}
                      onClick={() => { if (it.kind === 'post') openDetail(it.db_id); else if (it.source_url) window.location.href = it.source_url }}>
                      {it.title}
                    </h6>
                    <p className="small text-muted flex-grow-1 mb-2">{(it.content || '').substring(0, 120)}</p>
                    <div className="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
                      <small className="text-muted">👤 {it.author_name || '관리자'}</small>
                      {it.kind === 'post' && (
                        <div className="d-flex gap-1">
                          <button className="btn btn-sm btn-outline-success py-0" onClick={() => vote(it, 'like')}>👍 {it.like_count ?? 0}</button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={() => vote(it, 'dislike')}>👎 {it.dislike_count ?? 0}</button>
                        </div>
                      )}
                    </div>
                    <div className="d-flex justify-content-between align-items-center mt-1">
                      <small className="text-muted">{it.created_at ? formatKST(it.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
                      {it.kind === 'post' && (
                        <a className="small text-primary text-decoration-none" style={{ cursor: 'pointer' }}
                          onClick={() => openDetail(it.db_id)}>자세히 보기 →</a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 상세 모달 */}
      {detail && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content" style={{ borderRadius: 18 }}>
              <div className="modal-header">
                <div>
                  {detail.platform === 'facebook' && <span className="badge bg-primary me-1">📘 페이스북</span>}
                  {detail.platform === 'kakao' && <span className="badge bg-warning text-dark me-1">💛 카카오</span>}
                  {detail.platform === 'naverblog' && <span className="badge bg-success me-1">📝 네이버블로그</span>}
                  {detail.platform === 'navercafe' && <span className="badge bg-success me-1">💬 네이버카페</span>}
                  {detail.platform === 'web' && <span className="badge bg-info me-1">🌐 웹</span>}
                  <small className="text-muted ms-1">{detail.created_at ? formatKST(detail.created_at) : ''}</small>
                </div>
                <button type="button" className="btn-close" onClick={() => setDetail(null)} />
              </div>
              <div className="modal-body">
                <h5 className="fw-bold">{detail.title}</h5>
                {detail.author_name && <div className="small text-muted mb-2">👤 {detail.author_name}</div>}

                {detail.content && <div className="mb-3" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{detail.content}</div>}

                {/* SNS 공개 게시물 임베드 (인스타 제외 - 페이스북만 임베드 지원) */}
                {detail.embed_url ? (
                  <div className="d-flex justify-content-center my-3">
                    <iframe src={detail.embed_url} style={{ border: 'none', width: '100%', maxWidth: 500, height: 640, overflow: 'hidden' }}
                      scrolling="no" allowFullScreen title="SNS 게시물" />
                  </div>
                ) : null}

                {/* 원문/앱 바로가기 */}
                {detail.source_url && (
                  <div className="d-flex gap-2 my-3 flex-wrap">
                    <a href={detail.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-success btn-lg px-4">
                      ↗ {(detail.platform === 'naverblog' || detail.platform === 'navercafe') ? '게시물에서 보기' : '페이지에서 보기'}
                    </a>
                    {(detail.platform === 'facebook' || detail.platform === 'instagram' || detail.platform === 'kakao') && (
                      <a href={detail.source_url} target="_blank" rel="noopener noreferrer" className="btn btn-outline-success btn-lg px-4">
                        📱 앱으로 열기
                      </a>
                    )}
                  </div>
                )}

                <hr />

                {/* 댓글 */}
                <h6 className="fw-bold mb-3">💬 의견 ({detail.comments?.length || 0})</h6>
                {(detail.comments?.length || 0) === 0 ? (
                  <p className="text-center text-muted small py-3">아직 의견이 없습니다. 첫 의견을 남겨보세요.</p>
                ) : (
                  <div className="mb-3">
                    {detail.comments!.map(c => (
                      <div key={c.id} className="border-bottom pb-2 mb-2">
                        <div className="d-flex justify-content-between">
                          <strong className="small">{c.author_name || '익명'}</strong>
                          <div className="d-flex align-items-center gap-1">
                            <small className="text-muted">{c.created_at ? formatKST(c.created_at, { month: '2-digit', day: '2-digit' }) : ''}</small>
                            {(c.user_id === me?.id) && (
                              <button className="btn btn-sm btn-link text-danger p-0" style={{ fontSize: '0.75rem' }}
                                onClick={() => deleteComment(c.id)}>삭제</button>
                            )}
                          </div>
                        </div>
                        {c.content && <p className="mb-1 small" style={{ whiteSpace: 'pre-wrap' }}>{c.content}</p>}
                        {c.image_path && <img src={c.image_path} className="rounded mb-1" style={{ maxHeight: 200, maxWidth: '100%' }} />}
                        {c.link_url && (
                          <a href={c.link_url} target="_blank" rel="noopener noreferrer" className="d-inline-block small">
                            🔗 {c.link_url.length > 50 ? c.link_url.substring(0, 50) + '...' : c.link_url}
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* 댓글 작성 */}
                {me ? (
                  <form onSubmit={e => { e.preventDefault(); submitComment() }}>
                    <textarea className="form-control mb-2" rows={2} placeholder="의견을 남겨주세요."
                      value={commentText} onChange={e => setCommentText(e.target.value)} />
                    <div className="d-flex gap-2 mb-2 flex-wrap">
                      <input type="file" accept="image/*" className="form-control form-control-sm" style={{ maxWidth: 200 }}
                        onChange={e => setCommentImage(e.target.files?.[0] || null)} />
                      <input type="url" className="form-control form-control-sm" placeholder="링크 (선택)"
                        value={commentLink} onChange={e => setCommentLink(e.target.value)} style={{ maxWidth: 220 }} />
                      <button type="submit" className="btn btn-sm btn-success" disabled={sending}>
                        {sending ? '⏳ 등록 중...' : '등록'}
                      </button>
                    </div>
                    {commentImage && <small className="text-success">📷 {commentImage.name}</small>}
                  </form>
                ) : (
                  <div className="alert alert-light small text-center">의견 등록은 로그인 후 이용할 수 있습니다.</div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setDetail(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
