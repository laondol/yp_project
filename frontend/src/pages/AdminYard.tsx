import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardAdminItem {
  id: string; db_id: number; kind: 'post' | 'event'
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; author_name?: string
  created_at: string
}

export default function AdminYard() {
  const [items, setItems] = useState<YardAdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [saving, setSaving] = useState(false)

  const load = () => {
    setLoading(true)
    fetch('/api/yard')
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/yard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), source_url: sourceUrl.trim(), author_name: authorName.trim() }),
      })
      const data = await res.json()
      setMsg(data.msg || (data.status === 'success' ? '등록 완료' : '실패'))
      setMsgOk(data.status === 'success')
      if (data.status === 'success') { setTitle(''); setContent(''); setSourceUrl(''); setAuthorName(''); load() }
    } catch { setMsg('오류가 발생했습니다.'); setMsgOk(false) }
    setSaving(false)
  }

  const handleDelete = async (fid: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/yard/${fid}`, { method: 'DELETE' })
      const data = await res.json()
      setMsg(data.msg || '삭제'); setMsgOk(data.status === 'success')
      if (data.status === 'success') load()
    } catch { setMsg('삭제 오류'); setMsgOk(false) }
  }

  const posts = items.filter(i => i.kind === 'post')

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">🌾 마당 관리</h3>

      {/* 등록 폼 */}
      <div className="card border-0 shadow-sm mb-4 p-4" style={{ borderRadius: 16 }}>
        <h6 className="fw-bold mb-3">✏️ 새 소식 등록</h6>
        <form onSubmit={e => { e.preventDefault(); handleCreate() }}>
          <input className="form-control mb-2" placeholder="제목 (필수)"
            value={title} onChange={e => setTitle(e.target.value)} required />
          <input className="form-control mb-2" placeholder="단체명/출처 (예: 양평군청, ○○마을회)"
            value={authorName} onChange={e => setAuthorName(e.target.value)} />
          <textarea className="form-control mb-2" rows={3} placeholder="내용"
            value={content} onChange={e => setContent(e.target.value)} />
          <input className="form-control mb-2" placeholder="SNS 공지 URL (선택 — 인스타그램/페이스북 공개 게시물은 상세페이지에 원문 표시)"
            value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
          <button type="submit" className="btn btn-success" disabled={saving || !title.trim()}>
            {saving ? '⏳ 등록 중...' : '✅ 마당에 등록'}
          </button>
          <span className={`ms-2 small ${msgOk ? 'text-success' : 'text-danger'}`}>{msg}</span>
        </form>
      </div>

      <h6 className="fw-bold mb-2">등록된 소식 ({posts.length}건)</h6>
      {loading ? (
        <div className="text-center py-5 text-muted"><div className="spinner-border" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center py-3 text-muted">등록된 소식이 없습니다.</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead><tr>
              <th>제목</th><th>출처</th><th>플랫폼</th><th>등록일</th><th></th>
            </tr></thead>
            <tbody>
              {posts.map(p => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 300 }}>
                    <strong>{p.title}</strong>
                    {p.source_url && <div className="small text-muted" style={{ fontSize: '0.75rem' }}>{p.source_url}</div>}
                  </td>
                  <td className="small">{p.author_name || '-'}</td>
                  <td className="small">{p.platform || '-'}</td>
                  <td className="small">{formatKST(p.created_at, { month: '2-digit', day: '2-digit' })}</td>
                  <td className="text-end">
                    <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p.id)}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
