import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import Loading from '../components/common/Loading'
import { formatKST } from '../utils/format';

interface Member {
  id: number; real_name: string; email: string; town: string; village: string
  is_verified_resident: boolean; jin_verified_at: string | null; photo_path: string
}
interface PostItem {
  id: number; title: string; content: string; created_at: string | null; user_id: number
}
interface FeedItem {
  type: string; id: number; title?: string; content?: string; subject?: string; sender_name?: string
  description?: string; image_path?: string; status?: string; reply?: string | null
  user_id?: number; created_at: string | null
}
interface DashboardData {
  village_ris: { myeon: string; ri: string }[]
  member_count: number
  members: Member[]
}

export default function VillagePage() {
  const navigate = useNavigate()
  const [data, setData] = useState<DashboardData | null>(null)
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'feed' | 'members'>('feed')
  const [editPost, setEditPost] = useState<PostItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [msgSubject, setMsgSubject] = useState('')
  const [msgFile, setMsgFile] = useState<File | null>(null)
  const [msgSending, setMsgSending] = useState(false)
  const [msgResult, setMsgResult] = useState('')
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [permitShareId, setPermitShareId] = useState<number | null>(null)
  const [permitMsg, setPermitMsg] = useState('')
  const [permitSending, setPermitSending] = useState(false)
  const [sendingOverlay, setSendingOverlay] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [d, f] = await Promise.all([
        api.get<DashboardData>('/api/village/dashboard'),
        api.get<FeedItem[]>('/api/village/feed'),
      ])
      setData(d); setFeed(f)
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

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

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = editorRef.current?.innerHTML || ''
    if (!content.trim() || msgSending) return
    setMsgSending(true)
    setSendingOverlay(true)
    setMsgResult('')
    const fd = new FormData()
    fd.append('subject', msgSubject)
    fd.append('content', content)
    if (msgFile) fd.append('attachment', msgFile)
    try {
      const r = await api.upload<{ status: string; msg: string }>('/village/message-all', fd)
      setMsgResult(r.msg)
      setMsgSubject('')
      if (editorRef.current) editorRef.current.innerHTML = ''
      setMsgFile(null)
    } catch (e: any) { setMsgResult('오류: ' + e.message) }
    finally { setMsgSending(false); setSendingOverlay(false) }
  }

  const requestPermission = async (shareId: number) => {
    setPermitSending(true)
    const fd = new FormData()
    fd.append('share_id', String(shareId))
    fd.append('message', permitMsg)
    try {
      const r = await api.upload<{ status: string; msg: string }>('/api/village/content/permission-request', fd)
      alert(r.msg)
      setPermitShareId(null)
      setPermitMsg('')
    } catch (e: any) { alert(e.message) }
    finally { setPermitSending(false) }
  }

  const jinVerify = async (memberId: number) => {
    try {
      const r = await api.post<{ status: string }>(`/village/jin-verify/${memberId}`)
      if (r.status === 'success') load()
    } catch {}
  }

  const saveEdit = async () => {
    if (!editPost) return
    try {
      const fd = new FormData()
      fd.append('title', editTitle)
      fd.append('content', editContent)
      const r = await api.upload<{ status: string; msg: string }>(`/post/${editPost.id}/edit`, fd)
      alert(r.msg)
      if (r.status === 'success') load()
    } catch (e: any) { alert(e.message) }
  }

  const renderContent = (item: FeedItem) => {
    switch (item.type) {
      case 'broadcast':
        return (
          <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12, borderLeft: '4px solid #0d6efd' }}>
            <div className="card-body p-3">
              <div className="d-flex justify-content-between">
                <div>
                  <span className="badge bg-primary me-1">📢 전체편지</span>
                  <strong>{item.subject}</strong>
                </div>
                <small className="text-muted">{item.created_at ? formatKST(item.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
              </div>
              <div className="small mt-1" dangerouslySetInnerHTML={{ __html: item.content || '' }} />
              <div className="small text-muted mt-1">발신: {item.sender_name}</div>
            </div>
          </div>
        )
      case 'post':
        return (
          <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12 }}>
            <div className="card-body p-3">
              <div className="d-flex justify-content-between">
                <div>
                  <span className="badge bg-info me-1">💬 게시글</span>
                  <strong>{item.title}</strong>
                </div>
                <div>
                  <small className="text-muted">{item.created_at ? formatKST(item.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
                  <button className="btn btn-sm btn-outline-secondary py-0 px-1 ms-1" onClick={() => { setEditPost(item as PostItem); setEditTitle(item.title || ''); setEditContent((item.content || '').replace(/<br>/g, '\n')) }}>✏️</button>
                </div>
              </div>
              <div className="small text-muted mt-1">{item.content}</div>
            </div>
          </div>
        )
      case 'share':
        return (
          <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12 }}>
            <div className="card-body p-3">
              <div className="d-flex justify-content-between">
                <div>
                  <span className="badge bg-warning me-1">📸 공유</span>
                  <strong>{item.title}</strong>
                </div>
                <small className="text-muted">{item.created_at ? formatKST(item.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
              </div>
              <div className="small text-muted mt-1">{item.description}</div>
              {item.image_path && <img src={item.image_path} className="img-fluid rounded mt-1" style={{ maxHeight: 200 }} alt="" />}
              <div className="mt-1">
                <button className="btn btn-sm btn-outline-primary py-0 px-1" onClick={() => setPermitShareId(permitShareId === item.id ? null : item.id)}>
                  📨 사용허가 요청
                </button>
              </div>
              {permitShareId === item.id && (
                <div className="mt-1 d-flex gap-1">
                  <input type="text" className="form-control form-control-sm" placeholder="요청 메시지 (선택)" value={permitMsg} onChange={e => setPermitMsg(e.target.value)} />
                  <button className="btn btn-sm btn-success py-0" onClick={() => requestPermission(item.id)} disabled={permitSending}>
                    {permitSending ? '...' : '보내기'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      case 'wish':
        return (
          <div className="card border-0 shadow-sm mb-2" style={{ borderRadius: 12, borderLeft: '4px solid #fd7e14' }}>
            <div className="card-body p-3">
              <div className="d-flex justify-content-between">
                <div>
                  <span className="badge bg-warning me-1">🍀 바람</span>
                  <span className={`badge ${item.status === 'pending' ? 'bg-secondary' : item.status === 'in_progress' ? 'bg-info' : item.status === 'done' ? 'bg-success' : 'bg-danger'}`}>
                    {item.status === 'pending' ? '대기' : item.status === 'in_progress' ? '진행중' : item.status === 'done' ? '완료' : '기각'}
                  </span>
                </div>
                <small className="text-muted">{item.created_at ? formatKST(item.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</small>
              </div>
              <div className="mt-1 small">{item.content}</div>
              {item.reply && <div className="mt-1 small text-success">💬 {item.reply}</div>}
            </div>
          </div>
        )
      default: return null
    }
  }

  if (loading) return <Loading />

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="fw-bold mb-0">❤️ 봉사 | <a className="text-dark text-decoration-none" href="/village/page">📖 홍보</a></h4>
        <div className="d-flex gap-2 align-items-center">
          {data && <><span className="text-muted small">{data.village_ris.map(v => v.ri).join(', ') || '미지정'}</span><span className="text-muted small">회원 {data.member_count}명</span></>}
        </div>
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item"><button className={`nav-link ${tab === 'feed' ? 'active' : ''}`} onClick={() => setTab('feed')}>📋 마을소리</button></li>
        <li className="nav-item"><button className={`nav-link ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>👥 마을회원</button></li>
        <li className="nav-item"><button className="nav-link" onClick={() => navigate('/village/events')}>📅 활동</button></li>
        <li className="nav-item"><button className="nav-link" onClick={() => navigate('/village/qr')}>📱 QR초대</button></li>
      </ul>

      {tab === 'feed' && (
        <div>
          <div className="d-flex gap-2 mb-2">
            <button className="btn btn-sm btn-success" onClick={load}>🔄 새로고침</button>
          </div>
          <div className="card border-0 shadow-sm mb-3 p-3" style={{ borderRadius: 12 }}>
            <h6 className="fw-bold mb-2">✉️ 전체편지 발송</h6>
            <form onSubmit={sendMessage}>
              <div className="mb-2">
                <input type="text" className="form-control form-control-sm" placeholder="제목" value={msgSubject} onChange={e => setMsgSubject(e.target.value)} />
              </div>
              <div className="mb-2">
                <div className="border rounded" style={{ overflow: 'hidden' }}>
                  <div className="d-flex flex-wrap gap-1 p-1 bg-light border-bottom">
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => execCmd('bold')} title="굵게"><b>B</b></button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => execCmd('italic')} title="기울임"><i>I</i></button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => execCmd('underline')} title="밑줄"><u>U</u></button>
                    <span className="border-start mx-1"></span>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => execCmd('insertUnorderedList')} title="목록">☰</button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => execCmd('insertOrderedList')} title="번호 목록">#</button>
                    <span className="border-start mx-1"></span>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={insertLink} title="링크">🔗</button>
                    <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => { if (fileInputRef.current) fileInputRef.current.click() }} title="사진 넣기">
                      {uploading ? '⏳' : '📷'}
                    </button>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="d-none" onChange={handleImageUpload} />
                  <div ref={editorRef} contentEditable suppressContentEditableWarning
                    className="form-control" style={{ minHeight: 100, maxHeight: 200, overflowY: 'auto', border: 'none', borderRadius: 0, boxShadow: 'none', fontSize: '.875rem' }}
                  />
                </div>
              </div>
              <div className="d-flex gap-2">
                <input type="file" className="form-control form-control-sm" onChange={e => setMsgFile(e.target.files?.[0] || null)} />
                <button type="submit" className="btn btn-success btn-sm" disabled={msgSending}>{msgSending ? '발송 중...' : `발송 (${data?.member_count || 0}명)`}</button>
              </div>
              {msgResult && <div className="small mt-1 text-success">{msgResult}</div>}
            </form>
          </div>
          {feed.length === 0 ? (
            <div className="text-center py-4 text-muted">마을 소식이 없습니다.</div>
          ) : (
            feed.map(item => <div key={`${item.type}-${item.id}`}>{renderContent(item)}</div>)
          )}
          {sendingOverlay && (
            <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 9999 }}>
              <div className="bg-white rounded shadow p-4 text-center">
                <div className="spinner-border text-success mb-2" role="status" />
                <div className="fw-bold">편지 발송 중...</div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'members' && data && (
        <div>
          <div className="small text-muted mb-2">진 인증된 회원만 이름과 이메일이 표시됩니다.</div>
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-light">
                <tr><th>이름</th><th>이메일</th><th>마을</th><th>진인증</th><th></th></tr>
              </thead>
              <tbody>
                {data.members.map(m => (
                  <tr key={m.id}>
                    <td>{m.is_verified_resident ? (m.real_name || '-') : '***'}</td>
                    <td>{m.is_verified_resident ? m.email : '***'}</td>
                    <td>{m.town} {m.village}</td>
                    <td>
                      {m.jin_verified_at ? <span className="badge bg-success">진 {formatKST(m.jin_verified_at, { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
                        : m.is_verified_resident ? <span className="badge bg-success">이웃</span>
                        : <span className="badge bg-secondary">미인증</span>}
                    </td>
                    <td>
                      {!m.jin_verified_at && <button className="btn btn-sm btn-outline-success py-0 px-1" onClick={() => jinVerify(m.id)}>진</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.members.length === 0 && <div className="text-center py-4 text-muted">등록된 마을 회원이 없습니다.</div>}
        </div>
      )}

      {editPost && (
        <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header"><h5 className="modal-title">게시글 편집</h5><button className="btn-close" onClick={() => setEditPost(null)} /></div>
              <div className="modal-body">
                <input type="text" className="form-control mb-2" placeholder="제목" value={editTitle} onChange={e => setEditTitle(e.target.value)} />
                <textarea className="form-control mb-2" rows={5} placeholder="내용" value={editContent} onChange={e => setEditContent(e.target.value)} />
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setEditPost(null)}>취소</button>
                <button className="btn btn-success" onClick={saveEdit}>저장</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}