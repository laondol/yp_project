import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

interface NoteItem {
  id: number
  title: string
  category?: string
  content?: string
  updated_at?: string
}

function NoteRow({ n, onOpen, onDelete }: { n: NoteItem; onOpen: (id: number) => void; onDelete: (e: React.MouseEvent, id: number) => void }) {
  const stripHtml = (s?: string) => {
    if (!s) return ''
    const div = document.createElement('div')
    div.innerHTML = s
    return (div.textContent || '').replace(/\s+/g, ' ').trim()
  }
  return (
    <div className="card border-0 shadow-sm" style={{ borderRadius: 14, cursor: 'pointer' }}
      onClick={() => onOpen(n.id)}>
      <div className="card-body p-3">
        <div className="d-flex justify-content-between align-items-start">
          <div className="min-w-0">
            {n.category && <span className="badge bg-light text-dark me-1">{n.category}</span>}
            <span className="fw-bold">{n.title || '제목없음'}</span>
            {n.content && <div className="text-muted small text-truncate mt-1">{stripHtml(n.content)}</div>}
          </div>
          <div className="text-end ms-2 flex-shrink-0">
            <small className="text-muted d-block">{n.updated_at ? n.updated_at.slice(0, 10) : ''}</small>
            <button className="btn btn-sm p-0 border-0 text-danger" onClick={e => onDelete(e, n.id)}>🗑</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NoteListPage() {
  const navigate = useNavigate()
  const [notes, setNotes] = useState<NoteItem[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [category, setCategory] = useState<string>('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (cat?: string) => {
    setLoading(true)
    try {
      const qs = cat ? '?category=' + encodeURIComponent(cat) : ''
      const d = await fetch('/api/note' + qs, { credentials: 'include' }).then(r => r.json())
      if (d.error) { alert(d.error); return }
      setNotes(d.notes || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => {
    fetch('/api/note/categories', { credentials: 'include' })
      .then(r => r.json()).then(d => setCategories(d.categories || [])).catch(() => {})
    load()
  }, [load])

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation()
    if (!confirm('노트를 삭제하시겠습니까?')) return
    await fetch('/api/note/' + id, { method: 'DELETE', credentials: 'include' })
    load(category)
  }

  const sortedNotes = useMemo(() => {
    const catRank = new Map(categories.map((c, i) => [c, i]))
    return [...notes].sort((a, b) => {
      const ra = a.category && catRank.has(a.category) ? catRank.get(a.category)! : Infinity
      const rb = b.category && catRank.has(b.category) ? catRank.get(b.category)! : Infinity
      if (ra !== rb) return ra - rb
      return (b.updated_at || '').localeCompare(a.updated_at || '')
    })
  }, [notes, categories])

  const listView = (items: NoteItem[]) =>
    items.length === 0 ? (
      <div className="text-center text-muted py-5">노트가 없습니다.</div>
    ) : (
      <div className="d-flex flex-column gap-2">
        {items.map(n => <NoteRow key={n.id} n={n} onOpen={id => navigate('/note/' + id)} onDelete={handleDelete} />)}
      </div>
    )

  // 분류별 탭 뷰 레지스트리: 추후 특정 분류 탭만 다른 방식으로 표시하고 싶으면
  // tabViews['분류명'] = (items) => <커스텀뷰/> 형태로 추가하면 됩니다. (전체/미분류는 listView)
  const tabViews: Record<string, (items: NoteItem[]) => React.ReactNode> = {
    '': listView,
  }

  const makeView = (cat: string) => {
    const tabNotes = cat
      ? sortedNotes.filter(n => n.category === cat)
      : sortedNotes
    const view = tabViews[cat] || listView
    return view(tabNotes)
  }

  return (
    <div className="py-3" style={{ maxWidth: 1140, margin: '0 auto' }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="fw-bold mb-0">📒 노트</h5>
        <button className="btn btn-success btn-sm" onClick={() => navigate('/note/new')}>＋ 새 노트</button>
      </div>

      <div className="nav nav-tabs mb-3" role="tablist">
        <button className={`nav-link ${category === '' ? 'active' : ''}`}
          onClick={() => { setCategory(''); load() }}>전체</button>
        {categories.map(c => (
          <button key={c} className={`nav-link ${category === c ? 'active' : ''}`}
            onClick={() => { setCategory(c); load(c) }}>{c}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-muted py-5">불러오는 중...</div>
      ) : (
        makeView(category)
      )}
    </div>
  )
}