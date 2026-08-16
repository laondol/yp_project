import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api, villageApi } from '../lib/api'
import type { VillageEvent, VillageAlert, VillageWish } from '../lib/types'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import { formatKST } from '../utils/format';

interface VillageMember {
  id: number
  real_name?: string
  email?: string
  village?: string
  is_verified_resident?: boolean
  verified_method?: string
}

type Tab = 'feed' | 'members' | 'activities' | 'message' | 'qr'

export default function VillageAdminPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('feed')
  const [events, setEvents] = useState<VillageEvent[]>([])
  const [alerts, setAlerts] = useState<VillageAlert[]>([])
  const [wishes, setWishes] = useState<VillageWish[]>([])
  const [members, setMembers] = useState<VillageMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [messageSubject, setMessageSubject] = useState('')
  const [messageFile, setMessageFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [messageResult, setMessageResult] = useState('')
  const [sendingOverlay, setSendingOverlay] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const managed = user?.managed_pages ?? []
  const hasAccess = managed.some(p => p.startsWith('village') || p.startsWith('vi_'))

  const loadFeed = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [ev, al, wi] = await Promise.all([
        villageApi.events().catch(() => []),
        villageApi.alerts().catch(() => []),
        villageApi.wishes().catch(() => []),
      ])
      setEvents(Array.isArray(ev) ? ev : [])
      setAlerts(Array.isArray(al) ? al : [])
      setWishes(Array.isArray(wi) ? wi : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  const loadMembers = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await api.get<VillageMember[]>('/api/village/members')
      setMembers(Array.isArray(data) ? data : [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!hasAccess) return
    if (tab === 'feed') loadFeed()
    else if (tab === 'members') loadMembers()
    else setLoading(false)
  }, [tab, authLoading, hasAccess])

  const execCmd = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val)
    if (editorRef.current) editorRef.current.focus()
  }

  const insertLink = () => {
    const url = prompt('링크 URL을 입력하세요:', 'https://')
    if (url) execCmd('createLink', url)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('image', file)
      const res = await fetch('/api/message/upload-image', { method: 'POST', body: fd }).then(r => r.json())
      if (res.url && editorRef.current) {
        execCmd('insertHTML', `<img src="${res.url}" style="max-width:100%;border-radius:8px;margin:8px 0" />`)
      }
    } catch { alert('이미지 업로드 실패') }
    finally { setUploading(false); if (fileInputRef.current) fileInputRef.current.value = '' }
  }

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = editorRef.current?.innerHTML || ''
    if (!content.trim() || sending) return
    setSending(true); setSendingOverlay(true); setMessageResult('')
    try {
      const fd = new FormData()
      fd.append('subject', messageSubject)
      fd.append('content', content)
      if (messageFile) fd.append('attachment', messageFile)
      await api.upload('/village/message-all', fd)
      setMessageResult('발송 완료')
      setMessageSubject('')
      if (editorRef.current) editorRef.current.innerHTML = ''
      setMessageFile(null)
    } catch (e: any) { setMessageResult('오류: ' + (e.message || '전송 실패')) }
    finally { setSending(false); setSendingOverlay(false) }
  }

  if (authLoading) return <Loading />
  if (!hasAccess) return <ErrorMessage message="접근 권한이 없습니다." />

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h4 className="fw-bold mb-3">마을 관리</h4>
      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button className={`nav-link ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>마을피드</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>마을회원</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'activities' ? 'active' : ''}`} onClick={() => setTab('activities')}>활동</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'message' ? 'active' : ''}`} onClick={() => setTab('message')}>✉️ 전체편지</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'qr' ? 'active' : ''}`} onClick={() => setTab('qr')}>QR초대</button></li>
      </ul>

      {tab === 'feed' && (
        loading ? <Loading /> : error ? <ErrorMessage message={error} onRetry={loadFeed} /> : (
          <div>
            <h5 className="fw-bold mb-2">알림 ({alerts.length})</h5>
            {alerts.slice(0, 5).map(a => (
              <div key={a.id} className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12 }}>
                <div className="card-body p-3">
                  <strong>{a.title}</strong>
                  {a.content && <p className="small text-muted mt-1 mb-0">{a.content}</p>}
                </div>
              </div>
            ))}
            <h5 className="fw-bold mb-2 mt-3">활동 ({events.length})</h5>
            {events.slice(0, 5).map(e => (
              <div key={e.id} className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12, cursor: 'pointer' }}
                onClick={() => navigate(`/village/events/${e.id}`)}>
                <div className="card-body p-3 d-flex justify-content-between">
                  <span><span className={`badge ${e.event_type === 'meeting' ? 'bg-info' : 'bg-warning'} me-1`}>{e.event_type === 'meeting' ? '모임' : '활동'}</span>{e.title}</span>
                  <small className="text-muted">{e.event_date ? formatKST(e.event_date) : ''}</small>
                </div>
              </div>
            ))}
            <h5 className="fw-bold mb-2 mt-3">바람 ({wishes.length})</h5>
            {wishes.slice(0, 5).map(w => (
              <div key={w.id} className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12 }}>
                <div className="card-body p-3">
                  <p className="mb-1">{w.content}</p>
                  <small className="text-muted">{w.status} | {w.created_at ? formatKST(w.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'members' && (
        loading ? <Loading /> : error ? <ErrorMessage message={error} onRetry={loadMembers} /> : (
          <div className="table-responsive">
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr><th>이름</th><th>이메일</th><th>마을</th><th>진위확인</th></tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id}>
                    <td>{m.real_name || '-'}</td>
                    <td>{m.email || '-'}</td>
                    <td>{m.village || '-'}</td>
                    <td>{m.is_verified_resident ? <span className="badge bg-success">완료</span> : <span className="badge bg-secondary">미확인</span>}</td>
                  </tr>
                ))}
                {members.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted py-4">회원이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )
      )}

      {tab === 'activities' && (
        loading ? <Loading /> : error ? <ErrorMessage message={error} onRetry={loadFeed} /> : (
          <div>
            {events.length === 0 ? <p className="text-muted text-center py-4">등록된 활동이 없습니다.</p> : (
              events.map(e => (
                <div key={e.id} className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12, cursor: 'pointer' }}
                  onClick={() => navigate(`/village/events/${e.id}`)}>
                  <div className="card-body p-3 d-flex justify-content-between">
                    <div>
                      <span className={`badge ${e.event_type === 'meeting' ? 'bg-info' : 'bg-warning'} me-1`}>{e.event_type === 'meeting' ? '모임' : '활동'}</span>
                      <strong>{e.title}</strong>
                    </div>
                    <small className="text-muted">{e.event_date ? formatKST(e.event_date) : ''}</small>
                  </div>
                  <div className="px-3 pb-2 small text-muted">📍 {e.location || '미정'}</div>
                </div>
              ))
            )}
            <button className="btn btn-sm btn-success mt-2" onClick={() => navigate('/village/events/create')}>+ 새 활동</button>
          </div>
        )
      )}

      {tab === 'message' && (
        <form onSubmit={handleSendMessage} className="card border-0 shadow-sm p-4" style={{ borderRadius: 16 }}>
          <h6 className="fw-bold mb-3">📨 마을 전체 회원에게 편지 발송</h6>
          <div className="mb-3">
            <label className="small fw-bold">제목</label>
            <input type="text" className="form-control" value={messageSubject} onChange={e => setMessageSubject(e.target.value)} placeholder="편지 제목" />
          </div>
          <div className="mb-3">
            <label className="small fw-bold">내용</label>
            <div className="border rounded" style={{ overflow: 'hidden' }}>
              <div className="d-flex flex-wrap gap-1 p-2 bg-light border-bottom">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => execCmd('bold')} title="굵게"><b>B</b></button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => execCmd('italic')} title="기울임"><i>I</i></button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => execCmd('underline')} title="밑줄"><u>U</u></button>
                <span className="border-start mx-1"></span>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => execCmd('insertUnorderedList')} title="목록">☰</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => execCmd('insertOrderedList')} title="번호 목록">#</button>
                <span className="border-start mx-1"></span>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={insertLink} title="링크">🔗</button>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }} title="사진 넣기">
                  {uploading ? '⏳' : '📷'}
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="d-none" onChange={handleImageUpload} />
              <div ref={editorRef} contentEditable suppressContentEditableWarning
                className="form-control" style={{ minHeight: 200, maxHeight: 400, overflowY: 'auto', border: 'none', borderRadius: 0, boxShadow: 'none' }}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="small fw-bold">파일 첨부</label>
            <input type="file" className="form-control form-control-sm" onChange={e => setMessageFile(e.target.files?.[0] || null)} />
          </div>
          <button type="submit" className="btn btn-success w-100" disabled={sending}>
            {sending ? '전송 중...' : '전체 편지 보내기'}
          </button>
          {messageResult && <div className={`small mt-2 ${messageResult.includes('오류') ? 'text-danger' : 'text-success'}`}>{messageResult}</div>}
          {sendingOverlay && (
            <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 9999 }}>
              <div className="bg-white rounded shadow p-4 text-center">
                <div className="spinner-border text-success mb-2" role="status" />
                <div className="fw-bold">편지 발송 중...</div>
              </div>
            </div>
          )}
        </form>
      )}

      {tab === 'qr' && (
        <div className="text-center py-4">
          <p className="text-muted mb-3">QR 초대 페이지로 이동합니다.</p>
          <button className="btn btn-success" onClick={() => navigate('/village/qr')}>QR 초대 페이지 열기</button>
        </div>
      )}
    </div>
  )
}
