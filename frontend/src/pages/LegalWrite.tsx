import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import { legalApi } from '../lib/api'
import { useEmailGate } from '../lib/useEmailGate'

export default function LegalWrite() {
  const { id } = useParams<{ id: string }>()
  const isEdit = !!id
  const navigate = useNavigate()
  const gate = useEmailGate('legal')
  const editorRef = useRef<ContentEditorHandle>(null)
  const [title, setTitle] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [status, setStatus] = useState('')
  const [filePath, setFilePath] = useState('')
  const [link, setLink] = useState('')
  const [password, setPassword] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [removeAttach, setRemoveAttach] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [loadedHtml, setLoadedHtml] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const p: any = await legalApi.get(Number(id))
      setTitle(p.title || '')
      setAuthorName(p.author_name || '')
      setStatus(p.status || 'pending')
      setFilePath(p.file_path || '')
      setLink(p.link || '')
      setLoadedHtml(p.content || '')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { if (isEdit) load() }, [isEdit, load])

  const locked = status === 'approved'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isEdit && locked) return
    if (!isEdit && !gate.verified) { alert('이메일 인증을 먼저 완료해 주세요.'); return }
    const content = editorRef.current?.getContent()?.trim() || ''
    if (!title.trim() || !content || content === '<br>') { alert('제목과 내용을 입력해 주세요.'); return }
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('title', title.trim())
      fd.append('content', content)
      fd.append('author_name', isEdit ? authorName : gate.name)
      if (link.trim()) fd.append('link', link.trim())
      if (!isEdit) {
        fd.append('email', gate.email)
        if (password) fd.append('password', password)
      }
      if (file) fd.append('attachment', file)
      if (isEdit && removeAttach) fd.append('remove_attachment', '1')
      const res: any = isEdit
        ? await legalApi.editPost(Number(id), fd)
        : await legalApi.create(fd)
      if (res.status === 'success') navigate(isEdit ? '/legal/' + id : '/legal')
      else alert(res.msg || res.error || (isEdit ? '수정 실패' : '등록 실패'))
    } catch (err: any) { alert(err?.message || '오류가 발생했습니다.') }
    finally { setSending(false) }
  }

  if (isEdit && error) return <div className="text-center py-5 text-muted">{error}</div>

  return (
    <div style={{ maxWidth: '100%', margin: '0 auto' }}>
      <h4 className="fw-bold mb-3">{isEdit ? '법률상담 수정' : '법률상담 작성'}</h4>
      {isEdit && locked && (
        <div className="alert alert-warning">관리자 확인(승인) 후에는 수정할 수 없습니다.</div>
      )}
      <form onSubmit={handleSubmit} className="card border-0 shadow-sm p-4" style={{ borderRadius: 16 }}>
        <div className="mb-2">
          <label className="small fw-bold">이름</label>
          <input type="text" className="form-control form-control-sm"
            value={isEdit ? authorName : gate.name}
            onChange={e => isEdit ? setAuthorName(e.target.value) : gate.setName(e.target.value)} required />
        </div>
        {!isEdit && (
          <div className="mb-2">
            <label className="small fw-bold">이메일</label>
            {gate.mode === 'anonymous' ? (
              <div className="border rounded p-2 bg-light">
                <div className="d-flex gap-1">
                  <input type="email" className="form-control form-control-sm" placeholder="이메일 입력"
                    value={gate.verifyEmail} onChange={e => gate.setVerifyEmail(e.target.value)} />
                  <button type="button" className="btn btn-sm btn-outline-primary" onClick={gate.sendVerify}
                    disabled={gate.verifyLoading}>
                    {gate.verifyLoading ? '발송 중...' : '이메일 인증'}
                  </button>
                </div>
                {gate.verifyMsg && <div className="small text-muted mt-1">{gate.verifyMsg}</div>}
              </div>
            ) : (
              <input type="email" className="form-control form-control-sm" value={gate.email} readOnly
                onChange={e => gate.setEmail(e.target.value)} required />
            )}
          </div>
        )}
        <div className="mb-2">
          <label className="small fw-bold">제목</label>
          <input type="text" className="form-control form-control-sm" value={title}
            onChange={e => setTitle(e.target.value)} required />
        </div>
        <div className="mb-2">
          <label className="small fw-bold mb-1">내용</label>
          {isEdit && loading ? (
            <div className="text-muted small py-3">불러오는 중...</div>
          ) : (
            <ContentEditor
              key={isEdit ? `legal-edit-${id}` : 'legal-write'}
              ref={editorRef}
              initialContent={loadedHtml}
              placeholder="법률상담 내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기 가능)"
            />
          )}
        </div>
        <div className="mb-3">
          <label className="small fw-bold">첨부파일</label>
          {isEdit && filePath && !removeAttach ? (
            <div className="d-flex align-items-center gap-2 mb-2">
              <a href={filePath} target="_blank" rel="noreferrer" className="btn btn-sm btn-outline-secondary">현재 첨부파일 보기</a>
              <button type="button" className="btn btn-sm btn-outline-danger"
                onClick={() => { setRemoveAttach(true); setFile(null) }}>삭제</button>
            </div>
          ) : isEdit && filePath && removeAttach ? (
            <div className="text-danger small mb-2">첨부파일이 삭제될 예정입니다.</div>
          ) : null}
          {isEdit && removeAttach && (
            <button type="button" className="btn btn-sm btn-outline-secondary mb-2"
              onClick={() => setRemoveAttach(false)}>첨부 유지</button>
          )}
          <input type="file" className="form-control form-control-sm" accept="image/*,.pdf,.doc,.docx,.hwp"
            onChange={e => { setFile(e.target.files?.[0] || null); if (isEdit) setRemoveAttach(false) }} />
          {isEdit && <div className="form-text">새 파일을 선택하면 기존 첨부를 대체합니다.</div>}
        </div>
        {!isEdit && (
          <div className="mb-2">
            <label className="small fw-bold">비밀번호 (비회원시 필수)</label>
            <input type="password" className="form-control form-control-sm" value={password}
              onChange={e => setPassword(e.target.value)} placeholder="글 확인시 필요" />
          </div>
        )}
        <div className="mb-2">
          <label className="small fw-bold">관련 링크</label>
          <input type="url" className="form-control form-control-sm" value={link}
            onChange={e => setLink(e.target.value)} placeholder="https://..." />
        </div>
        <button type="submit" className="btn btn-success w-100"
          disabled={sending || (isEdit && locked) || (!isEdit && !gate.verified)}>
          {sending ? (isEdit ? '저장 중...' : '등록 중...') : (isEdit ? '저장' : '등록')}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary w-100 mt-2"
          onClick={() => navigate(isEdit ? '/legal/' + id : '/legal')}>취소</button>
      </form>
    </div>
  )
}
