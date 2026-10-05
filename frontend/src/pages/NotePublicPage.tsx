import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Loading from '../components/common/Loading'

interface PublicComment {
  id: number
  author: string
  user_id: number | null
  author_email?: string
  content: string
  parent_id: number | null
  created_at: string | null
  is_owner: boolean
}

interface PublicNote {
  id: number
  title: string
  category?: string
  content?: string
  address?: string
  is_public: boolean
  is_owner: boolean
  allow_comments: boolean
  created_at: string | null
  comments: PublicComment[]
  viewer_logged_in: boolean
}

export default function NotePublicPage() {
  const { id } = useParams()
  const [note, setNote] = useState<PublicNote | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/note/public/' + id, { credentials: 'include' })
      const d = await r.json()
      if (!r.ok || d.error) { setError(d.error || '불러오기 실패'); return }
      setNote(d)
    } catch {
      setError('불러오기 실패')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v || sending) return
    setSending(true)
    try {
      const r = await fetch(`/api/note/${id}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: v }),
        credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok || d.error) { alert(d.error || '댓글 등록 실패'); return }
      setText('')
      load()
    } catch {
      alert('댓글 등록에 실패했습니다.')
    } finally { setSending(false) }
  }

  const deleteComment = async (cid: number) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return
    const r = await fetch('/api/note/comment/' + cid, { method: 'DELETE', credentials: 'include' })
    if (r.ok) load()
    else {
      const d = await r.json().catch(() => ({}))
      alert(d.error || '삭제 실패')
    }
  }

  if (loading) return <Loading />
  if (error) {
    return (
      <div className="container py-5 text-center">
        <div className="alert alert-light border">{error}</div>
        <Link to="/" className="btn btn-outline-secondary btn-sm">홈으로</Link>
      </div>
    )
  }
  if (!note) return null

  const nextUrl = encodeURIComponent('/note/public/' + id)

  return (
    <div className="container py-4" style={{ maxWidth: 800 }}>
      <div className="card border-0 shadow-sm" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          <div className="mb-2 d-flex align-items-center gap-2 flex-wrap">
            {note.category && <span className="badge bg-light text-dark">{note.category}</span>}
            <small className="text-muted">{note.created_at ? note.created_at.slice(0, 10) : ''}</small>
            {!note.is_public && <span className="badge bg-warning text-dark">미리보기 (비공개)</span>}
          </div>
          <h4 className="fw-bold mb-3">{note.title || '제목없음'}</h4>
          {note.address && <div className="text-muted small mb-3">📍 {note.address}</div>}
          <div style={{ lineHeight: 1.8, wordBreak: 'break-word' }} dangerouslySetInnerHTML={{ __html: note.content || '' }} />
        </div>
      </div>

      {note.allow_comments && (
        <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: 18 }}>
          <div className="card-body p-4">
            <h6 className="fw-bold mb-3">💬 댓글 {note.comments.length}</h6>

            {note.viewer_logged_in ? (
              <form onSubmit={submitComment} className="mb-4">
                <textarea className="form-control mb-2" rows={2} placeholder="댓글을 입력하세요..."
                  value={text} onChange={e => setText(e.target.value)} />
                <div className="text-end">
                  <button type="submit" className="btn btn-primary btn-sm px-3" disabled={sending}>
                    {sending ? '등록 중...' : '등록'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="alert alert-light text-center small mb-4">
                함께사는양평에 <Link to="/register" className="fw-bold text-success">가입</Link>하면
                댓글을 달 수 있습니다. 이미 회원이면{' '}
                <Link to={`/login?next=${nextUrl}`} className="fw-bold text-success">로그인</Link>하세요.
              </div>
            )}

            {note.comments.length === 0 ? (
              <div className="text-muted small">아직 댓글이 없습니다.</div>
            ) : (
              <div className="d-flex flex-column gap-3">
                {note.comments.map(c => (
                  <div key={c.id} className="p-3 bg-light rounded">
                    <div className="d-flex justify-content-between align-items-start">
                      <strong className="small">{c.author || '익명'}</strong>
                      <div className="d-flex align-items-center gap-2">
                        <small className="text-muted">{c.created_at ? c.created_at.slice(0, 16).replace('T', ' ') : ''}</small>
                        {(c.is_owner || note.is_owner) && (
                          <button className="btn btn-sm p-0 border-0 text-danger" onClick={() => deleteComment(c.id)}>🗑</button>
                        )}
                      </div>
                    </div>
                    <div className="small mt-1" style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
