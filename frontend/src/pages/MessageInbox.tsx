import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'
import ScheduleCopyModal, { parseScheduleFromText } from '../components/ScheduleCopyModal'
import { formatKST } from '../utils/format'

interface MessageItem {
  id: number; subject: string; content: string
  sender_id?: number; receiver_id?: number
  sender_name?: string; receiver_name?: string
  sender_role?: string; letter_type?: string
  is_read?: boolean; is_public?: boolean
  direction?: string; reply_to_id?: number
  created_at?: string
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

function looksLikeHtml(text?: string): boolean {
  if (!text) return false
  return /<\/?[a-z][\s\S]*>/i.test(text)
}

function letterHtml(content?: string): string {
  if (!content) return ''
  if (!looksLikeHtml(content)) return linkify(content)
  let html = content
  html = html.replace(/<img([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;border-radius:8px;margin:6px 0" />')
  return html
}

interface ThreadGroup { root: MessageItem; children: MessageItem[] }

function buildThreads(msgs: MessageItem[]): ThreadGroup[] {
  const map = new Map<number, MessageItem>()
  msgs.forEach(m => map.set(m.id, m))
  const roots = new Map<number, MessageItem[]>()
  msgs.forEach(m => {
    const rootId = m.reply_to_id && map.has(m.reply_to_id) ? (() => {
      let cur = m
      const seen = new Set<number>()
      while (cur.reply_to_id && map.has(cur.reply_to_id) && !seen.has(cur.reply_to_id)) {
        seen.add(cur.id)
        cur = map.get(cur.reply_to_id)!
      }
      return cur.id
    })() : m.id
    if (!roots.has(rootId)) roots.set(rootId, [])
    roots.get(rootId)!.push(m)
  })
  const result: ThreadGroup[] = []
  msgs.forEach(m => {
    if (m.reply_to_id && map.has(m.reply_to_id)) return
    const children = roots.get(m.id) || []
    children.sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime())
    result.push({ root: m, children })
  })
  return result
}

function getLabel(idx: number, isOriginalSender: boolean): string {
  if (idx === 0) return '편지'
  const count = Math.ceil(idx / 2)
  return isOriginalSender ? `답신${count}` : `회신${count}`
}

function getLabelColor(idx: number, isOriginalSender: boolean): string {
  if (idx === 0) return '#6c757d'
  return isOriginalSender ? '#0d6efd' : '#27ae60'
}

function ArchiveThread({ root, children_msgs, myId, onDelete, onReply }: {
  root: MessageItem; children_msgs: MessageItem[]; myId: number
  onDelete: (id: number) => void; onReply: (id: number) => void
}) {
  const [open, setOpen] = useState(false)
  const [detailMsg, setDetailMsg] = useState<MessageItem | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const allItems = [root, ...children_msgs]
  const sortedAsc = [...allItems].sort((a, b) => new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime())
  const sortedDesc = [...sortedAsc].reverse()
  const latest = sortedAsc[sortedAsc.length - 1]
  const latestIsOrig = latest.sender_id === root.sender_id
  const latestIdx = sortedAsc.length - 1
  const iAmOrigSender = root.sender_id === myId
  const replyBtnLabel = iAmOrigSender ? '답신' : '회신'

  return (
    <div className="mb-2 border rounded shadow-sm" style={{ borderRadius: 14 }}>
      <div className="p-3" style={{ cursor: 'pointer' }} onClick={() => setOpen(v => !v)}>
        <div className="d-flex justify-content-between align-items-center">
          <div className="d-flex align-items-center gap-2 flex-grow-1">
            <span className="badge" style={{ background: getLabelColor(latestIdx, latestIsOrig), fontSize: '0.6rem' }}>
              {getLabel(latestIdx, latestIsOrig)}
            </span>
            <span className="text-truncate fw-bold" style={{ fontSize: '0.92em' }}>{latest.subject || '(제목 없음)'}</span>
          </div>
          <div className="d-flex align-items-center gap-2 flex-shrink-0 ms-2">
            <small className="text-muted" style={{ fontSize: '0.7rem' }}>{latest.created_at ? formatKST(latest.created_at) : ''}</small>
            <button className="btn btn-sm btn-outline-primary" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
              onClick={(e) => { e.stopPropagation(); onReply(latest.id) }}>{replyBtnLabel}</button>
            <span style={{ fontSize: '0.8rem' }}>{open ? '▲' : '▼'}</span>
          </div>
        </div>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid #e9ecef' }}>
          {sortedDesc.map((m, idx) => {
            const isOrig = m.sender_id === root.sender_id
            const origIdx = sortedAsc.indexOf(m)
            const lColor = getLabelColor(origIdx, isOrig)
            const label = isOrig ? '편지' : getLabel(origIdx, isOrig)
            const preview = m.content?.replace(/<[^>]*>/g, '').slice(0, 80) || ''
            return (
              <div key={m.id} style={{
                padding: '10px 14px',
                borderBottom: idx < sortedDesc.length - 1 ? '1px solid #f0f0f0' : 'none',
                borderLeft: `3px solid ${lColor}`,
              }}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <div className="d-flex align-items-center gap-1">
                    <span className="badge" style={{ background: lColor, fontSize: '0.55rem', minWidth: 36 }}>{label}</span>
                    <strong className="small">{m.subject || '(제목 없음)'}</strong>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <small className="text-muted" style={{ fontSize: '0.65rem' }}>{m.created_at ? formatKST(m.created_at) : ''}</small>
                    <button type="button" className="btn btn-sm btn-link text-danger p-0" title="삭제"
                      onClick={(e) => { e.stopPropagation(); onDelete(m.id) }}>🗑</button>
                  </div>
                </div>
                <div className="small text-muted mb-1">
                  {m.direction === 'sent' ? `→ ${m.receiver_name}` : m.sender_name}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="small text-muted text-truncate flex-grow-1" style={{ fontSize: '0.82em' }}>{preview || '(내용 없음)'}</span>
                  <button className="btn btn-sm btn-outline-secondary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                    onClick={(e) => { e.stopPropagation(); setDetailMsg(m) }}>상세보기</button>
                </div>
              </div>
            )
          })}
          <div className="text-end p-2 bg-white">
            <button className="btn btn-sm btn-outline-primary"
              onClick={() => onReply(sortedAsc[sortedAsc.length - 1].id)}>{replyBtnLabel}</button>
          </div>
        </div>
      )}
      {detailMsg && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setDetailMsg(null)}>
          <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 14 }}>
              <div className="modal-header py-2">
                <div className="d-flex align-items-center gap-2">
                  <span className="badge" style={{ background: getLabelColor(sortedAsc.indexOf(detailMsg), detailMsg.sender_id === root.sender_id) }}>
                    {detailMsg.sender_id === root.sender_id ? '편지' : getLabel(sortedAsc.indexOf(detailMsg), detailMsg.sender_id === root.sender_id)}
                  </span>
                  <h6 className="modal-title mb-0">{detailMsg.subject || '(제목 없음)'}</h6>
                </div>
                <button type="button" className="btn-close" onClick={() => setDetailMsg(null)}></button>
              </div>
              <div className="modal-body">
                <div className="d-flex justify-content-between mb-2">
                  <small className="text-muted">{detailMsg.direction === 'sent' ? `→ ${detailMsg.receiver_name}` : detailMsg.sender_name}</small>
                  <small className="text-muted">{detailMsg.created_at ? formatKST(detailMsg.created_at) : ''}</small>
                </div>
                <div className="p-3 bg-light rounded letter-body" style={{ overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: '0.92em' }}
                  dangerouslySetInnerHTML={{ __html: letterHtml(detailMsg.content) }} />
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-outline-success" onClick={() => setCopyOpen(true)}>📅 내 일정에 복사</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setDetailMsg(null)}>닫기</button>
                <button className="btn btn-sm btn-outline-primary" onClick={() => { setDetailMsg(null); onReply(detailMsg.id) }}>{replyBtnLabel}</button>
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

export default function MessageInbox() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'received'
  const [messages, setMessages] = useState<MessageItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [archiveCount, setArchiveCount] = useState(0)
  const [myId, setMyId] = useState(0)
  const [detailMsg, setDetailMsg] = useState<MessageItem | null>(null)
  const [copyOpen, setCopyOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await fetch(`/api/messages?tab=${tab}`).then(r => r.json())
      if (data && data.messages) {
        setMyId(data.my_id || 0)
        setMessages(data.messages)
      } else {
        setMessages(Array.isArray(data) ? data : [])
      }
      const cnt = await fetch('/api/messages/archive-count').then(r => r.json())
      setArchiveCount(cnt.count || 0)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [tab])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (tab === 'archive') setArchiveCount(0)
  }, [tab])

  const markRead = async (id: number) => {
    try {
      await fetch(`/message/read/${id}`, { method: 'POST' })
      load()
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('이 편지를 삭제할까요?')) return
    try {
      const r = await fetch(`/api/message/delete/${id}`, { method: 'POST' })
      const d = await r.json()
      if (d.status === 'success') load()
      else alert(d.msg || '삭제 실패')
    } catch { alert('오류가 발생했습니다.') }
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  const emptyMsg: Record<string, string> = {
    received: '벗으로부터 온 읽지 않은 편지가 없습니다.',
    sent: '보낸 읽지 않은 편지가 없습니다.',
    notice: '공지가 없습니다.',
    archive: '보관함이 비어 있습니다.',
  }

  return (
    <div style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold text-success">편지함</h3>
        <button className="btn btn-success btn-sm" onClick={() => navigate('/message/send')}>편지 보내기</button>
      </div>

      <ul className="nav nav-tabs mb-3">
        {([
          ['received', '벗으로부터'],
          ['sent', '벗에게'],
          ['notice', '📢 공지'],
          ['archive', '보관함', archiveCount],
        ] as [string, string, number?][]).map(([key, label, cnt]) => (
          <li className="nav-item" key={key}>
            <button className={`nav-link fw-bold ${tab === key ? 'active' : ''}`}
              onClick={() => setSearchParams({ tab: key })}>
              {label}
              {cnt != null && cnt > 0 && (
                <span className="badge bg-danger ms-1" style={{ fontSize: '0.65rem' }}>{cnt}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {messages.length === 0 ? (
        <EmptyState icon="📭" title={emptyMsg[tab] || '편지가 없습니다.'} />
      ) : tab === 'archive' ? (
        buildThreads(messages).map(({ root, children }) => (
          <ArchiveThread key={root.id} root={root} children_msgs={children} myId={myId}
            onDelete={handleDelete} onReply={(id: number) => navigate(`/message/send?reply_to=${id}`)} />
        ))
      ) : (
        messages.map(m => {
          const isSent = m.direction === 'sent'
          return (
            <div key={m.id} className="card mb-2 border-0 shadow-sm" style={{
              borderRadius: 14,
              borderLeft: tab === 'received' ? '4px solid #27ae60'
                : tab === 'sent' ? '4px solid #adb5bd'
                : '4px solid #6c757d',
            }}>
              <div className="card-body p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <strong>{m.subject || '(제목 없음)'}</strong>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <small className="text-muted">{m.created_at ? formatKST(m.created_at) : ''}</small>
                    <button type="button" className="btn btn-sm btn-link text-danger p-0" title="삭제"
                      onClick={() => handleDelete(m.id)}>🗑</button>
                  </div>
                </div>
                <div className="small text-muted mb-1">
                  {isSent ? `→ ${m.receiver_name}` : m.sender_name}
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="small text-muted text-truncate flex-grow-1" style={{ fontSize: '0.85em' }}>
                    {m.content?.replace(/<[^>]*>/g, '').slice(0, 80) || '(내용 없음)'}
                  </span>
                  <button className="btn btn-sm btn-outline-secondary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                    onClick={() => setDetailMsg(m)}>상세보기</button>
                </div>
                <div className="d-flex justify-content-end gap-1 mt-1">
                  {tab === 'received' && (
                    <>
                      <button className="btn btn-sm btn-outline-success" onClick={() => markRead(m.id)}>읽음</button>
                      <button className="btn btn-sm btn-outline-primary"
                        onClick={() => navigate(`/message/send?reply_to=${m.id}`)}>회신</button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )
        })
      )}
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
                  <small className="text-muted">{detailMsg.direction === 'sent' ? `→ ${detailMsg.receiver_name}` : detailMsg.sender_name}</small>
                  <small className="text-muted">{detailMsg.created_at ? formatKST(detailMsg.created_at) : ''}</small>
                </div>
                <div className="p-3 bg-light rounded letter-body" style={{ overflowWrap: 'anywhere', lineHeight: 1.8, fontSize: '0.92em' }}
                  dangerouslySetInnerHTML={{ __html: letterHtml(detailMsg.content) }} />
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
