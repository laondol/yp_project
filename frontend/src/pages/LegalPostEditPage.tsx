import { useState, useRef, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { legalApi } from '../lib/api'

export default function LegalPostEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const p: any = await legalApi.get(Number(id))
      setTitle(p.title || '')
      setAuthorName(p.author_name || '')
      setContent(p.content || '')
      setStatus(p.status || 'pending')
      if (editorRef.current) editorRef.current.innerHTML = p.content || ''
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const updateContent = () => {
    if (editorRef.current) setContent(editorRef.current.innerHTML)
  }

  const locked = status === 'approved'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (locked) return
    if (!title.trim() || !content.trim()) return
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('content', content)
      fd.append('author_name', authorName)
      const res: any = await legalApi.editPost(Number(id), fd)
      if (res.status === 'success') navigate('/legal/' + id)
      else alert(res.msg || res.error || '수정 실패')
    } catch (err: any) { alert(err?.message || '수정 중 오류') }
    finally { setSending(false) }
  }

  if (loading) return <div className="text-center py-5 text-muted">불러오는 중...</div>
  if (error) return <div className="text-center py-5 text-muted">{error}</div>

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h4 className="fw-bold mb-3">법률상담 수정</h4>
      {locked && (
        <div className="alert alert-warning">관리자 확인(승인) 후에는 수정할 수 없습니다.</div>
      )}
      <form onSubmit={handleSubmit} className="card border-0 shadow-sm p-4" style={{ borderRadius: 16 }}>
        <div className="mb-2">
          <label className="small fw-bold">이름</label>
          <input type="text" className="form-control form-control-sm" value={authorName}
            onChange={e => setAuthorName(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="small fw-bold">제목</label>
          <input type="text" className="form-control form-control-sm" value={title}
            onChange={e => setTitle(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="small fw-bold mb-1">내용</label>
          <div ref={editorRef} contentEditable
            className="form-control mb-2"
            style={{ minHeight: 200, maxHeight: 400, overflowY: 'auto' }}
            onInput={updateContent}
            onBlur={updateContent}
            data-placeholder="내용을 작성하세요..." />
        </div>
        <button type="submit" className="btn btn-success w-100" disabled={sending || locked}>
          {sending ? '저장 중...' : '저장'}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary w-100 mt-2"
          onClick={() => navigate('/legal/' + id)}>취소</button>
      </form>
    </div>
  )
}
