import { useRef, useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'

interface UserOption {
  id: number; username: string; real_name?: string; town?: string; village?: string
}

export default function MessageSend() {
  const navigate = useNavigate()
  const editorRef = useRef<ContentEditorHandle>(null)
  const [users, setUsers] = useState<UserOption[]>([])
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [subject, setSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await fetch('/api/message/users').then(r => r.json())
      setUsers(data)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

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
    if (selectedIds.length === 0 || !content) return
    setSending(true); setResult('')
    try {
      const fd = new FormData()
      fd.append('receiver_ids', selectedIds.join(','))
      fd.append('subject', subject)
      fd.append('content', content)
      const res = await fetch('/api/message/send', { method: 'POST', body: fd }).then(r => r.json())
      if (res.status === 'success') {
        navigate('/message/inbox?tab=sent')
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
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h3 className="fw-bold text-success">편지 보내기</h3>
        <button className="btn btn-sm btn-outline-success" onClick={() => navigate('/message/inbox')}>받은 편지</button>
      </div>

      <div className="card border-0 shadow-sm p-4" style={{ borderRadius: 18 }}>
        <form onSubmit={handleSubmit}>
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
          <div className="mb-3">
            <label className="form-label small fw-bold">제목 (선택)</label>
            <input type="text" className="form-control" value={subject} onChange={e => setSubject(e.target.value)} placeholder="편지 제목" />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">내용</label>
            <ContentEditor ref={editorRef} uploadUrl="/api/message/upload-image" placeholder="편지 내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기, 📁 버튼으로 파일 첨부 가능)" />
          </div>
          <div className="text-muted small mb-3">편지 발송 시 벗 1명당 10닢이 차감됩니다. 파일 첨부는 용량·개수 제한이 없습니다.</div>
          <button type="submit" className="btn btn-success w-100 fw-bold py-2" disabled={sending || selectedIds.length === 0}>
            {sending ? '전송 중...' : `보내기 (${selectedIds.length > 0 ? selectedIds.length * 10 : 10}P)`}
          </button>
        </form>
        {result && <div className={`mt-3 small ${result.includes('✅') || result.includes('전송') ? 'text-success' : 'text-danger'}`}>{result}</div>}
      </div>
    </div>
  )
}
