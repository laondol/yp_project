import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardExtraSchedule {
  id: number; display: string
  event_start_iso?: string; event_end_iso?: string; is_allday?: boolean
}

interface YardItem {
  id: string; db_id: number; kind: 'post' | 'event'
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; reserve_url?: string; author_name?: string
  contact?: string
  like_count?: number; dislike_count?: number
  event_date?: string; event_date_display?: string; event_date_iso?: string; event_end_iso?: string
  event_place?: string
  apply_display?: string
  repeat_text?: string; repeat_type?: string
  repeat_weekdays?: number; repeat_week_of_month?: number; repeat_days?: string
  repeat_weeks?: string
  repeat_start?: string; repeat_end?: string
  repeat_next_list?: string[]
  extra_schedules?: YardExtraSchedule[]
  distance_km?: number | null
  created_at: string
}

interface YardComment {
  id: number; user_id: number; author_name: string; content: string
  image_path?: string; link_url?: string
  like_count?: number; dislike_count?: number; created_at: string
}

export default function YardPage() {
  const [items, setItems] = useState<YardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [me, setMe] = useState<{ id: number } | null>(null)

  // 댓글 모달
  const [commentPost, setCommentPost] = useState<YardItem | null>(null)
  const [comments, setComments] = useState<YardComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentLink, setCommentLink] = useState('')
  const [commentImage, setCommentImage] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [addedSchedule, setAddedSchedule] = useState<Record<string, boolean>>({})

  const load = (lat?: number, lng?: number) => {
    setLoading(true)
    const qs = lat && lng ? `?lat=${lat}&lng=${lng}` : ''
    fetch(`/api/yard${qs}`)
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => { if (d.id) setMe({ id: d.id }) }).catch(() => {})
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { load(pos.coords.latitude, pos.coords.longitude) },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }, [])

  const filtered = items.filter(i =>
    filter === 'all' ? true : filter === 'event' ? i.kind === 'event' : i.kind === 'post' && i.platform === filter
  )

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

  // 반복 일정을 내 일정에 등록 (앵커 날짜 수만큼 생성)
  const addRecurringSchedule = async (it: YardItem) => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    const anchors = it.repeat_next_list || []
    if (!anchors.length) { alert('다음 일정을 계산할 수 없습니다. 일시를 확인해 주세요.'); return }
    const rt = it.repeat_type || ''
    const mask = it.repeat_weekdays || 0
    try {
      const schedules: { repeat_type: string; repeat_weekdays: number; repeat_week_of_month: number }[] = []
      if (rt === 'weekly') {
        schedules.push({ repeat_type: 'weekly', repeat_weekdays: mask, repeat_week_of_month: 0 })
      } else if (rt === 'monthly_week') {
        // 복수 주 지원: 선택한 각 주(첫째·셋째주 등)마다 반복 일정 1건
        const weeks = (it.repeat_weeks || '0').split(',').filter(Boolean).map((x: string) => Number(x))
        weeks.forEach(w => schedules.push({ repeat_type: 'monthly', repeat_weekdays: mask, repeat_week_of_month: w }))
      } else if (rt === 'monthly_day') {
        schedules.push({ repeat_type: 'monthly', repeat_weekdays: 0, repeat_week_of_month: 0 })
      }
      for (const anchorIso of anchors) {
        const endDate = it.repeat_end ? `${anchorIso.slice(0, 10)}T${it.repeat_end}` : ''
        const isAllday = !it.repeat_start
        const timeSuffix = isAllday ? '' : `T${it.repeat_start || '00:00'}`
        for (const sched of schedules) {
          // monthly_day: 앵커 날짜의 일자가 곧 반복 기준일
          const anchorDate = sched.repeat_type === 'monthly' && sched.repeat_weekdays === 0
            ? `${anchorIso.slice(0, 10)}${timeSuffix}` : anchorIso
          const body: any = {
            title: it.title,
            description: `[마당 반복] ${it.repeat_text || ''}`,
            event_date: anchorDate,
            end_date: endDate,
            location: it.event_place || '',
            is_recurring: true,
            repeat_infinite: true,
            is_allday: isAllday && sched.repeat_type === 'monthly',
            repeat_type: sched.repeat_type,
            repeat_weekdays: sched.repeat_weekdays,
            repeat_week_of_month: sched.repeat_week_of_month,
            repeat_interval: 1,
          }
          const res = await fetch('/api/bot/schedule', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          })
          if (res.status === 401) { alert('로그인 후 이용하세요.'); return }
        }
      }
      setAddedSchedule(prev => ({ ...prev, [`r${it.db_id}`]: true }))
      window.open(`/schedule-popup?date=${anchors[0].slice(0, 10)}`, 'schedulePopup', 'width=920,height=760')
    } catch { alert('오류가 발생했습니다.') }
  }

  // 댓글 모달 열기
  const openComments = (it: YardItem) => {
    setCommentPost(it)
    setCommentsLoading(true)
    fetch(`/api/yard/${it.db_id}`)
      .then(r => r.json())
      .then(d => setComments(d.comments || []))
      .catch(() => {})
      .finally(() => setCommentsLoading(false))
  }

  const submitComment = async () => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (!commentPost) return
    if (!commentText.trim() && !commentImage && !commentLink.trim()) return
    setSending(true)
    try {
      const fd = new FormData()
      if (commentText.trim()) fd.append('content', commentText.trim())
      if (commentLink.trim()) fd.append('link_url', commentLink.trim())
      if (commentImage) fd.append('image', commentImage)
      const res = await fetch(`/api/yard/${commentPost.db_id}/comment`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        setCommentText(''); setCommentLink(''); setCommentImage(null)
        setComments(prev => [...prev, data.comment])
      } else alert(data.msg || '등록 실패')
    } catch { alert('댓글 등록 오류') }
    setSending(false)
  }

  const deleteComment = async (cid: number) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/yard/comment/${cid}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') {
        setComments(prev => prev.filter(c => c.id !== cid))
      } else alert(data.msg || '삭제 실패')
    } catch { alert('삭제 오류') }
  }

  // 내일정에 추가 (TongBotSchedule 연동) - 일정 수만큼 버튼 표시
  const addToSchedule = async (key: string, title: string, startIso: string, endIso: string, place: string, allday: boolean) => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (!startIso) { alert('행사 일시 정보가 없습니다.'); return }
    try {
      const res = await fetch('/api/bot/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: `[마당] ${place || ''} 소식`,
          event_date: startIso,
          end_date: endIso || '',
          location: place || '',
          is_allday: allday,
        }),
      })
      const data = await res.json()
      if (res.status === 401) { alert('로그인 후 이용하세요.'); return }
      if (data.id || data.status === 'success') {
        setAddedSchedule(prev => ({ ...prev, [key]: true }))
        // 기존 일정 팝업 창을 해당 날짜로 열기 (페이지는 그대로 유지)
        window.open(`/schedule-popup?date=${startIso.slice(0, 10)}`, 'schedulePopup', 'width=920,height=760')
      } else alert(data.error || data.msg || '추가 실패')
    } catch { alert('오류가 발생했습니다.') }
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
        <div className="row g-3">
          {filtered.map(it => {
            return (
              <div key={it.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
                  <div className="card-body p-3 d-flex flex-column">
                    {/* 제목 (맨위) */}
                    <h6 className="fw-bold mb-2">{it.title}</h6>

                    {/* 반복 일정 */}
                    {it.repeat_text && (
                      <div className="small mb-1 d-flex justify-content-between align-items-center">
                        <span>🔁 {it.repeat_text}</span>
                        {it.kind === 'post' && it.repeat_type !== 'tbd' && !addedSchedule[`r${it.db_id}`] && (
                          <button className="btn btn-sm btn-outline-warning py-0" style={{ fontSize: '0.7rem' }}
                            onClick={() => addRecurringSchedule(it)}>
                            📅 내일정 추가
                          </button>
                        )}
                        {addedSchedule[`r${it.db_id}`] && <span className="text-success" style={{ fontSize: '0.7rem' }}>✅ 추가됨</span>}
                      </div>
                    )}

                    {/* 1차 일정 + 내일정 버튼 (반복 일정이 없을 때만 버튼 표시) */}
                    {it.event_date_display && (
                      <div className="small mb-1 d-flex justify-content-between align-items-center">
                        <span>📅 {it.event_date_display}</span>
                        {it.kind === 'post' && !it.repeat_text && it.event_date_iso && !addedSchedule[it.id] && (
                          <button className="btn btn-sm btn-outline-warning py-0" style={{ fontSize: '0.7rem' }}
                            onClick={() => addToSchedule(it.id, it.title, it.event_date_iso!, it.event_end_iso || '', it.event_place || '', !!(it as any).is_allday)}>
                            📅 내일정 추가
                          </button>
                        )}
                        {addedSchedule[it.id] && <span className="text-success" style={{ fontSize: '0.7rem' }}>✅ 추가됨</span>}
                      </div>
                    )}

                    {/* 추가 일정 (1차 일정 바로 밑, 일정 수만큼 내일정 버튼) */}
                    {(it.extra_schedules || []).map(s => (
                      <div key={`s${s.id}`} className="small mb-1 d-flex justify-content-between align-items-center">
                        <span>📅 {s.display}</span>
                        {s.event_start_iso && !addedSchedule[`s${s.id}`] && (
                          <button className="btn btn-sm btn-outline-warning py-0" style={{ fontSize: '0.7rem' }}
                            onClick={() => addToSchedule(`s${s.id}`, it.title, s.event_start_iso!, s.event_end_iso || '', it.event_place || '', !!s.is_allday)}>
                            📅 내일정 추가
                          </button>
                        )}
                        {addedSchedule[`s${s.id}`] && <span className="text-success" style={{ fontSize: '0.7rem' }}>✅ 추가됨</span>}
                      </div>
                    ))}

                    {/* 장소 */}
                    {it.event_place && <div className="small mb-1">📍 {it.event_place}</div>}

                    {/* 신청기간 + 예약/신청 바로가기 + 연락처 */}
                    {(it.apply_display || it.reserve_url || it.contact) && (
                      <div className="small mb-1 p-2 bg-light rounded">
                        {it.apply_display && <div>🗓️ 신청기간: {it.apply_display}</div>}
                        {it.reserve_url && (
                          <div>🎟️ <a href={it.reserve_url} target="_blank" rel="noopener noreferrer" className="text-success fw-bold">
                            예약/신청 바로가기
                          </a></div>
                        )}
                        {it.contact && <div>📞 {it.contact}</div>}
                      </div>
                    )}

                    {/* 메모 (스크롤로 전체 내용 확인) */}
                    {it.content && (
                      <div className="small text-muted mb-2 p-2 bg-light rounded"
                        style={{ maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                        {it.content}
                      </div>
                    )}

                    {/* 좋아요/나빠요 (목록 자체) */}
                    <div className="d-flex justify-content-between align-items-center pt-2 border-top">
                      <small className="text-muted">👤 {it.author_name || '관리자'}</small>
                      {it.kind === 'post' && (
                        <div className="d-flex gap-1">
                          <button className="btn btn-sm btn-outline-success py-0" onClick={() => vote(it, 'like')}>👍 {it.like_count ?? 0}</button>
                          <button className="btn btn-sm btn-outline-danger py-0" onClick={() => vote(it, 'dislike')}>👎 {it.dislike_count ?? 0}</button>
                        </div>
                      )}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="d-flex gap-1 flex-wrap mt-2">
                      {it.source_url && (
                        <a href={it.source_url} target="_blank" rel="noopener noreferrer"
                          className="btn btn-sm btn-outline-primary py-0">
                          자세히 보기 →
                        </a>
                      )}
                      {it.kind === 'post' && (
                        <button className="btn btn-sm btn-outline-secondary py-0" onClick={() => openComments(it)}>
                          💬 댓글
                        </button>
                      )}
                    </div>

                    <div className="small text-muted mt-1">{it.created_at ? formatKST(it.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 댓글 모달 */}
      {commentPost && (
        <div className="modal fade show d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content" style={{ borderRadius: 18 }}>
              <div className="modal-header">
                <div>
                  <h6 className="fw-bold mb-0">{commentPost.title}</h6>
                  {commentPost.source_url && (
                    <a href={commentPost.source_url} target="_blank" rel="noopener noreferrer" className="small text-primary">
                      🔗 {commentPost.author_name || '원문'} 게시물 바로가기
                    </a>
                  )}
                </div>
                <button type="button" className="btn-close" onClick={() => setCommentPost(null)} />
              </div>
              <div className="modal-body">
                {commentsLoading ? (
                  <div className="text-center py-4"><div className="spinner-border" /></div>
                ) : comments.length === 0 ? (
                  <p className="text-center text-muted small py-3">아직 의견이 없습니다. 첫 의견을 남겨보세요.</p>
                ) : (
                  <div className="mb-3">
                    {comments.map(c => (
                      <div key={c.id} className="border-bottom pb-2 mb-2">
                        <div className="d-flex justify-content-between">
                          <strong className="small">{c.author_name || '익명'}</strong>
                          <div className="d-flex align-items-center gap-1">
                            <small className="text-muted">{c.created_at ? formatKST(c.created_at, { month: '2-digit', day: '2-digit' }) : ''}</small>
                            {c.user_id === me?.id && (
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
                        {sending ? '⏳ 등록 중...' : '💬 댓글 등록'}
                      </button>
                    </div>
                    {commentImage && <small className="text-success">📷 {commentImage.name}</small>}
                  </form>
                ) : (
                  <div className="alert alert-light small text-center">의견 등록은 로그인 후 이용할 수 있습니다.</div>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setCommentPost(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
