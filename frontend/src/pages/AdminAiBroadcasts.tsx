import { useEffect, useState } from 'react'
import AdminNav from '../components/AdminNav'

interface Broadcast {
  id: number; title: string; content: string; author_name: string
  status: string; is_active: boolean; created_at: string
}

const STATUS_LABEL: Record<string, string> = {
  draft: '작성중', pending: '승인요청', approved: '승인완료', published: '발행됨', rejected: '반려'
}
const STATUS_COLOR: Record<string, string> = {
  draft: '#6c757d', pending: '#ffc107', approved: '#0d6efd', published: '#198754', rejected: '#dc3545'
}

export default function AdminAiBroadcasts() {
  const [list, setList] = useState<Broadcast[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [role, setRole] = useState('')

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' }).then(r => r.json()).then(d => setRole(d.role || ''))
    load()
  }, [])

  function load() {
    fetch('/api/admin/ai-broadcasts', { credentials: 'include' })
      .then(r => r.json()).then(d => setList(d)).catch(() => {})
  }

  async function create() {
    if (!title.trim() || !content.trim()) return alert('제목과 내용을 입력하세요')
    const r = await fetch('/api/admin/ai-broadcasts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      credentials: 'include',
    })
    const d = await r.json()
    if (d.success) { setShowForm(false); setTitle(''); setContent(''); load() }
    else alert(d.error || '오류')
  }

  async function setStatus(id: number, status: string) {
    const r = await fetch(`/api/admin/ai-broadcasts/${id}/status`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
      credentials: 'include',
    })
    const d = await r.json()
    if (d.success) load()
    else alert(d.error || '오류')
  }

  async function del(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    await fetch(`/api/admin/ai-broadcasts/${id}`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  return (
    <div className="p-3" style={{ maxWidth: 900, margin: '0 auto' }}>
      <AdminNav />
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="fw-bold mb-0">📢 AI 전체공지</h4>
        <button className="btn btn-success btn-sm" onClick={() => setShowForm(!showForm)}>
          {showForm ? '✕ 취소' : '+ 새 공지'}
        </button>
      </div>

      {showForm && (
        <div className="card mb-3 border-success">
          <div className="card-body">
            <div className="mb-2">
              <label className="form-label small">제목</label>
              <input className="form-control form-control-sm" value={title}
                onChange={e => setTitle(e.target.value)} placeholder="공지 제목" />
            </div>
            <div className="mb-2">
              <label className="form-label small">내용</label>
              <textarea className="form-control form-control-sm" rows={4} value={content}
                onChange={e => setContent(e.target.value)} placeholder="공지 내용" />
            </div>
            <button className="btn btn-primary btn-sm" onClick={create}>작성 완료 (draft)</button>
          </div>
        </div>
      )}

      {list.length === 0 ? (
        <div className="text-center text-muted py-5">등록된 전체공지가 없습니다.</div>
      ) : (
        list.map(b => (
          <div key={b.id} className="card mb-2">
            <div className="card-body py-2 px-3">
              <div className="d-flex align-items-center gap-2">
                <span className="badge" style={{ background: STATUS_COLOR[b.status] || '#6c757d' }}>
                  {STATUS_LABEL[b.status] || b.status}
                </span>
                <strong className="flex-grow-1 small">{b.title}</strong>
                <small className="text-muted">{b.author_name}</small>
                <small className="text-muted">{b.created_at?.slice(0, 10)}</small>
              </div>
              <div className="small text-muted mt-1" style={{ whiteSpace: 'pre-wrap' }}>{b.content}</div>
              <div className="d-flex gap-1 mt-1 flex-wrap">
                {b.status === 'draft' && (
                  <button className="btn btn-warning btn-sm py-0" style={{ fontSize: '0.7rem' }}
                    onClick={() => setStatus(b.id, 'pending')}>승인요청</button>
                )}
                {b.status === 'pending' && role === 'leader' && (
                  <>
                    <button className="btn btn-primary btn-sm py-0" style={{ fontSize: '0.7rem' }}
                      onClick={() => setStatus(b.id, 'approved')}>✅ 최종승인</button>
                    <button className="btn btn-danger btn-sm py-0" style={{ fontSize: '0.7rem' }}
                      onClick={() => setStatus(b.id, 'rejected')}>반려</button>
                  </>
                )}
                {b.status === 'approved' && (
                  <button className="btn btn-success btn-sm py-0" style={{ fontSize: '0.7rem' }}
                    onClick={() => setStatus(b.id, 'published')}>📢 발행</button>
                )}
                {b.status === 'pending' && role !== 'leader' && (
                  <small className="text-muted">⏳ 리더 승인 대기중</small>
                )}
                {(b.status === 'draft' || b.status === 'rejected') && (
                  <button className="btn btn-outline-danger btn-sm py-0" style={{ fontSize: '0.7rem' }}
                    onClick={() => del(b.id)}>삭제</button>
                )}
                {b.status === 'published' && (
                  <small className="text-success">✅ 발행 완료 (전체 회원에게 표시중)</small>
                )}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
