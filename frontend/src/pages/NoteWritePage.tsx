import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'

export default function NoteWritePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const editorRef = useRef<ContentEditorHandle>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [yardEventId, setYardEventId] = useState('')
  const [catOpen, setCatOpen] = useState(typeof window !== 'undefined' && window.innerWidth >= 768)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 길게 누르기(0.5초 홀드) 시 분류 메뉴 펼침
  const startHold = () => {
    holdTimerRef.current = setTimeout(() => setCatOpen(true), 500)
  }
  const endHold = () => {
    if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null }
  }
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

  const [searchParams] = useSearchParams()

  // 마당 행사 후기: ?yard_event=ID&event_title=제목 → [행사후기] 접두사 자동 채움
  useEffect(() => {
    const yardEvent = searchParams.get('yard_event')
    const eventTitle = searchParams.get('event_title')
    if (yardEvent && eventTitle && !id) {
      const decoded = decodeURIComponent(eventTitle)
      setYardEventId(yardEvent)
      setTitle(`[행사후기] ${decoded}`)
      setCategory('후기')
      // 행사 위치 고정 + 행사 내용 프리필: 행사 상세에서 장소·좌표·내용을 가져와 설정
      fetch(`/api/yard/${yardEvent}`, { credentials: 'include' }).then(r => r.json()).then(d => {
        const ev = d as any
        const loc = {
          lat: String(ev.latitude ?? ''),
          lng: String(ev.longitude ?? ''),
          addr: ev.event_place || decodeURIComponent(eventTitle),
        }
        editorRef.current?.setLocation(loc)
        if (ev.content) {
          editorRef.current?.setContent(`<p><b>행사 내용</b></p>${ev.content}<p><br></p><p>후기를 작성해 주세요.</p>`)
        }
      }).catch(() => {})
    }
  }, [searchParams, id])

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
      yard_event_id: yardEventId ? parseInt(yardEventId) : null,
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
            {catOpen ? (
            <div className="mb-2">
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
                <button type="button" className="btn btn-sm btn-outline-secondary" title="분류 메뉴 숨기기"
                  onClick={() => setCatOpen(false)}>▲ 숨기기</button>
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
            ) : (
              <button type="button" className="btn btn-sm btn-outline-secondary"
                title="분류 메뉴 열기 - 버튼을 길게 누르세요"
                onPointerDown={startHold} onPointerUp={endHold} onPointerLeave={endHold}>
                🗂️ 분류 메뉴 (길게 누르기)
              </button>
            )}
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
            <ContentEditor ref={editorRef} lockLocation={!!yardEventId} placeholder="노트 내용을 적어주세요. (사진은 Ctrl+V로 붙여넣기 가능)" />
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