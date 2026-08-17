import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'

export default function NoteWritePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editorRef = useRef<ContentEditorHandle>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [saving, setSaving] = useState(false)
  const isEdit = !!id

  const loadCategories = useCallback(async () => {
    try {
      const d = await fetch('/api/note/categories', { credentials: 'include' }).then(r => r.json())
      setCategories(d.categories || [])
    } catch {}
  }, [])

  useEffect(() => {
    loadCategories()
    if (isEdit) {
      fetch('/api/note/' + id, { credentials: 'include' }).then(r => r.json()).then(d => {
        if (d.error) { alert(d.error); navigate('/note'); return }
        setTitle(d.title || '')
        setCategory(d.category || '')
        if (d.content && editorRef.current) {
          editorRef.current.setContent(d.content)
        }
      }).catch(() => navigate('/note'))
    }
  }, [id, isEdit, loadCategories, navigate])

  useEffect(() => {
    const el = stripRef.current
    requestAnimationFrame(() => {
      if (el) {
        const sel = el.querySelector('[data-act="1"]') as HTMLElement | null
        if (sel) sel.scrollIntoView({ inline: 'end', block: 'nearest', behavior: 'smooth' })
        updateArrows()
      }
    })
  }, [category, categories])

  const handleSave = async () => {
    const content = editorRef.current?.getContent()?.trim() || ''
    if (!content || content === '<br>') { alert('내용을 입력해 주세요.'); return }
    setSaving(true)
    const loc = editorRef.current?.getLocation() || { lat: '', lng: '', addr: '' }
    const finalTitle = title.trim() || category.trim() || '제목없음'
    const body = {
      title: finalTitle,
      category: category.trim() || '기타',
      content,
      latitude: loc.lat ? parseFloat(loc.lat) : null,
      longitude: loc.lng ? parseFloat(loc.lng) : null,
      address: loc.addr.trim(),
      is_public: false,
    }
    try {
      const url = isEdit ? '/api/note/' + id : '/api/note'
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })
      const d = await res.json()
      if (d.error) { alert(d.error); return }
      navigate('/note')
    } catch {
      alert('저장에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  const addCategory = () => {
    const v = category.trim()
    if (!v) return
    if (!categories.includes(v)) setCategories(prev => [...prev, v].sort((a, b) => a.localeCompare(b, 'ko')))
  }

  const updateArrows = () => {
    const el = stripRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }

  const scrollStrip = (dir: number) => {
    stripRef.current?.scrollBy({ left: dir * 120, behavior: 'smooth' })
  }

  return (
    <div className="container py-3">
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          <div className="mb-3">
            <label className="form-label fw-bold small">분류</label>
            <div className="d-flex gap-2 align-items-center">
              <input
                type="text"
                className="form-control"
                style={{ maxWidth: 250, borderRadius: 12 }}
                placeholder="분류 입력 (예: 일기)"
                value={category}
                onChange={e => setCategory(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCategory() } }}
              />
              <button type="button" className="btn btn-outline-secondary" title="분류 추가"
                onClick={addCategory}>＋</button>
            </div>
            <div className="d-flex align-items-center gap-1 mt-2">
              {canLeft && (
                <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0"
                  onClick={() => scrollStrip(-1)}>▶</button>
              )}
              <div ref={stripRef} onScroll={updateArrows}
                className="d-flex gap-1 flex-grow-1"
                style={{ overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {categories.map(c => (
                  <button key={c} type="button" data-act={c === category ? '1' : '0'}
                    className={`btn btn-sm flex-shrink-0 ${c === category ? 'btn-success' : 'btn-outline-secondary'}`}
                    onClick={() => setCategory(c)}>{c}</button>
                ))}
              </div>
              {canRight && (
                <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0"
                  onClick={() => scrollStrip(1)}>◀</button>
              )}
            </div>
          </div>

          <div className="mb-3">
            <label className="form-label fw-bold small">제목</label>
            <input
              type="text"
              className="form-control"
              placeholder="제목을 입력해 주세요"
              value={title}
              onChange={e => setTitle(e.target.value)}
              style={{ borderRadius: 12, padding: 12 }}
            />
          </div>

          <div className="mb-3">
            <ContentEditor ref={editorRef} placeholder="노트 내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기 가능)" />
          </div>

          <div className="d-flex gap-2">
            <button className="btn btn-success w-100 py-3 fw-bold" style={{ borderRadius: 12 }}
              onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '💾 저장하기'}
            </button>
            <button className="btn btn-outline-secondary px-4" onClick={() => navigate('/note')}
              disabled={saving}>취소</button>
          </div>
        </div>
      </div>
    </div>
  )
}