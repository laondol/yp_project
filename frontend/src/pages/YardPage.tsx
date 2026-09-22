import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatKST } from '../utils/format'
import ShareReport from './ShareReport'
import ShareEdit from './ShareEdit'
import AuthorName from '../components/AuthorName'
import { useAuth } from '../contexts/AuthContext'

interface YardExtraSchedule {
  id: number; display: string
  event_start_iso?: string; event_end_iso?: string; is_allday?: boolean
}

interface YardItem {
  id: string; db_id: number; kind: 'post' | 'event'
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; reserve_url?: string; author_name?: string
  author_email?: string; user_id?: number
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
  is_past?: boolean
  event_started?: boolean
  review_count?: number
  latitude?: number; longitude?: number
  distance_km?: number | null
  created_at: string
  category?: string  // event(행사/소식), bid(입찰/공고)
}

interface YardComment {
  id: number; user_id: number; author_name: string; content: string; author_email?: string
  image_path?: string; link_url?: string
  like_count?: number; dislike_count?: number; created_at: string
}

export default function YardPage() {
  const navigate = useNavigate()
  const { user: authUser } = useAuth()
  const [items, setItems] = useState<YardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [tab, setTab] = useState<'event' | 'bid'>('event')
  const [me, setMe] = useState<{ id: number } | null>(null)
  const myId = me?.id ?? (authUser as any)?.id ?? null

  // 댓글 모달
  const [commentPost, setCommentPost] = useState<YardItem | null>(null)
  const [comments, setComments] = useState<YardComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentLink, setCommentLink] = useState('')
  const [commentImage, setCommentImage] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [addedSchedule, setAddedSchedule] = useState<Record<string, boolean>>({})
  // 후기 모달
  const [reviewItem, setReviewItem] = useState<YardItem | null>(null)
  const [reviewPhotos, setReviewPhotos] = useState<any[]>([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewView, setReviewView] = useState<'list' | 'detail'>('list')
  const [selectedPhoto, setSelectedPhoto] = useState<any>(null)
  const [detailData, setDetailData] = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [reviewCommentText, setReviewCommentText] = useState('')
  const [reviewReplyTo, setReviewReplyTo] = useState<number | null>(null)
  const [reviewSending, setReviewSending] = useState(false)
  const [reviewWrite, setReviewWrite] = useState(false)
  const [reviewEdit, setReviewEdit] = useState(false)

  const openReviewModal = (item: YardItem) => {
    setReviewItem(item)
    setReviewView('list')
    setSelectedPhoto(null)
    setDetailData(null)
    setReviewWrite(false)
    setReviewEdit(false)
    setReviewLoading(true)
    setReviewPhotos([])
    const params = new URLSearchParams()
    if (item.latitude) params.set('lat', String(item.latitude))
    if (item.longitude) params.set('lon', String(item.longitude))
    fetch(`/api/share/reports?${params.toString()}`)
      .then(r => r.json())
      .then((data: any[]) => {
        const filtered = data.filter((p: any) => {
          if (typeof p.id === 'string') return false
          const isLinked = p.yard_event_id === item.db_id
          if (isLinked) return true
          if (!item.latitude || !item.longitude || !p.latitude || !p.longitude) return false
          const R = 6371
          const dLat = (p.latitude - item.latitude) * Math.PI / 180
          const dLon = (p.longitude - item.longitude) * Math.PI / 180
          const a = Math.sin(dLat / 2) ** 2 + Math.cos(item.latitude * Math.PI / 180) * Math.cos(p.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2
          return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= 0.5
        })
        filtered.sort((a: any, b: any) => (b.created_at || '').localeCompare(a.created_at || ''))
        setReviewPhotos(filtered)
      })
      .catch(() => setReviewPhotos([]))
      .finally(() => setReviewLoading(false))
  }

  const openReviewDetail = (photo: any) => {
    setSelectedPhoto(photo)
    setReviewView('detail')
    setDetailLoading(true)
    setDetailData(null)
    setReviewCommentText('')
    setReviewReplyTo(null)
    fetch(`/api/share/report/${photo.id}`)
      .then(r => r.json())
      .then(d => setDetailData(d))
      .catch(() => {})
      .finally(() => setDetailLoading(false))
  }

  const voteShare = (reportId: number, action: 'like' | 'dislike') => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (!confirm(action === 'like' ? '좋아요 하시겠습니까?' : '나빠요 하시겠습니까?')) return
    fetch(`/share-report/${action}/${reportId}`, { method: 'POST' })
      .then(r => r.json())
      .then(d => {
        if (d.status === 'success') {
          setDetailData((prev: any) => prev ? { ...prev, like_count: d.likes ?? prev.like_count, dislike_count: d.dislikes ?? prev.dislike_count } : prev)
          setReviewPhotos((prev: any[]) => prev.map(p => p.id === reportId ? { ...p, like_count: d.likes ?? p.like_count, dislike_count: d.dislikes ?? p.dislike_count } : p))
        } else alert(d.msg || '오류')
      })
      .catch(() => alert('오류가 발생했습니다.'))
  }

  const submitShareComment = async () => {
    if (!me) { alert('로그인 후 이용하세요.'); return }
    if (!detailData || !reviewCommentText.trim()) return
    setReviewSending(true)
    try {
      const fd = new FormData()
      fd.append('content', reviewCommentText.trim())
      if (reviewReplyTo) fd.append('parent_id', String(reviewReplyTo))
      const res = await fetch(`/share/comment/${detailData.id}`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        setReviewCommentText(''); setReviewReplyTo(null)
        const rRes = await fetch(`/api/share/report/${detailData.id}`)
        setDetailData(await rRes.json())
      } else alert(data.msg || '등록 실패')
    } catch { alert('댓글 등록 오류') }
    setReviewSending(false)
  }

  const deleteShareComment = async (commentId: number) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return
    if (!detailData) return
    try {
      const res = await fetch(`/share/comment/delete/${commentId}`, { method: 'POST' })
      const data = await res.json()
      if (data.status === 'success') {
        const rRes = await fetch(`/api/share/report/${detailData.id}`)
        setDetailData(await rRes.json())
      } else alert(data.msg || '삭제 실패')
    } catch { alert('삭제 오류') }
  }

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

  const filtered = items.filter(i => {
    if (tab === 'bid') return i.category === 'bid'
    if (i.category === 'bid') return false
    return filter === 'event' ? (i.category === 'event' || i.kind === 'event') && !i.is_past :
      filter === 'news' ? (i.category === 'notice' || (i.kind === 'post' && i.category !== 'event')) && !i.is_past :
      filter === 'village' ? i.platform === 'village_event' && !i.is_past :
      filter === 'past' ? !!i.is_past :
      !i.is_past
  })

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

  const deleteSharePost = async () => {
    if (!detailData) return
    if (!confirm('정말 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/share-report/delete/${detailData.id}`, { method: 'POST' })
      const d = await res.json()
      if (d.status === 'success') {
        alert('삭제되었습니다.')
        const cur = reviewItem
        setReviewItem(null); setReviewView('list'); setSelectedPhoto(null); setDetailData(null); setReviewEdit(false)
        if (cur) openReviewModal(cur)
      } else alert(d.msg || '오류')
    } catch { alert('오류') }
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

      {/* 탭: 행사 / 입찰 */}
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${tab === 'event' ? 'active fw-bold' : ''}`}
            onClick={() => { setTab('event'); setFilter('all') }}>
            🌾 행사·소식
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab === 'bid' ? 'active fw-bold' : ''}`}
            onClick={() => { setTab('bid'); setFilter('all') }}>
            📋 입찰·공고
          </button>
        </li>
      </ul>

      {/* 하위 필터 (행사 탭일 때만) */}
      {tab === 'event' && (
        <div className="d-flex gap-2 flex-wrap mb-3">
          {[
            { key: 'event', label: '행사' },
            { key: 'news', label: '소식' },
            { key: 'village', label: '마을' },
            { key: 'past', label: '지난것' },
          ].map(f => (
            <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setFilter(f.key)}>{f.label}</button>
          ))}
        </div>
      )}

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
            const isPast = !!it.is_past
            return (
              <div key={it.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
                  <div className="card-body p-3 d-flex flex-column">
                    {/* 제목 (맨위) */}
                    <h6 className="fw-bold mb-2">{it.title}</h6>

                    {/* ⭐ 지나간 행사 배지 + 후기 (클릭 시 공유마당에서 후기 목록 표시) */}
                    {isPast && (
                      <>
                        <div className="d-flex align-items-center mb-2 p-2 rounded" style={{ background: '#fffbe6' }}>
                          <span className="small fw-bold" style={{ cursor: 'pointer' }}
                            onClick={() => navigate(`/share?yard_event=${it.db_id}`)}>
                            ⭐ 지나간 행사 · 후기 {(it.review_count ?? 0)}건 보기 →
                          </span>
                        </div>
                        {it.event_place && <div className="small mb-1">📍 {it.event_place}</div>}
                      </>
                    )}

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
                    {!isPast && it.event_place && <div className="small mb-1">📍 {it.event_place}</div>}

                    {/* 신청기간 + 예약/신청 바로가기 + 연락처 (지나간 행사에서는 숨김) */}
                    {!isPast && (it.apply_display || it.reserve_url || it.contact) && (
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
                      <small className="text-muted">
                        {it.author_email
                          ? <AuthorName name={it.author_name} email={it.author_email} userId={it.user_id} prefix="👤 " />
                          : `👤 ${it.author_name || '관리자'}`}
                      </small>
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
                        <button className="btn btn-sm btn-outline-secondary py-0" onClick={() => (isPast || it.event_started) ? openReviewModal(it) : openComments(it)}>
                          {(isPast || it.event_started) ? '⭐ 후기' : '💬 댓글'}
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
                      🔗 {commentPost.author_email ? '작성자' : (commentPost.author_name || '원문')} 게시물 바로가기
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
                          <strong className="small">
                            {c.author_email
                              ? <AuthorName name={c.author_name} email={c.author_email} userId={c.user_id} />
                              : (c.author_name || '익명')}
                          </strong>
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
                    <textarea className="form-control mb-2" rows={2} placeholder={(commentPost?.is_past) ? "후기를 남겨주세요." : "의견을 남겨주세요."}
                      value={commentText} onChange={e => setCommentText(e.target.value)} />
                    <div className="d-flex gap-2 mb-2 flex-wrap">
                      <input type="file" accept="image/*" className="form-control form-control-sm" style={{ maxWidth: 200 }}
                        onChange={e => setCommentImage(e.target.files?.[0] || null)} />
                      <input type="url" className="form-control form-control-sm" placeholder="링크 (선택)"
                        value={commentLink} onChange={e => setCommentLink(e.target.value)} style={{ maxWidth: 220 }} />
                      <button type="submit" className="btn btn-sm btn-success" disabled={sending}>
                        {sending ? '⏳ 등록 중...' : ((commentPost?.is_past) ? '⭐ 후기 등록' : '💬 댓글 등록')}
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
      {/* 후기 사진 모달 */}
      {reviewItem && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.7)', zIndex: 4000 }}
          onClick={() => { setReviewItem(null); setReviewView('list'); setSelectedPhoto(null); setDetailData(null); setReviewWrite(false); setReviewEdit(false); }}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 16, height: (reviewWrite || reviewEdit) ? '90vh' : undefined }}>
              {/* 헤더 */}
              <div className="modal-header py-2">
                <div className="d-flex align-items-center gap-2">
                  <button className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: '1.1rem', lineHeight: 1 }}
                    onClick={() => { if (reviewWrite || reviewEdit) { setReviewWrite(false); setReviewEdit(false); } else if (reviewView === 'detail') { setReviewView('list'); setSelectedPhoto(null); setDetailData(null); } else { setReviewItem(null); } }}>
                    {(reviewWrite || reviewEdit || reviewView === 'detail') ? '←' : '≡'}
                  </button>
                  {!reviewWrite && !reviewEdit && reviewView === 'list' && (
                    <button className="btn btn-sm btn-success py-0"
                      onClick={() => setReviewWrite(true)}>
                      후기 쓰기
                    </button>
                  )}
                  <h6 className="fw-bold mb-0">
                    {reviewEdit ? '공유 수정' :
                     reviewWrite ? `${reviewItem.title} 후기` :
                     reviewView === 'detail' && selectedPhoto ? selectedPhoto.title || '상세 보기' : `${reviewItem.title} 후기`}
                  </h6>
                </div>
                <button className="btn-close btn-close-white" style={{ filter: 'brightness(0) invert(1)' }}
                  onClick={() => { setReviewItem(null); setReviewView('list'); setSelectedPhoto(null); setDetailData(null); setReviewWrite(false); setReviewEdit(false); }} />
              </div>

              {/* 바디 */}
              {reviewWrite ? (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <ShareReport
                    yardEventId={String(reviewItem.db_id)}
                    yardEventTitle={reviewItem.title}
                    yardEventCategory={reviewItem.platform === 'village_event' ? 'village' : 'event'}
                    onBack={() => setReviewWrite(false)}
                  />
                </div>
              ) : reviewEdit && detailData ? (
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <ShareEdit
                    reportId={String(detailData.id)}
                    onDone={async () => {
                      const pid = detailData.id
                      setReviewEdit(false)
                      if (reviewItem) openReviewModal(reviewItem)
                      setReviewView('detail')
                      setDetailLoading(true)
                      try {
                        const r = await fetch(`/api/share/report/${pid}`)
                        setDetailData(await r.json())
                      } catch { /* 무시 */ }
                      setDetailLoading(false)
                    }}
                  />
                </div>
              ) : (
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {reviewView === 'list' ? (
                  <>
                    {reviewItem.event_place && <div className="small text-muted mb-2">📍 {reviewItem.event_place}</div>}
                    {reviewLoading ? (
                      <div className="text-center py-4"><div className="spinner-border" /></div>
                    ) : reviewPhotos.length > 0 ? (
                      <div className="row g-2">
                        {reviewPhotos.map((p: any) => (
                          <div key={p.id} className="col-6 col-md-4" style={{ cursor: 'pointer' }}
                            onClick={() => openReviewDetail(p)}>
                            <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 12, overflow: 'hidden' }}>
                              {p.image_path && <img src={p.image_path} className="w-100" style={{ height: 150, objectFit: 'cover' }} alt={p.title} />}
                              <div className="card-body p-2">
                                <div className="small fw-bold">{p.title}</div>
                                {p.is_pending && (
                                  <span className="badge bg-warning text-dark" style={{ fontSize: '0.65rem' }}>심사중</span>
                                )}
                                <div className="small text-muted" style={{ fontSize: '0.75rem' }}>
                                  {p.ai_category} · {p.address || `${p.town} ${p.village}`}
                                </div>
                                <div className="d-flex gap-2 mt-1" style={{ fontSize: '0.75rem' }}>
                                  <span>👍 {p.like_count ?? 0}</span><span>👎 {p.dislike_count ?? 0}</span>
                                </div>
                                {p.author_name && <div className="small text-muted mt-1 pt-2 border-top border-light" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  <AuthorName name={p.author_name} email={p.author_email} userId={p.user_id} prefix="👤 " />
                                </div>}
                                <div className="mt-2">
                                  <a className="text-decoration-none small text-primary" style={{ cursor: 'pointer' }}
                                    onClick={e => { e.preventDefault(); e.stopPropagation(); openReviewDetail(p) }}>
                                    자세히 보기 →
                                  </a>
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center text-muted py-4">아직 후기 사진이 없습니다.</div>
                    )}
                  </>
                ) : (
                  <>
                    {detailLoading ? (
                      <div className="text-center py-4"><div className="spinner-border" /></div>
                    ) : detailData ? (
                      <>
                        {detailData.status && detailData.status !== 'approved' && detailData.user_id === myId && (
                          <div className="alert alert-warning py-2 small mb-2">
                            심사중이므로 일반회원에게 공개되지 않습니다. 내용을 수정 가능합니다. 공개된 후에 고치시면 다시 심사가 진행됩니다.
                          </div>
                        )}
                        <div className="d-flex gap-2 flex-wrap mb-3">
                          {detailData.ai_category && <span className="badge bg-info">{detailData.ai_category}</span>}
                          {detailData.address && <span className="badge bg-light text-dark">{detailData.address}</span>}
                        </div>
                        {detailData.image_path && (
                          <img src={detailData.image_path} className="img-fluid rounded mb-3" style={{ width: '100%' }} alt={detailData.title} />
                        )}
                        {(() => {
                          const extras: string[] = detailData.extra_images ? detailData.extra_images.split(',').filter(Boolean) : []
                          return (
                            <div className="row g-2 mb-3">
                              {(detailData.image_path ? extras : extras.slice(0, 6)).map((img: string, i: number) => (
                                <div key={i} className="col-4 col-md-3">
                                  <img src={img} className="img-fluid rounded" style={{ height: 120, objectFit: 'contain', width: '100%', backgroundColor: '#f8f9fa' }} />
                                </div>
                              ))}
                              {!detailData.image_path && extras.length === 0 && !detailData.drawing_path && (
                                <div className="col-12 text-center text-muted py-3 bg-light rounded">이미지 없음</div>
                              )}
                            </div>
                          )
                        })()}
                        {detailData.drawing_path && <img src={detailData.drawing_path} className="img-fluid rounded mb-3" style={{ maxHeight: 400 }} />}
                        {detailData.video_path && (
                          <video controls className="w-100 rounded mb-3" style={{ maxHeight: 400 }}>
                            <source src={detailData.video_path} />
                          </video>
                        )}
                        {detailData.ai_summary && (
                          <div className="p-3 bg-light rounded mb-3 border-start border-5 border-info">
                            <strong>🤖 AI 요약:</strong><br />{detailData.ai_summary}
                          </div>
                        )}
                        {detailData.ai_region_news && detailData.ai_region_news !== '관련 뉴스 없음' && (
                          <div className="p-3 bg-light rounded mb-3 border-start border-5 border-info">
                            <strong>📰 AI 지역 분석:</strong><br />{detailData.ai_region_news}
                          </div>
                        )}
                        {detailData.ai_danger_alert && (
                          <div className="mb-4 p-3 bg-danger bg-opacity-10 rounded border border-danger">
                            <strong className="text-danger">🚨 위험/긴급 상황 감지</strong><br />
                            <small className="text-muted">관리자와 책임자에게 자동 통보되었습니다.</small>
                          </div>
                        )}
                        {detailData.description && <p style={{ whiteSpace: 'pre-wrap' }}>{detailData.description}</p>}
                        <hr />
                        <div className="d-flex justify-content-between small text-muted">
                          <span>공유자: <AuthorName name={detailData.author_name} email={detailData.author_email} userId={detailData.user_id} /></span>
                          <span>{detailData.created_at}</span>
                        </div>
                        <div className="d-flex justify-content-between small text-muted">
                          <span>위치: {detailData.address || `양평군 ${detailData.town} ${detailData.village}`}</span>
                          {detailData.ai_confidence ? <span>AI 신뢰도: {Math.round(detailData.ai_confidence * 100)}%</span> : null}
                        </div>
                        {(() => {
                          const isAuthor = myId != null && detailData.user_id === myId
                          const isAdminEditTarget = (detailData.my_role === 'admin' || detailData.my_role === 'leader') && (!detailData.user_id || detailData.user_id === 0 || detailData.user_id === 1)
                          const canEdit = isAuthor || isAdminEditTarget
                          return canEdit ? (
                            <div className="mt-3 d-flex gap-2">
                              <button className="btn btn-sm btn-outline-primary" onClick={() => setReviewEdit(true)}>✏️ 수정</button>
                              <button className="btn btn-sm btn-outline-danger" onClick={deleteSharePost}>🗑️ 삭제</button>
                            </div>
                          ) : null
                        })()}
                        <div className="d-flex gap-2 justify-content-center my-3">
                          <button className="btn btn-outline-success btn-lg px-4" onClick={() => voteShare(detailData.id, 'like')}>👍 좋아요 {detailData.like_count ?? 0}</button>
                          <button className="btn btn-outline-danger btn-lg px-4" onClick={() => voteShare(detailData.id, 'dislike')}>👎 나빠요 {detailData.dislike_count ?? 0}</button>
                        </div>
                        <div className="card border-0 shadow-sm" style={{ borderRadius: 18 }}>
                          <div className="card-body p-4">
                            <h6 className="fw-bold mb-3">💬 댓글 ({(detailData.comments || []).length})</h6>
                            {me ? (
                              <form onSubmit={e => { e.preventDefault(); submitShareComment() }} className="mb-4">
                                {reviewReplyTo && (
                                  <div className="small text-muted mb-2">
                                    💬 답글 작성 중...
                                    <button type="button" className="btn btn-sm btn-link p-0" onClick={() => setReviewReplyTo(null)}>취소</button>
                                  </div>
                                )}
                                <div className="mb-2 d-flex gap-2 align-items-center">
                                  <textarea className="form-control" rows={2} placeholder="댓글을 입력하세요..." value={reviewCommentText}
                                    onChange={e => setReviewCommentText(e.target.value)} required />
                                  <button type="submit" className="btn btn-primary px-3" style={{ whiteSpace: 'nowrap' }} disabled={reviewSending}>
                                    {reviewSending ? '⏳ 등록 중...' : '등록'}
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div className="alert alert-light text-center small mb-4">댓글은 로그인 후 이용할 수 있습니다.</div>
                            )}
                            {(detailData.comments || []).map((c: any) => (
                              <div key={c.id} className="mb-3 p-3 bg-light rounded">
                                <div className="d-flex justify-content-between">
                                  <strong className="small"><AuthorName name={c.author} email={c.author_email} userId={c.user_id} /></strong>
                                  <div>
                                    <small className="text-muted">{c.created_at || ''}</small>
                                    {myId === c.user_id && (
                                      <button onClick={() => deleteShareComment(c.id)} className="btn btn-sm btn-link text-danger p-0 ms-2">삭제</button>
                                    )}
                                  </div>
                                </div>
                                <p className="mb-1 mt-1">{c.content}</p>
                                {me && (
                                  <button onClick={() => { setReviewReplyTo(c.id); setReviewCommentText('') }} className="btn btn-sm btn-link p-0 text-primary">답글</button>
                                )}
                                {(c.replies || []).length > 0 && (
                                  <div className="mt-2 ps-3 border-start border-3">
                                    {(c.replies || []).map((r: any) => (
                                      <div key={r.id} className="mb-2">
                                        <div className="d-flex justify-content-between">
                                          <strong className="small">↳ <AuthorName name={r.author} email={r.author_email} userId={r.user_id} /></strong>
                                          <div>
                                            <small className="text-muted">{r.created_at || ''}</small>
                                            {myId === r.user_id && (
                                              <button onClick={() => deleteShareComment(r.id)} className="btn btn-sm btn-link text-danger p-0 ms-2">삭제</button>
                                            )}
                                          </div>
                                        </div>
                                        <p className="mb-0 mt-1">{r.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-center text-muted py-4">상세 정보를 불러올 수 없습니다.</div>
                    )}
                  </>
                )}
              </div>
              )}

              {/* 푸터 */}
              <div className="modal-footer py-2">
                {reviewView === 'detail' && (
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => { setReviewView('list'); setSelectedPhoto(null); setDetailData(null); }}>
                    ← 목록으로
                  </button>
                )}
                <button className="btn btn-sm btn-secondary" onClick={() => { setReviewItem(null); setReviewView('list'); setSelectedPhoto(null); setDetailData(null); }}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
