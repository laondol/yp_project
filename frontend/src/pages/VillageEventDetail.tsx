import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { villageApi, api } from '../lib/api'
import type { VillageEvent } from '../lib/types'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format';

interface ChatItem {
  id: number; author: string; message: string; msg_type: string;
  like_count: number; dislike_count: number; my_vote: string;
  answer: string | null; answerer: string; answered_at: string | null; created_at: string;
}
interface FileItem {
  id: number; filename: string; uploader_name: string; file_size: number; created_at: string;
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  question: { label: '❓ 질문', cls: 'bg-warning text-dark' },
  opinion: { label: '💬 의견', cls: 'bg-info text-dark' },
}

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

  // 채팅방 상태
  const [chats, setChats] = useState<ChatItem[]>([])
  const [chatMeta, setChatMeta] = useState<{ can_answer: boolean; chat_open: boolean; chat_close_date: string | null }>({ can_answer: false, chat_open: true, chat_close_date: null })
  const [chatSort, setChatSort] = useState<'new' | 'likes'>('new')
  const [msgType, setMsgType] = useState('question')
  const [chatInput, setChatInput] = useState('')
  const [chatSending, setChatSending] = useState(false)
  const [answerDraft, setAnswerDraft] = useState<Record<number, string>>({})
  const [summary, setSummary] = useState('')
  const [summaryLoading, setSummaryLoading] = useState(false)
  const [showSummary, setShowSummary] = useState(false)

  // 자료실 상태
  const [files, setFiles] = useState<FileItem[]>([])
  const [fileMeta, setFileMeta] = useState<{ can_upload: boolean; chat_open: boolean }>({ can_upload: false, chat_open: true })
  const [uploading, setUploading] = useState(false)

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

  const loadChats = useCallback(async (sort: 'new' | 'likes' = 'new') => {
    if (!id) return
    try {
      const d = await api.get<{ chats: ChatItem[]; can_answer: boolean; chat_open: boolean; chat_close_date: string | null }>(`/village/event/${id}/chats?sort=${sort}`)
      setChats(d.chats || [])
      setChatMeta({ can_answer: !!d.can_answer, chat_open: !!d.chat_open, chat_close_date: d.chat_close_date || null })
    } catch {}
  }, [id])

  const loadFiles = useCallback(async () => {
    if (!id) return
    try {
      const d = await api.get<{ files: FileItem[]; can_upload: boolean; chat_open: boolean }>(`/village/event/${id}/files`)
      setFiles(d.files || [])
      setFileMeta({ can_upload: !!d.can_upload, chat_open: !!d.chat_open })
    } catch {}
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadChats(chatSort) }, [loadChats, chatSort])
  useEffect(() => { loadFiles() }, [loadFiles])

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

  const sendChat = async () => {
    const msg = chatInput.trim()
    if (!msg || chatSending) return
    setChatSending(true)
    try {
      const fd = new FormData()
      fd.append('message', msg)
      fd.append('msg_type', msgType)
      const d = await api.upload<{ status: string }>(`/village/event/${id}/chat`, fd)
      if (d.status === 'closed') { alert('종료된 채팅방입니다.'); loadChats(chatSort) }
      else if (d.status === 'blocked') { alert('AI가 부적절한 메시지로 판단했습니다.') }
      else if (d.status === 'success') { setChatInput(''); loadChats(chatSort) }
    } catch { alert('전송 실패') }
    finally { setChatSending(false) }
  }

  const vote = async (chatId: number, v: 'like' | 'dislike') => {
    try {
      const fd = new FormData()
      fd.append('vote', v)
      const d = await api.upload<{ status: string }>(`/village/event/${id}/chat/${chatId}/vote`, fd)
      if (d.status === 'closed') { alert('종료된 채팅방입니다.'); return }
      loadChats(chatSort)
    } catch {}
  }

  const submitAnswer = async (chatId: number) => {
    const text = (answerDraft[chatId] || '').trim()
    if (!text) return
    try {
      const fd = new FormData()
      fd.append('answer', text)
      await api.upload(`/village/event/${id}/chat/${chatId}/answer`, fd)
      setAnswerDraft(prev => ({ ...prev, [chatId]: '' }))
      loadChats(chatSort)
    } catch { alert('답변 등록 실패') }
  }

  const runAiSummary = async () => {
    setSummaryLoading(true); setShowSummary(true)
    try {
      const d = await api.upload<{ summary: string }>(`/village/event/${id}/ai-summary`, new FormData())
      setSummary(d.summary || '요약 실패')
    } catch { setSummary('요약 실패') }
    finally { setSummaryLoading(false) }
  }

  const closeChat = async () => {
    if (!confirm('답변을 마치고 채팅방을 10일 후에 종료하시겠습니까?')) return
    try {
      await api.upload(`/village/event/${id}/close-chat`, new FormData())
      loadChats(chatSort)
    } catch { alert('종료 처리 실패') }
  }

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const d = await api.upload<{ status: string; error?: string }>(`/village/event/${id}/files`, fd)
      if (d.status === 'success') loadFiles()
      else alert(d.error || '업로드 실패')
    } catch { alert('업로드 실패') }
    finally { setUploading(false); e.target.value = '' }
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />
  if (!event) return <ErrorMessage message="이벤트를 찾을 수 없습니다." />

  const showMobileHelper = event.event_type === 'meeting' && (event.meeting_mode === 'offline' || event.meeting_mode === 'hybrid')
  const closeDaysLeft = chatMeta.chat_close_date ? Math.ceil((new Date(chatMeta.chat_close_date).getTime() - Date.now()) / 86400000) : null

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

      {/* 회의 채팅방 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
            <h6 className="fw-bold mb-0">💬 회의 채팅방</h6>
            <div className="d-flex gap-2 align-items-center">
              <div className="btn-group btn-group-sm">
                <button className={`btn ${chatSort === 'new' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setChatSort('new')}>최신순</button>
                <button className={`btn ${chatSort === 'likes' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setChatSort('likes')}>공감순</button>
              </div>
              <button className="btn btn-sm btn-outline-primary" onClick={runAiSummary} disabled={summaryLoading}>
                {summaryLoading ? '정리 중...' : '🤖 AI 정리'}
              </button>
              {chatMeta.can_answer && chatMeta.chat_open && (
                <button className="btn btn-sm btn-outline-danger" onClick={closeChat}>✅ 답변 완료(10일 후 종료)</button>
              )}
            </div>
          </div>
          {!chatMeta.chat_open && (
            <div className="alert alert-secondary py-2 small mb-2">
              🔒 종료된 채팅방입니다{chatMeta.chat_close_date ? ` (${formatKST(chatMeta.chat_close_date)} 종료)` : ''}. 기록은 보존됩니다.
            </div>
          )}
          {chatMeta.chat_open && closeDaysLeft !== null && closeDaysLeft > 0 && (
            <div className="alert alert-warning py-2 small mb-2">⏳ 채팅방이 {closeDaysLeft}일 후 종료됩니다.</div>
          )}
          {showSummary && (
            <div className="border rounded p-3 mb-3 bg-light" style={{ whiteSpace: 'pre-wrap', fontSize: '0.9rem' }}>
              {summary || (summaryLoading ? 'AI가 정리 중입니다...' : '')}
            </div>
          )}
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {chats.length === 0 && <div className="text-muted small py-3 text-center">아직 대화가 없습니다. 질문이나 의견을 남겨보세요.</div>}
            {chats.map(c => (
              <div key={c.id} className="border-bottom pb-2 mb-2">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="me-2">
                    {TYPE_BADGE[c.msg_type] && (
                      <span className={`badge ${TYPE_BADGE[c.msg_type].cls} me-1`} style={{ fontSize: '0.7rem' }}>{TYPE_BADGE[c.msg_type].label}</span>
                    )}
                    <span className="small fw-bold">{c.author}</span>
                    <span className="small text-muted ms-1">{c.created_at ? formatKST(c.created_at) : ''}</span>
                  </div>
                  <div className="d-flex gap-2">
                    <button className={`btn btn-sm py-0 px-2 ${c.my_vote === 'like' ? 'btn-success' : 'btn-outline-secondary'}`}
                      style={{ fontSize: '0.75rem' }} disabled={!chatMeta.chat_open} onClick={() => vote(c.id, 'like')}>
                      👍 동의 {c.like_count > 0 ? c.like_count : ''}
                    </button>
                    <button className={`btn btn-sm py-0 px-2 ${c.my_vote === 'dislike' ? 'btn-danger' : 'btn-outline-secondary'}`}
                      style={{ fontSize: '0.75rem' }} disabled={!chatMeta.chat_open} onClick={() => vote(c.id, 'dislike')}>
                      👎 별로예요 {c.dislike_count > 0 ? c.dislike_count : ''}
                    </button>
                  </div>
                </div>
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.message}</div>
                {c.answer && (
                  <div className="mt-1 p-2 rounded bg-success bg-opacity-10 border-start border-success border-3">
                    <div className="small fw-bold text-success mb-1">📢 답변 {c.answerer && `· ${c.answerer}`}</div>
                    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.answer}</div>
                  </div>
                )}
                {chatMeta.can_answer && !c.answer && (
                  <div className="mt-1 d-flex gap-1">
                    <input type="text" className="form-control form-control-sm" placeholder="답변을 입력하세요..."
                      value={answerDraft[c.id] || ''} onChange={e => setAnswerDraft(prev => ({ ...prev, [c.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') submitAnswer(c.id) }} />
                    <button className="btn btn-sm btn-outline-success" onClick={() => submitAnswer(c.id)}>답변</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {chatMeta.chat_open ? (
            <div className="d-flex gap-2 mt-3">
              <select className="form-select form-select-sm" style={{ maxWidth: 110 }} value={msgType} onChange={e => setMsgType(e.target.value)}>
                <option value="question">❓ 질문</option>
                <option value="opinion">💬 의견</option>
                <option value="">일반</option>
              </select>
              <input type="text" className="form-control form-control-sm" placeholder="질문이나 의견을 남겨보세요..."
                value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendChat() }} disabled={chatSending} />
              <button className="btn btn-sm btn-success" onClick={sendChat} disabled={chatSending || !chatInput.trim()}>전송</button>
            </div>
          ) : (
            chatMeta.can_answer && <div className="small text-muted mt-2">채팅은 종료되었지만 발표자는 답변을 추가할 수 있습니다.</div>
          )}
        </div>
      </div>

      {/* 자료실 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h6 className="fw-bold mb-3">📁 자료실 <span className="small text-muted fw-normal">(마을지기·발표자 업로드, 회원 다운로드)</span></h6>
          {files.length === 0 && <div className="text-muted small py-2">등록된 자료가 없습니다.</div>}
          {files.map(f => (
            <div key={f.id} className="d-flex justify-content-between align-items-center border-bottom pb-2 mb-2">
              <div>
                <div className="small">{f.filename}</div>
                <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                  {f.uploader_name} · {f.created_at ? formatKST(f.created_at) : ''} · {f.file_size > 1048576 ? `${(f.file_size / 1048576).toFixed(1)}MB` : f.file_size > 1024 ? `${Math.round(f.file_size / 1024)}KB` : ''}
                </div>
              </div>
              <a className="btn btn-sm btn-outline-success" href={`/village/event/${id}/files/${f.id}/download`}>⬇ 다운로드</a>
            </div>
          ))}
          {fileMeta.can_upload && (
            <div className="mt-2">
              <input type="file" className="form-control form-control-sm" onChange={uploadFile} disabled={uploading} />
              {uploading && <div className="small text-muted mt-1">업로드 중...</div>}
            </div>
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
