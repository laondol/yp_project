import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'
import ScheduleCopyModal, { parseScheduleFromText } from '../components/ScheduleCopyModal'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import { formatKST } from '../utils/format'
import { useAuth } from '../contexts/AuthContext'

interface MessageItem {
  id: number; subject: string; content: string
  sender_id?: number; receiver_id?: number
  sender_name?: string; sender_username?: string | null; receiver_name?: string
  sender_role?: string; letter_type?: string
  is_read?: boolean; is_public?: boolean; is_notice?: boolean
  direction?: string; reply_to_id?: number
  created_at?: string; read_at?: string | null
  sender_is_friend?: boolean; is_root?: boolean; is_unread_reply?: boolean
  batch_key?: string | null; thread_key?: string | null
  receivers?: { id: number; username?: string | null; is_read?: boolean }[]
  unread_count?: number; total_count?: number
}

interface ThreadEntry {
  id: number; subject: string | null; content: string
  sender_id: number; sender_name: string; sender_username?: string | null
  sender_role?: string; sender_is_admin?: boolean; sender_is_friend?: boolean
  is_read?: boolean; read_at?: string | null; created_at?: string | null
  reply_to_id?: number | null; batch_key?: string | null
  box_index: number; unread_count?: number; total_count?: number
  letter_type?: string; is_public?: boolean
}

interface ThreadParticipant {
  id: number; username?: string | null; real_name?: string | null
  role?: string; display_name?: string; is_friend?: boolean
}

