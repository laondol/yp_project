import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format'

interface DiscussionMessage {
  id: number; user_id: number; user_name: string
  content: string; content_type: string; reply_to_id?: number
  like_count: number; dislike_count: number; my_vote?: string
  created_at?: string
}

interface Participant {
  id: number; name: string; role: string; joined_at?: string
}

interface RoomInfo {
  id: number; topic: string; description: string; status: string
  end_at?: string; summary_text: string; summary_confirmed: boolean
  letter_root_id?: number; letter_info?: { id: number; subject: string; sender: string; created_at?: string }
  creator: string; participants: Participant[]; created_at?: string
}

function linkify(text?: string): string {
  if (!text) return ''
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  let safe = esc(text)
  safe = safe.replace(
    /(https?:\/\/[^\s<]+)|(\/(?:legal|message|share|psycho|village|note|post|user|admin|files|static)[^\s<]*)/g,
    (m) => `<a href="${m}" target="_blank" rel="noreferrer">${m}</a>`,
  )
  return safe
}

function renderContent(content?: string): string {
  if (!content) return ''
  if (/<\/?[a-z][\s\S]*>/i.test(content)) {
    return content.replace(/<img([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;border-radius:8px;margin:6px 0" />')
  }
  return linkify(content).replace(/\n/g, '<br>')
}

export default function DiscussionRoomPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const roomId = Number(id)
  const [room, setRoom] = useState<RoomInfo | null>(null)
  const [messages, setMessages] = useState<DiscussionMessage[]>([])
  const [error, setError] = useState('')
  const [newMsg, setNewMsg] = useState('')
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [myId, setMyId] = useState(0)
  const [showParticipants, setShowParticipants] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [summary, setSummary] = useState('')
  const [generating, setGenerating] = useState(false)
  const [detailMsg, setDetailMsg] = useState<DiscussionMessage | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const loadRoom = useCallback(async () => {
    try {
      const r = await fetch(`/api/discussion/rooms/${roomId}`).then(r => r.json())
      if (r.error) { setError(r.error); return }
      setRoom(r)
      setSummary(r.summary_text || '')
    } catch { setError('방 정보를 불러올 수 없습니다.') }
  }, [roomId])

  const loadMessages = useCallback(async () => {
    try {
      const data = await fetch(`/api/discussion/rooms/${roomId}/messages`).then(r => r.json())
      setMessages(data.messages || [])
      if (data.messages?.length) {
        setMyId(data.messages[0]?.user_id || 0)
      }
    } catch { /* ignore */ }
  }, [roomId])

  useEffect(() => {
    loadRoom(); loadMessages()
  }, [loadRoom, loadMessages])

  useEffect(() => {
    const t = setInterval(loadMessages, 5000)
    return () => clearInterval(t)
  }, [loadMessages])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!newMsg.trim()) return
    try {
      await fetch(`/api/discussion/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newMsg, reply_to_id: replyTo }),
      })
      setNewMsg(''); setReplyTo(null)
      loadMessages()
    } catch { /* ignore */ }
  }

  const handleVote = async (msgId: number, vote: string) => {
    try {
      await fetch(`/api/discussion/messages/${msgId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vote }),
      })
      loadMessages()
    } catch { /* ignore */ }
  }

  const handleGenerateSummary = async () => {
    setGenerating(true)
    try {
      const r = await fetch(`/api/discussion/rooms/${roomId}/summary/generate`, { method: 'POST' }).then(r => r.json())
      if (r.summary) setSummary(r.summary)
    } catch { /* ignore */ }
    setGenerating(false)
  }

  const handleConfirmSummary = async () => {
    try {
      await fetch(`/api/discussion/rooms/${roomId}/summary/confirm`, { method: 'POST' })
      loadRoom()
    } catch { /* ignore */ }
  }

  const handleClose = async () => {
    if (!window.confirm('토론방을 종료하시겠습니까?')) return
    try {
      await fetch(`/api/discussion/rooms/${roomId}/close`, { method: 'POST' })
      loadRoom()
    } catch { /* ignore */ }
  }

  if (error) return <ErrorMessage message={error} onRetry={() => navigate('/discussion')} />
  if (!room) return null

  const isCreator = room.participants.find(p => p.role === 'creator')?.id === myId
  const isOpen = room.status === 'open'
  const isEnded = room.end_at && new Date(room.end_at) < new Date()

  const sortedAsc = [...messages].sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime())

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* 상단 정보 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 14 }}>
        <div className="card-body p-3">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h5 className="fw-bold mb-1">{room.topic}</h5>
              {room.description && <p className="text-muted small mb-1">{room.description}</p>}
              <small className="text-muted">
                개설: {room.creator}
                {room.end_at && <> · 마감: {formatKST(room.end_at)}</>}
              </small>
            </div>
            <div className="d-flex gap-1">
              {room.letter_info && (
                <button className="btn btn-sm btn-outline-secondary"
                  onClick={() => navigate(`/message/inbox?tab=archive`)}>원문 보기</button>
              )}
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => setShowParticipants(v => !v)}>👥 {room.participants.length}</button>
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => setShowSummary(v => !v)}>📋 요약</button>
              {isOpen && (
                <button className="btn btn-sm btn-outline-danger" onClick={handleClose}>종료</button>
              )}
            </div>
          </div>

          {/* 참여자 패널 */}
          {showParticipants && (
            <div className="mt-2 p-2 bg-light rounded" style={{ fontSize: '0.85em' }}>
              {room.participants.map(p => (
                <span key={p.id} className="badge me-1 mb-1" style={{
                  background: p.role === 'creator' ? '#0d6efd' : '#6c757d', fontSize: '0.7rem',
                }}>
                  {p.role === 'creator' ? '개설자' : '참여자'} {p.name}
                </span>
              ))}
            </div>
          )}

          {/* 요약 패널 */}
          {showSummary && (
            <div className="mt-2 p-3 bg-light rounded">
              {summary ? (
                <div>
                  <h6 className="fw-bold mb-2">토론 요약</h6>
                  <div className="letter-body" style={{ lineHeight: 1.8, fontSize: '0.9em' }}
                    dangerouslySetInnerHTML={{ __html: renderContent(summary) }} />
                  {isCreator && !room.summary_confirmed && (
                    <button className="btn btn-sm btn-success mt-2" onClick={handleConfirmSummary}>
                      요약 확인 후 편지 발송
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-muted small mb-2">요약이 아직 없습니다.</p>
                  {isCreator && (
                    <button className="btn btn-sm btn-primary" onClick={handleGenerateSummary} disabled={generating}>
                      {generating ? '요약 생성 중...' : 'AI 요약 생성'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 채팅 영역 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 14 }}>
        <div className="card-body p-3" style={{ height: 500, overflowY: 'auto' }}>
          {sortedAsc.length === 0 && (
            <div className="text-center text-muted py-5">아직 메시지가 없습니다.</div>
          )}
          {sortedAsc.map(m => {
            const isMine = m.user_id === myId
            return (
              <div key={m.id} className={`d-flex mb-3 ${isMine ? 'justify-content-end' : 'justify-content-start'}`}>
                <div style={{ maxWidth: '75%' }}>
                  {!isMine && (
                    <small className="text-muted fw-bold" style={{ fontSize: '0.7rem' }}>{m.user_name}</small>
                  )}
                  {m.reply_to_id && (
                    <div className="text-muted" style={{ fontSize: '0.7rem', borderLeft: '2px solid #dee2e6', paddingLeft: 6, marginBottom: 2 }}>
                      ↪ 회신
                    </div>
                  )}
                  <div
                    className={`p-2 rounded ${isMine ? 'bg-success text-white' : 'bg-light'}`}
                    style={{ cursor: 'pointer', overflowWrap: 'anywhere', lineHeight: 1.6, fontSize: '0.88em' }}
                    onClick={() => setDetailMsg(m)}
                  >
                    <div dangerouslySetInnerHTML={{ __html: renderContent(m.content) }} />
                  </div>
                  <div className="d-flex align-items-center gap-2 mt-1" style={{ fontSize: '0.7rem' }}>
                    <small className="text-muted">{m.created_at ? formatKST(m.created_at) : ''}</small>
                    <button className={`btn p-0 border-0 ${m.my_vote === 'like' ? 'text-success' : 'text-muted'}`}
                      style={{ fontSize: '0.7rem' }}
                      onClick={(e) => { e.stopPropagation(); handleVote(m.id, 'like') }}>👍 {m.like_count}</button>
                    <button className={`btn p-0 border-0 ${m.my_vote === 'dislike' ? 'text-danger' : 'text-muted'}`}
                      style={{ fontSize: '0.7rem' }}
                      onClick={(e) => { e.stopPropagation(); handleVote(m.id, 'dislike') }}>👎 {m.dislike_count}</button>
                    {isOpen && (
                      <button className="btn p-0 border-0 text-primary" style={{ fontSize: '0.7rem' }}
                        onClick={(e) => { e.stopPropagation(); setReplyTo(m.id); }}>회신</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* 메시지 입력 */}
      {isOpen && !isEnded && (
        <div className="card border-0 shadow-sm" style={{ borderRadius: 14 }}>
          <div className="card-body p-3">
            {replyTo && (
              <div className="d-flex justify-content-between align-items-center mb-2 p-2 bg-light rounded" style={{ fontSize: '0.82em' }}>
                <span className="text-muted">↪ 회신할 메시지</span>
                <button className="btn btn-sm btn-link p-0 text-danger" onClick={() => setReplyTo(null)}>✕</button>
              </div>
            )}
            <div className="d-flex gap-2">
              <textarea className="form-control" rows={2} value={newMsg}
                onChange={e => setNewMsg(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder="메시지를 입력하세요..." />
              <button className="btn btn-success align-self-end" onClick={sendMessage}>전송</button>
            </div>
          </div>
        </div>
      )}

      {/* 상세보기 모달 */}
      {detailMsg && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDetailMsg(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 14 }}>
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0">{detailMsg.user_name}</h6>
                <button type="button" className="btn-close" onClick={() => setDetailMsg(null)}></button>
              </div>
              <div className="modal-body">
                <small className="text-muted">{detailMsg.created_at ? formatKST(detailMsg.created_at) : ''}</small>
                <div className="mt-2 p-3 bg-light rounded letter-body"
                  style={{ overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: '0.92em' }}
                  dangerouslySetInnerHTML={{ __html: renderContent(detailMsg.content) }} />
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setDetailMsg(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
