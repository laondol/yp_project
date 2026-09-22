import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import ScheduleCopyModal, { parseScheduleFromText } from '../components/ScheduleCopyModal'

interface UserOption {
  id: number; username: string; real_name?: string; town?: string; village?: string
}

interface ThreadItem {
  id: number; subject: string; content: string
  sender_id?: number
  sender_name?: string; sender_is_admin?: boolean
  sender_role?: string; created_at?: string
}

function looksLikeHtml(text?: string): boolean {
  if (!text) return false
  return /<\/?[a-z][\s\S]*>/i.test(text)
}

function escHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderContent(content?: string): string {
  if (!content) return ''
  if (!looksLikeHtml(content)) return escHtml(content).replace(/\n/g, '<br>')
  return content.replace(/<img([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;border-radius:8px;margin:6px 0" />')
}

function formatDate(iso?: string): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function MessageSend() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const replyTo = searchParams.get('reply_to')
  const editorRef = useRef<ContentEditorHandle>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [showThread, setShowThread] = useState(false)
  const [detailMsg, setDetailMsg] = useState<ThreadItem | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [useExternalEmail, setUseExternalEmail] = useState(false)
  const [externalEmail, setExternalEmail] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await fetch('/api/message/users').then(r => r.json())
      setUsers(data)

      if (replyTo) {
        try {
          const orig = await fetch(`/api/message/${replyTo}`).then(r => r.json())
          if (orig && !orig.error) {
            const origSubject = orig.subject || '편지'
            const lastMatch = origSubject.match(/(회신|답신)(\d*)$/)
            let nextType: string
            let nextNum: number
            if (lastMatch) {
              const lastWord = lastMatch[1]
              const lastNum = lastMatch[2] ? parseInt(lastMatch[2]) : 1
              nextType = lastWord === '회신' ? '답신' : '회신'
              nextNum = lastWord === '회신' ? lastNum : lastNum + 1
            } else {
              nextType = '회신'
              nextNum = 1
            }
            setSubject(`${origSubject} ${nextType}${nextNum}`)

            try {
              const res = await fetch(`/api/message/${replyTo}/thread`).then(r => r.json())
              const threadData = res.thread || res
              if (Array.isArray(threadData) && threadData.length > 0) {
                threadData.reverse()
                setThread(threadData)
                const myId = res.my_id || 0
                const lastMsg = threadData[threadData.length - 1]
                const recipient = lastMsg.sender_id === myId
                  ? threadData.find((t: ThreadItem) => t.sender_id !== myId)?.sender_id || lastMsg.sender_id
                  : lastMsg.sender_id
                setSelectedIds([recipient])
              } else {
                if (orig.sender_id) setSelectedIds([orig.sender_id])
              }
            } catch { /* 스레드 조회 실패 시 */ }
          }
        } catch { /* 원문 조회 실패 시 무시 */ }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [replyTo])

  useEffect(() => { load() }, [load])

  const toggleId = (id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }
  const toggleAll = () => {
    setSelectedIds(prev => prev.length === users.length ? [] : users.map(u => u.id))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = editorRef.current?.getContent()?.trim() || ''
    if (selectedIds.length === 0 && !externalEmail) return
    if (!content) return
    setSending(true); setResult('')
    try {
      const fd = new FormData()
      if (selectedIds.length > 0) fd.append('receiver_ids', selectedIds.join(','))
      if (useExternalEmail && externalEmail) fd.append('external_email', externalEmail)
      fd.append('subject', subject)
      fd.append('content', content)
      if (replyTo) fd.append('reply_to_id', replyTo)
      const res = await fetch('/api/message/send', { method: 'POST', body: fd }).then(r => r.json())
      if (res.status === 'success') {
        navigate('/message/inbox?tab=archive')
        return
      } else {
        setResult(res.msg || '전송 실패')
      }
    } catch { setResult('오류가 발생했습니다.') }
    finally { setSending(false) }
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold text-success">편지 {replyTo ? '회신' : '보내기'}</h3>
        <button className="btn btn-sm btn-outline-success" onClick={() => navigate('/message/inbox')}>받은 편지</button>
      </div>

      <div className="card border-0 shadow-sm p-4" style={{ borderRadius: 18 }}>
        <form onSubmit={handleSubmit}>
          {thread.length > 0 && (
            <div className="mb-3">
              <button type="button" className="btn btn-sm btn-outline-secondary w-100 d-flex align-items-center justify-content-center gap-1"
                onClick={() => setShowThread(v => !v)}
                style={{ borderRadius: 10 }}>
                <span>{showThread ? '▲' : '▼'}</span>
                <span>편지 보기 — {thread[thread.length - 1]?.subject || '(제목 없음)'} ({thread.length}개)</span>
              </button>
              {showThread && (
                <div className="mt-2" style={{ maxHeight: 400, overflowY: 'auto' }}>
                  {thread.map((item, idx) => {
                    const isLast = idx === thread.length - 1
                    const isOrigSender = item.sender_id === thread[0].sender_id
                    const label = idx === 0 ? '편지' : isOrigSender ? `답신${Math.ceil(idx / 2)}` : `회신${Math.ceil(idx / 2)}`
                    const labelColor = idx === 0 ? '#6c757d' : isOrigSender ? '#0d6efd' : '#27ae60'
                    return (
                      <div key={item.id} style={{
                        padding: '12px 14px', marginBottom: isLast ? 0 : 2,
                        background: isLast ? '#e8f5e9' : '#f8f9fa',
                        borderRadius: isLast ? '10px 10px 0 0' : idx === thread.length - 1 ? '0 0 10px 10px' : 0,
                        borderLeft: `4px solid ${labelColor}`,
                      }}>
                        <div className="d-flex justify-content-between align-items-center mb-1">
                          <div className="d-flex align-items-center gap-1">
                            <span className="badge" style={{ background: labelColor, fontSize: '0.65rem' }}>{label}</span>
                            <strong className="small">{item.subject || '(제목 없음)'}</strong>
                          </div>
                          <small className="text-muted" style={{ fontSize: '0.7rem' }}>{formatDate(item.created_at)}</small>
                        </div>
                        <div className="small text-muted mb-1">
                          {item.sender_is_admin ? '함께사는양평' : item.sender_name || '알수없음'}
                        </div>
                        <div className="d-flex align-items-center gap-2">
                          <span className="small text-muted text-truncate flex-grow-1" style={{ fontSize: '0.85em' }}>
                            {item.content?.replace(/<[^>]*>/g, '').slice(0, 80) || '(내용 없음)'}
                          </span>
                          <button className="btn btn-sm btn-outline-secondary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                            onClick={() => setDetailMsg(item)}>상세보기</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <div className="mb-3">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <label className="form-label small fw-bold mb-0">받는 사람 (여러 명 선택 가능)</label>
              <button type="button" className="btn btn-sm btn-link p-0" onClick={toggleAll}>
                {selectedIds.length === users.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            <div className="border rounded p-2" style={{ maxHeight: 200, overflowY: 'auto' }}>
              {users.length === 0 && <div className="text-muted small">친구가 없습니다.</div>}
              {users.map(u => (
                <div key={u.id} className="form-check">
                  <input className="form-check-input" type="checkbox" id={`rcv-${u.id}`}
                    checked={selectedIds.includes(u.id)} onChange={() => toggleId(u.id)} />
                  <label className="form-check-label small" htmlFor={`rcv-${u.id}`}>{u.username}{u.real_name ? ` (${u.real_name})` : ''}</label>
                </div>
              ))}
            </div>
            {selectedIds.length > 0 && <div className="small text-muted mt-1">선택한 벗: {selectedIds.length}명</div>}
          </div>

          {/* 외부 이메일 발송 */}
          <div className="mb-3 p-3 bg-light rounded">
            <div className="form-check form-switch mb-2">
              <input className="form-check-input" type="checkbox" id="useExternalEmail"
                checked={useExternalEmail} onChange={e => setUseExternalEmail(e.target.checked)} />
              <label className="form-check-label small fw-bold" htmlFor="useExternalEmail">
                외부 이메일로도 보내기
              </label>
            </div>
            {useExternalEmail && (
              <div>
                <input type="email" className="form-control form-control-sm"
                  value={externalEmail} onChange={e => setExternalEmail(e.target.value)}
                  placeholder="받는 사람 이메일 (예: example@naver.com)" />
                <div className="text-muted small mt-1">
                  회원가입한 이메일로 발송됩니다. 분당 5건, 일일 30건 제한이 있습니다.
                </div>
              </div>
            )}
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">제목 (선택)</label>
            <input type="text" className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="편지 제목" />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">내용</label>
            <ContentEditor ref={editorRef} uploadUrl="/api/message/upload-image" placeholder="편지 내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기, 📁 버튼으로 파일 첨부 가능)" />
          </div>
          <div className="text-muted small mb-3">벗 1명당 10닢이 차감됩니다. 외부 이메일은 무료입니다.</div>
          <button type="submit" className="btn btn-success w-100 fw-bold py-2"
            disabled={sending || (selectedIds.length === 0 && !externalEmail)}>
            {sending ? '전송 중...' : `보내기 (${selectedIds.length > 0 ? selectedIds.length * 10 : 0}P${externalEmail && useExternalEmail ? ' + 이메일' : ''})`}
          </button>
        </form>
        {result && <div className={`mt-3 small ${result.includes('✅') || result.includes('전송') ? 'text-success' : 'text-danger'}`}>{result}</div>}
      </div>
      {detailMsg && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDetailMsg(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 14 }}>
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0">{detailMsg.subject || '(제목 없음)'}</h6>
                <button type="button" className="btn-close" onClick={() => setDetailMsg(null)}></button>
              </div>
              <div className="modal-body">
                <div className="d-flex justify-content-between mb-2">
                  <small className="text-muted">{detailMsg.sender_is_admin ? '함께사는양평' : detailMsg.sender_name || '알수없음'}</small>
                  <small className="text-muted">{formatDate(detailMsg.created_at)}</small>
                </div>
                <div className="p-3 bg-light rounded letter-body" style={{ overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: '0.92em' }}
                  dangerouslySetInnerHTML={{ __html: renderContent(detailMsg.content) }} />
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-outline-success" onClick={() => setCopyOpen(true)}>📅 내 일정에 복사</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setDetailMsg(null)}>닫기</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {copyOpen && detailMsg && (
        <ScheduleCopyModal
          initial={parseScheduleFromText(detailMsg.subject, detailMsg.content, detailMsg.sender_name)}
          onClose={() => setCopyOpen(false)}
        />
      )}
    </div>
  )
}