interface ThreadData {
  my_id: number; root_id: number; root_subject?: string | null
  root_sender_id: number; root_sender_name?: string; is_notice?: boolean
  thread: ThreadEntry[]; participants: ThreadParticipant[]; friend_ids: number[]
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

function isScheduleLetter(m?: { subject?: string } | null): boolean {
  if (!m) return false
  const s = m.subject || ''
  return s.startsWith('📅 일정 공유:') && !/(회신|답신)\d*$/.test(s)
}

function maskId(u?: string | null): string {
  if (!u) return ''
  const half = Math.ceil(u.length / 2)
  return u.slice(0, half) + '*'.repeat(u.length - half)
}

function UserIdLabel({ name, userId, isFriend, myId, unread, admin }: {
  name?: string; userId?: number
  isFriend?: boolean; myId?: number; unread?: boolean; admin?: boolean
}) {
  const { user } = useAuth()
  const color = unread ? '#dc3545' : undefined

  if (admin) {
    return <strong className="small" style={{ color }}>{name || 'admin@unocum.kr'}</strong>
  }
  const shown = name || '알수없음'
  const display = isFriend ? shown : maskId(shown)

  const sendFriendRequest = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!user?.id) {
      window.location.href = `/login?next=${window.location.pathname}`
      return
    }
    if (!userId || userId === user.id) return
    const notice =
      `${shown}님에게 벗 신청을 보냅니다.\n\n` +
      `⚠️ 안내\n` +
      `• 상대가 신청을 수락하면 신청자(나)의 이메일 일부가 상대에게 공개됩니다.\n` +
      `• 이에 따른 모든 책임은 신청인(나)에게 있습니다.\n` +
      `• 한 번 맺어진 벗은 헤어질 때 조정위원회의 조정을 받을 수 있습니다.\n\n` +
      `위 내용에 동의하고 벗 신청을 보낼까요?`
    if (!confirm(notice)) return
    try {
      const fd = new URLSearchParams()
      fd.set('share_login_location', '0')
      const r = await fetch(`/friends/request/${userId}`, { method: 'POST', body: fd, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      const d = await r.json()
      alert(d.msg || (d.status === 'success' ? '벗 신청을 보냈습니다.' : '오류'))
    } catch {
      alert('벗 신청 중 오류가 발생했습니다.')
    }
  }

  const clickable = !isFriend && !!userId && userId !== myId && userId !== user?.id
  return (
    <strong
      className="small"
      style={{
        color: clickable ? (unread ? '#dc3545' : '#0d6efd') : color,
        cursor: clickable ? 'pointer' : 'default',
        textDecoration: clickable ? 'underline' : 'none',
      }}
      title={clickable ? '벗 신청' : undefined}
      onClick={clickable ? sendFriendRequest : undefined}
    >
      {display}
    </strong>
  )
}

function ReplyComposer({ title, costLabel, onCancel, onSubmit }: {
  title: string; costLabel: string
  onCancel: () => void; onSubmit: (html: string) => Promise<boolean>
}) {
  const editorRef = useRef<ContentEditorHandle>(null)
  const [sending, setSending] = useState(false)

  const submit = async () => {
    const html = editorRef.current?.getContent()?.trim() || ''
    if (!html || html === '<br>' || html === '<div><br></div>') {
      alert('내용을 입력하세요.')
      return
    }
    setSending(true)
    try {
      await onSubmit(html)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border rounded p-2 mt-2" style={{ background: '#f8fbf8', borderColor: '#cfe8d5' }}>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <small className="fw-bold text-success">{title}</small>
        <small className="text-success">{costLabel}</small>
      </div>
      <ContentEditor
        ref={editorRef}
        uploadUrl="/api/message/upload-image"
        showLocation={false}
        placeholder="내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기, 📁 파일 첨부, ✏️ 그리기 가능)"
      />
      <div className="d-flex justify-content-end gap-1 mt-2">
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={sending}>취소</button>
        <button className="btn btn-sm btn-success" onClick={submit} disabled={sending}>
          {sending ? '전송 중…' : '보내기'}
        </button>
      </div>
    </div>
  )
}

function ThreadView({ data, myId, onRead, onRefresh, onReply }: {
  data: ThreadData; myId: number
  onRead: (id: number) => void
  onRefresh: () => void
  onReply: (replyToId: number, scope: 'public' | 'private', targetId: number | null, html: string) => Promise<boolean>
}) {
  const [reply, setReply] = useState<{ box: number; msgId: number; scope: 'public' | 'private'; targetId: number | null; title: string; cost: string } | null>(null)
  const [copySrc, setCopySrc] = useState<ThreadEntry | null>(null)

  const boxMap = new Map<number, ThreadEntry[]>()
  data.thread.forEach(e => {
    const arr = boxMap.get(e.box_index)
    if (arr) arr.push(e)
    else boxMap.set(e.box_index, [e])
  })
  const boxIndexes = [...boxMap.keys()].sort((a, b) => b - a)

  // 주제(원문) 박스와 실제 회신자(루트 작성자 제외) 집계 → 전체답신 표시 조건
  const rootBox = data.thread.find(e => e.id === data.root_id)?.box_index ?? 1
  const replierIds = new Set(
    data.thread.filter(e => e.reply_to_id != null && e.sender_id !== data.root_sender_id).map(e => e.sender_id)
  )

  const publicTargets = data.participants.filter(p => p.id !== myId)
  const publicCost = Math.max(1, publicTargets.length) * 10

  const openReply = (msg: ThreadEntry, scope: 'public' | 'private') => {
    if (scope === 'public') {
      const names = publicTargets.map(p => p.username || p.display_name || '').filter(Boolean)
      const label = names.length > 3 ? `${names.slice(0, 3).join(', ')} 외 ${names.length - 3}명` : (names.join(', ') || '전체 참여자')
      setReply({
        box: msg.box_index, msgId: msg.id, scope, targetId: null,
        title: `회신 → ${label}`,
        cost: `참여자 ${publicTargets.length}명 × 10닢 = ${publicCost}닢`,
      })
    } else {
      const target = data.participants.find(p => p.id === msg.sender_id)
      setReply({
        box: msg.box_index, msgId: msg.id, scope, targetId: msg.sender_id,
        title: `답신 → ${target?.username || target?.display_name || msg.sender_name}`,
        cost: '받는 1명 × 10닢 = 10닢',
      })
    }
  }

  const submitReply = async (html: string) => {
    if (!reply) return false
    const ok = await onReply(reply.msgId, reply.scope, reply.targetId, html)
    if (ok) {
      setReply(null)
      onRefresh()
    }
    return ok
  }

  return (
    <div className="mt-2">
      {data.root_subject && (
        <div className="fw-bold small mb-2 px-1" style={{ color: '#495057' }}>📌 {data.root_subject}</div>
      )}
      {boxIndexes.map(bi => {
        const msgs = boxMap.get(bi)!
        const last = msgs[msgs.length - 1]
        const iAmRoot = data.root_sender_id === myId
        const S = last.sender_id
        const sIsFriend = S === myId || data.friend_ids.includes(S) || S === data.root_sender_id
        const showPrivate = iAmRoot && S !== myId && data.friend_ids.includes(S)
        // 주제 박스에서만: 실제 회신자 2명 이상(단, 회신자 1명이 비벗이면 답신 불가 → 예외 표시)
        const singleNonFriend = replierIds.size === 1 && !data.friend_ids.includes([...replierIds][0])
        const showPublic = iAmRoot && !data.is_notice && bi === rootBox &&
          (replierIds.size >= 2 || singleNonFriend)
        return (
          <div key={bi} className="mb-3 border rounded overflow-hidden" style={{ borderRadius: 14, borderLeft: `4px solid ${bi % 2 === 0 ? '#6c757d' : '#0d6efd'}` }}>
            {showPublic && (
              <div className="px-3 pt-2 d-flex justify-content-end">
                <button className="btn btn-sm btn-outline-primary" onClick={() => openReply(last, 'public')}>전체답신</button>
              </div>
            )}
            {msgs.map(m => {
              const unread = !m.is_read && m.sender_id !== myId
              return (
                <div key={m.id} className="px-3 py-2" style={{ borderTop: '1px solid #f0f0f0' }}>
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <UserIdLabel
                      name={m.sender_name} userId={m.sender_id}
                      isFriend={m.sender_is_friend || m.sender_id === myId || data.friend_ids.includes(m.sender_id)}
                      myId={myId} unread={unread} admin={m.sender_is_admin}
                    />
                    <small className="text-muted">{m.created_at ? formatKST(m.created_at) : ''}</small>
                  </div>
                  <div className="letter-body small" style={{ overflowWrap: 'anywhere', lineHeight: 1.75 }}
                    dangerouslySetInnerHTML={{ __html: letterHtml(m.content) }} />
                  <div className="d-flex justify-content-between align-items-center mt-1">
                    <div className="d-flex gap-1 align-items-center flex-wrap">
                      {m.sender_id === myId && (m.unread_count ?? 0) > 0 && (
                        <span className="badge" style={{ background: '#198754', fontSize: '0.65rem' }}>
                          미확인 {m.unread_count}
                        </span>
                      )}
                      {isScheduleLetter({ subject: m.subject || undefined }) && (
                        <button className="btn btn-sm btn-outline-success" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                          onClick={() => setCopySrc(m)}>📅 내 일정에 복사</button>
                      )}
                    </div>
                    <div className="d-flex gap-1">
                      {unread && (
                        <button className="btn btn-sm btn-outline-success" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                          onClick={() => onRead(m.id)}>읽음</button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
            {!data.is_notice && (
              <div className="px-3 py-2 d-flex justify-content-end gap-1" style={{ borderTop: '1px dashed #dee2e6', background: '#fafbfc' }}>
                {showPrivate && (
                  <button className="btn btn-sm btn-outline-primary" onClick={() => openReply(last, 'private')}>답신</button>
                )}
                {!iAmRoot && sIsFriend && (
                  <button className="btn btn-sm btn-outline-primary" onClick={() => openReply(last, 'public')}>회신</button>
                )}
              </div>
            )}
            {reply && reply.box === bi && (
              <div className="px-3 pb-2">
                <ReplyComposer title={reply.title} costLabel={reply.cost}
                  onCancel={() => setReply(null)} onSubmit={submitReply} />
              </div>
            )}
          </div>
        )
      })}
      {copySrc && (
        <ScheduleCopyModal
          initial={parseScheduleFromText(copySrc.subject || data.root_subject || '', copySrc.content, copySrc.sender_name)}
          onClose={() => setCopySrc(null)}
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
  const [counts, setCounts] = useState({ received: 0, sent: 0, notice: 0, archive: 0 })
  const [myId, setMyId] = useState(0)
  const [openThread, setOpenThread] = useState<{ id: number; data: ThreadData } | null>(null)
  const [rowReply, setRowReply] = useState<{ id: number; cost: number; count: number } | null>(null)
  const [editId, setEditId] = useState<number | null>(null)

  const loadCounts = useCallback(async () => {
    try {
      const c = await fetch('/api/messages/counts').then(r => r.json())
      if (c && !c.error) setCounts(c)
    } catch { /* ignore */ }
  }, [])

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
      loadCounts()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [tab, loadCounts])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    setOpenThread(null)
    setRowReply(null)
    setEditId(null)
  }, [tab])

  const refreshThread = async (id: number) => {
    try {
      const res = await fetch(`/api/message/${id}/thread`).then(r => r.json())
      if (res && !res.error) setOpenThread({ id, data: res })
      else setOpenThread(null)
    } catch { /* ignore */ }
  }

  const refreshAll = async (threadId?: number) => {
    await load()
    if (threadId) await refreshThread(threadId)
  }

  const markRead = async (id: number) => {
    try {
      await fetch(`/message/read/${id}`, { method: 'POST' })
      refreshAll(openThread?.id)
    } catch { /* ignore */ }
  }

  const senderArchive = async (id: number) => {
    try {
      await fetch(`/api/message/sender-archive/${id}`, { method: 'POST' })
      refreshAll(openThread?.id)
    } catch { /* ignore */ }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('이 편지를 삭제할까요?')) return
    try {
      const r = await fetch(`/api/message/delete/${id}`, { method: 'POST' })
      const d = await r.json()
      if (d.status === 'success') refreshAll(openThread?.id === id ? undefined : openThread?.id)
      else alert(d.msg || '삭제 실패')
    } catch { alert('오류가 발생했습니다.') }
  }

  const sendReply = async (replyToId: number, scope: 'public' | 'private', targetId: number | null, html: string): Promise<boolean> => {
    try {
      const fd = new FormData()
      fd.append('subject', '')
      fd.append('content', html)
      fd.append('reply_to_id', String(replyToId))
      fd.append('scope', scope)
      if (scope === 'private' && targetId) fd.append('receiver_ids', String(targetId))
      const res = await fetch('/api/message/send', { method: 'POST', body: fd }).then(r => r.json())
      if (res.status !== 'success') {
        alert(res.msg || '전송에 실패했습니다.')
        return false
      }
      return true
    } catch {
      alert('오류가 발생했습니다.')
      return false
    }
  }

  const openRowReply = async (m: MessageItem) => {
    let count = 1
    try {
      const res = await fetch(`/api/message/${m.id}/thread`).then(r => r.json())
      if (res && Array.isArray(res.participants)) count = Math.max(1, res.participants.length - 1)
    } catch { /* fallback */ }
    setRowReply({ id: m.id, count, cost: count * 10 })
  }

  const submitRowReply = async (html: string) => {
    if (!rowReply) return false
    const ok = await sendReply(rowReply.id, 'public', null, html)
    if (ok) {
      setRowReply(null)
      setOpenThread(null)
      refreshAll()
    }
    return ok
  }

  const toggleThread = async (id: number) => {
    if (openThread?.id === id) {
      setOpenThread(null)
      return
    }
    await refreshThread(id)
  }

  const saveEdit = async (id: number, subject: string | null, content: string) => {
    try {
      const body: { content: string; subject?: string } = { content }
      if (subject !== null) body.subject = subject
      const r = await fetch(`/api/message/${id}/edit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json()
      if (d.status === 'success') {
        setEditId(null)
        refreshAll()
      } else {
        alert(d.msg || '수정 실패')
      }
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

  const preview = (m: MessageItem) => m.content?.replace(/<[^>]*>/g, '').slice(0, 80) || '(내용 없음)'

  const renderThread = (m: MessageItem) =>
    openThread?.id === m.id ? (
      <ThreadView data={openThread.data} myId={myId}
        onRead={markRead}
        onRefresh={() => refreshAll(openThread.id)}
        onReply={sendReply} />
    ) : null

  const renderRowReply = (m: MessageItem) =>
    rowReply?.id === m.id ? (
      <ReplyComposer
        title={`회신 (받는이 ${rowReply.count}명)`}
        costLabel={`참여자 ${rowReply.count}명 × 10닢 = ${rowReply.cost}닢`}
        onCancel={() => setRowReply(null)}
        onSubmit={submitRowReply} />
    ) : null

  const renderEdit = (m: MessageItem) => {
    if (editId !== m.id) return null
    return (
      <EditForm key={`edit-${m.id}`} row={m}
        onCancel={() => setEditId(null)}
        onSave={(subject, content) => saveEdit(m.id, subject, content)} />
    )
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
          ['archive', '보관함'],
        ] as [string, string][]).map(([key, label]) => {
          const cnt = counts[key as keyof typeof counts] || 0
          return (
            <li className="nav-item" key={key}>
              <button className={`nav-link fw-bold ${tab === key ? 'active' : ''}`}
                onClick={() => setSearchParams({ tab: key })}>
                {label}
                {cnt > 0 && (
                  <span className="badge bg-danger ms-1" style={{ fontSize: '0.65rem' }}>{cnt}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {messages.length === 0 ? (
        <EmptyState icon="📭" title={emptyMsg[tab] || '편지가 없습니다.'} />
      ) : (
        messages.map(m => {
          const isSent = m.direction === 'sent'
          const unreadReply = !!m.is_unread_reply
          const archiveTab = tab === 'archive'

          if (tab === 'sent') {
            const names = (m.receivers || []).map(r => r.username || `#${r.id}`)
            const unreadReceivers = new Set((m.receivers || []).filter(r => !r.is_read).map(r => r.id))
            return (
              <div key={m.id} className="card mb-2 border-0 shadow-sm" style={{ borderRadius: 14, borderLeft: '4px solid #adb5bd' }}>
                <div className="card-body p-3">
                  <div className="d-flex justify-content-between align-items-start">
                    <strong>{m.subject || '(제목 없음)'}</strong>
                    <small className="text-muted">{m.created_at ? formatKST(m.created_at) : ''}</small>
                  </div>
                  <div className="small mb-1 d-flex align-items-center gap-1 flex-wrap">
                    <span className="text-muted">받는이:</span>
                    {names.map((n, i) => (
                      <span key={i} style={{ color: unreadReceivers.has((m.receivers || [])[i]?.id) ? '#dc3545' : undefined, fontWeight: 600 }}>
                        {n}{i < names.length - 1 ? ',' : ''}
                      </span>
                    ))}
                    {(m.unread_count ?? 0) > 0 && (
                      <span className="badge" style={{ background: '#198754', fontSize: '0.65rem' }}>미확인 {m.unread_count}</span>
                    )}
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span className="small text-muted text-truncate flex-grow-1" style={{ fontSize: '0.85em' }}>{preview(m)}</span>
                    <button className="btn btn-sm btn-outline-secondary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => toggleThread(m.id)}>상세보기</button>
                    <button className="btn btn-sm btn-outline-primary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => setEditId(m.id)}>수정</button>
                    <button type="button" className="btn btn-sm btn-link text-danger p-0" title="삭제"
                      onClick={() => handleDelete(m.id)}>🗑</button>
                  </div>
                  {renderThread(m)}
                  {renderEdit(m)}
                </div>
              </div>
            )
          }

          return (
            <div key={m.id} className="card mb-2 border-0 shadow-sm" style={{
              borderRadius: 14,
              borderLeft: tab === 'received' ? '4px solid #27ae60'
                : tab === 'notice' ? '4px solid #6c757d'
                : unreadReply ? '4px solid #dc3545'
                : '4px solid #adb5bd',
            }}>
              <div className="card-body p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ minWidth: 0 }}>
                    {!isSent && (
                      <UserIdLabel
                        name={m.sender_name} userId={m.sender_id}
                        isFriend={m.sender_is_friend} myId={myId}
                        unread={unreadReply || tab === 'received' || tab === 'notice'}
                        admin={!!m.is_notice}
                      />
                    )}
                    {isSent && <span className="text-muted small">→ {(m.receivers || []).map(r => r.username || m.receiver_name || '').join(', ') || m.receiver_name}</span>}
                    <strong className="text-truncate" style={{ fontSize: '0.92em' }}>
                      {m.subject || (unreadReply ? '(회신)' : '(제목 없음)')}
                    </strong>
                  </div>
                  <div className="d-flex align-items-center gap-2 flex-shrink-0 ms-2">
                    <small className="text-muted" style={{ fontSize: '0.7rem' }}>{m.created_at ? formatKST(m.created_at) : ''}</small>
                    {archiveTab && m.read_at && (
                      <small className="text-muted" style={{ fontSize: '0.7rem' }}>읽음 {formatKST(m.read_at)}</small>
                    )}
                    <button type="button" className="btn btn-sm btn-link text-danger p-0" title="삭제"
                      onClick={() => handleDelete(m.id)}
                      style={{ display: isSent && m.is_read && !m.is_notice ? 'none' : undefined }}>🗑</button>
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2 mt-1">
                  <span className="small text-muted text-truncate flex-grow-1" style={{ fontSize: '0.85em' }}>{preview(m)}</span>
                  <button className="btn btn-sm btn-outline-secondary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                    onClick={() => toggleThread(m.id)}>상세보기</button>
                  {(tab === 'received' || tab === 'notice') && (!isSent || (tab === 'notice' && !!m.is_notice && !m.is_read)) && (
                    <button className="btn btn-sm btn-outline-success" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => (isSent ? senderArchive(m.id) : markRead(m.id))}>읽음</button>
                  )}
                  {tab === 'received' && !isSent && (
                    <button className="btn btn-sm btn-outline-primary" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => openRowReply(m)}>회신</button>
                  )}
                  {archiveTab && isSent && !m.is_read && !m.is_notice && (
                    <button className="btn btn-sm btn-outline-primary flex-shrink-0" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => setEditId(m.id)}>수정</button>
                  )}
                  {unreadReply && (
                    <button className="btn btn-sm btn-outline-success" style={{ fontSize: '0.7rem', padding: '1px 8px' }}
                      onClick={() => markRead(m.id)}>읽음</button>
                  )}
                </div>
                {renderThread(m)}
                {renderRowReply(m)}
                {renderEdit(m)}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}

function EditForm({ row, onCancel, onSave }: {
  row: MessageItem; onCancel: () => void
  onSave: (subject: string | null, content: string) => void
}) {
  const editorRef = useRef<ContentEditorHandle>(null)
  const [subject, setSubject] = useState(row.subject || '')
  const [saving, setSaving] = useState(false)

  const save = () => {
    const html = editorRef.current?.getContent()?.trim() || ''
    if (!html) {
      alert('내용을 입력하세요.')
      return
    }
    setSaving(true)
    try {
      onSave(row.is_root ? subject : null, html)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border rounded p-2 mt-2" style={{ background: '#fffdf5' }}>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <small className="fw-bold">✎ 편지 수정 {row.is_root ? '(제목·내용)' : '(내용)'}</small>
        <small className="text-muted">읽기 전까지 수정할 수 있습니다</small>
      </div>
      {row.is_root && (
        <input type="text" className="form-control form-control-sm mb-2" value={subject}
          onChange={e => setSubject(e.target.value)} placeholder="제목" />
      )}
      <ContentEditor ref={editorRef} initialContent={row.content} showLocation={false}
        uploadUrl="/api/message/upload-image"
        placeholder="내용을 입력하세요" />
      <div className="d-flex justify-content-end gap-1 mt-2">
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel} disabled={saving}>취소</button>
        <button className="btn btn-sm btn-primary" onClick={save} disabled={saving}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  )
}
