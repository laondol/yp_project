import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { villageApi, api } from '../lib/api'
import type { VillageEvent } from '../lib/types'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format';

export default function VillageEventDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [event, setEvent] = useState<VillageEvent | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 신청서 상태
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [consented, setConsented] = useState(false)
  const [mobileHelper, setMobileHelper] = useState('')
  const [joinStatus, setJoinStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [joinError, setJoinError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const events = await villageApi.events()
      const found = (Array.isArray(events) ? events : []).find((e: VillageEvent) => e.id === Number(id))
      if (found) setEvent(found)
      else setError('이벤트를 찾을 수 없습니다.')
      try {
        const me = await fetch('/api/me', { credentials: 'include' }).then(r => r.json())
        setName(me.real_name || me.username || '')
        setEmail(me.email || '')
      } catch {}
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const submitJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!consented) return
    setJoinStatus('sending'); setJoinError('')
    try {
      const fd = new FormData()
      fd.append('consented', String(consented))
      fd.append('name', name)
      fd.append('email', email)
      fd.append('mobile_helper', mobileHelper)
      const res = await api.upload<{ status: string }>(`/village/event/${id}/join`, fd)
      if (res.status === 'success') setJoinStatus('done')
      else setJoinError('신청 실패')
    } catch (e: unknown) {
      setJoinError(e instanceof Error ? e.message : '신청 중 오류가 발생했습니다.')
      setJoinStatus('idle')
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />
  if (!event) return <ErrorMessage message="이벤트를 찾을 수 없습니다." />

  const showMobileHelper = event.event_type === 'meeting' && (event.meeting_mode === 'offline' || event.meeting_mode === 'hybrid')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <span className={`badge ${event.event_type === 'meeting' ? 'bg-info' : 'bg-warning'} mb-2 me-1`}>
                {event.event_type === 'meeting' ? '회의' : '행사'}
              </span>
              {event.event_type === 'meeting' && event.meeting_category === 'conference' && (
                <span className="badge bg-dark mb-2 me-1">컨퍼런스</span>
              )}
              {event.event_type === 'meeting' && event.meeting_mode === 'online' && (
                <span className="badge bg-primary mb-2 me-1">💻 온라인</span>
              )}
              {event.event_type === 'meeting' && event.meeting_mode === 'offline' && (
                <span className="badge bg-secondary mb-2 me-1">🏠 오프라인</span>
              )}
              {event.event_type === 'meeting' && event.meeting_mode === 'hybrid' && (
                <span className="badge bg-dark mb-2 me-1">🔀 온오프라인</span>
              )}
              <h4 className="fw-bold">{event.title}</h4>
            </div>
            <div className="text-end small text-muted">
              <div>{event.event_date ? formatKST(event.event_date) : ''}</div>
              {event.meeting_mode === 'online' ? (
                <div>💻 온라인 진행</div>
              ) : (
                <div>📍 {event.location || '미정'}</div>
              )}
            </div>
          </div>
          <p className="mt-2">{event.description || ''}</p>
          {event.video_url && (
            <a href={event.video_url} target="_blank" rel="noreferrer" className="btn btn-sm btn-success">
              💻 온라인 회의 입장
            </a>
          )}
        </div>
      </div>

      {/* 신청서 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h6 className="fw-bold mb-3">📝 참석 신청서</h6>
          {joinStatus === 'done' ? (
            <div className="alert alert-success mb-0">✅ 신청이 완료되었습니다! 감사합니다.</div>
          ) : (
            <form onSubmit={submitJoin}>
              <div className="row g-2 mb-3">
                <div className="col-md-6">
                  <label className="small fw-bold">이름</label>
                  <input type="text" className="form-control form-control-sm" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div className="col-md-6">
                  <label className="small fw-bold">이메일</label>
                  <input type="email" className="form-control form-control-sm" value={email} onChange={e => setEmail(e.target.value)} placeholder="알림 받을 이메일" />
                </div>
              </div>
              {showMobileHelper && (
                <div className="mb-3">
                  <label className="small fw-bold">📱 모바일도우미</label>
                  <div className="d-flex gap-3">
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="mobileHelper" id="mhSupport"
                        checked={mobileHelper === '지원'} onChange={() => setMobileHelper('지원')} />
                      <label className="form-check-label small" htmlFor="mhSupport">🙋 지원 (도와드릴 수 있어요)</label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" name="mobileHelper" id="mhNeed"
                        checked={mobileHelper === '필요'} onChange={() => setMobileHelper('필요')} />
                      <label className="form-check-label small" htmlFor="mhNeed">🙏 필요 (도움이 필요해요)</label>
                    </div>
                  </div>
                </div>
              )}
              <div className="form-check mb-3">
                <input className="form-check-input" type="checkbox" id="consent" checked={consented}
                  onChange={e => setConsented(e.target.checked)} />
                <label className="form-check-label small" htmlFor="consent">
                  개인정보(이름·이메일) 수집 및 참석자 명단 활용에 동의합니다.
                </label>
              </div>
              {joinError && <div className="alert alert-danger py-2 small">{joinError}</div>}
              <button type="submit" className="btn btn-success btn-sm w-100" disabled={!consented || joinStatus === 'sending'}>
                {joinStatus === 'sending' ? '신청 중...' : '신청하기'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="text-center mt-3">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/village/events')}>← 목록</button>
      </div>
    </div>
  )
}
