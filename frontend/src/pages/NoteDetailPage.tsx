import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { formatKST } from '../utils/format';

interface NoteDetail {
  id: number
  title: string
  category?: string
  content?: string
  latitude?: number | null
  longitude?: number | null
  address?: string
  created_at?: string
  updated_at?: string
}

export default function NoteDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/note/' + id, { credentials: 'include' })
      .then(r => r.json()).then(d => {
        if (d.error) { alert(d.error); navigate('/note'); return }
        setNote(d)
      }).catch(() => navigate('/note'))
      .finally(() => setLoading(false))
  }, [id, navigate])

  const handleDelete = async () => {
    if (!confirm('노트를 삭제하시겠습니까?')) return
    await fetch('/api/note/' + id, { method: 'DELETE', credentials: 'include' })
    navigate('/note')
  }

  if (loading) return <div className="text-center text-muted py-5">불러오는 중...</div>
  if (!note) return null

  return (
    <div className="py-3" style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="mb-3 d-flex align-items-center justify-content-between">
        <Link to="/note" className="btn btn-sm btn-outline-secondary">← 목록</Link>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-primary" onClick={() => navigate('/note/' + id + '/edit')}>✏️ 수정</button>
          <button className="btn btn-sm btn-outline-danger" onClick={handleDelete}>🗑 삭제</button>
        </div>
      </div>

      <div className="card border-0 shadow-sm" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          {note.category && <span className="badge bg-light text-dark mb-2">{note.category}</span>}
          <h4 className="fw-bold mb-1">{note.title || '제목없음'}</h4>
          <small className="text-muted">
            {note.updated_at ? formatKST(note.updated_at) : ''}
          </small>
          <hr />
          <div dangerouslySetInnerHTML={{ __html: note.content || '' }} />
          {(note.address || (note.latitude && note.longitude)) && (
            <div className="mt-3 small text-muted" style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
              📍 {note.address || ''} {note.latitude ? `(${note.latitude}, ${note.longitude})` : ''}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}