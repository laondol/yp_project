import { useRef, useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import PrintPreviewModal from '../components/PrintPreviewModal'
import SharePreviewModal from '../components/SharePreviewModal'

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
  const [isPublic, setIsPublic] = useState(false)
  const [allowComments, setAllowComments] = useState(true)
  const [savedId, setSavedId] = useState<string>(id || '')
  const [shareData, setShareData] = useState<{ url: string; contentText: string } | null>(null)
  const [hoverChip, setHoverChip] = useState<string | null>(null)
  const [printOpen, setPrintOpen] = useState(false)
  const [printData, setPrintData] = useState<{ title: string; category: string; date: string; address: string; content: string } | null>(null)
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
        setIsPublic(!!d.is_public)
        setAllowComments(d.allow_comments !== false)
        setSavedId(String(id))
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

  // 저장 (네비게이션 없음) → noteId 반환. 공유 시 isPublic=true.
  const save = useCallback(async (opts?: { isPublic?: boolean }): Promise<string | null> => {
    const content = editorRef.current?.getContent()?.trim() || ''
    if (!content || content === '<br>') { alert('내용을 입력해 주세요.'); return null }
    setSaving(true)
    try {
      const loc = editorRef.current?.getLocation() || { lat: '', lng: '', addr: '' }
      const finalTitle = title.trim() || category.trim() || '제목없음'
      const body = {
        title: finalTitle,
        category: category.trim() || '기타',
        content,
        latitude: loc.lat ? parseFloat(loc.lat) : null,
        longitude: loc.lng ? parseFloat(loc.lng) : null,
        address: loc.addr.trim(),
        is_public: opts?.isPublic ?? isPublic,
        allow_comments: allowComments,
        yard_event_id: yardEventId ? parseInt(yardEventId) : null,
      }
      const targetId = id || savedId
      const url = targetId ? '/api/note/' + targetId : '/api/note'
      const res = await fetch(url, {
        method: targetId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      })
      const d = await res.json()
      if (d.error) { alert(d.error); return null }
      const nid = String(d.id || targetId || '')
      if (nid) {
        setSavedId(nid)
        if (opts?.isPublic) setIsPublic(true)
      }
      return nid || null
    } catch {
      alert('저장에 실패했습니다.')
      return null
    } finally {
      setSaving(false)
    }
  }, [title, category, yardEventId, allowComments, isPublic, id, savedId])

  const handleSave = async () => {
    const nid = await save()
    if (nid) navigate('/note')
  }

  const handleShare = async () => {
    const nid = await save({ isPublic: true })
    if (!nid) return
    const tmp = document.createElement('div')
    tmp.innerHTML = editorRef.current?.getContent() || ''
    setShareData({
      url: `${window.location.origin}/note/public/${nid}`,
      contentText: (tmp.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
    })
  }

  const handlePrint = async () => {
    const nid = await save()
    if (!nid) return
    const loc = editorRef.current?.getLocation() || { lat: '', lng: '', addr: '' }
    setPrintData({
      title: title.trim() || category.trim() || '제목없음',
      category: category.trim(),
      date: new Date().toISOString().slice(0, 10),
      address: loc.addr?.trim() || '',
      content: editorRef.current?.getContent() || '',
    })
    setPrintOpen(true)
  }

  // 분류 칩 ✎ 이름 바꾸기
  const renameChip = async (e: React.MouseEvent, oldName: string) => {
    e.stopPropagation()
    const v = prompt('새 분류 이름을 입력하세요', oldName)
    if (v == null) return
    const newName = v.trim().slice(0, 50)
    if (!newName || newName === oldName) return
    const r = await fetch('/api/note/categories/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old: oldName, new: newName }),
      credentials: 'include',
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { alert(d.error || '분류 이름 변경에 실패했습니다.'); return }
    loadCategories()
    if (category === oldName) setCategory(newName)
  }

  // 분류 칩 🗑 삭제 (분류명만 제거, 노트는 유지)
  const removeChip = async (e: React.MouseEvent, name: string) => {
    e.stopPropagation()
    if (!confirm(`분류 '${name}'를 삭제할까요?\n(노트는 삭제되지 않습니다)`)) return
    const r = await fetch('/api/note/categories/' + encodeURIComponent(name), {
      method: 'DELETE', credentials: 'include',
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok || d.error) { alert(d.error || '분류 삭제에 실패했습니다.'); return }
    loadCategories()
    if (category === name) setCategory('')
  }

  const toggleComments = async () => {
    const v = !allowComments
    setAllowComments(v)
    const targetId = id || savedId
    if (targetId) {
      try {
        await fetch('/api/note/' + targetId, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allow_comments: v }),
          credentials: 'include',
        })
      } catch {}
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
                      className={`btn btn-sm flex-shrink-0 d-inline-flex align-items-center gap-1 ${c === category ? 'btn-success' : 'btn-outline-secondary'}`}
                      onMouseEnter={() => setHoverChip(c)}
                      onMouseLeave={() => setHoverChip(prev => (prev === c ? null : prev))}
                      onClick={() => setCategory(c)}>
                      {c}
                      <span className="d-inline-flex gap-1" style={{ opacity: hoverChip === c ? 1 : 0, transition: 'opacity .15s' }}>
                        <span role="button" title="분류 이름 바꾸기"
                          style={{ cursor: 'pointer' }}
                          onClick={e => renameChip(e, c)}>✎</span>
                        <span role="button" title="분류 삭제"
                          style={{ cursor: 'pointer' }}
                          onClick={e => removeChip(e, c)}>🗑</span>
                      </span>
                    </button>
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

          <div className="d-flex gap-2 flex-wrap">
            <button className="btn btn-success flex-grow-1 py-3 fw-bold" style={{ borderRadius: 12, minWidth: 140 }}
              onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '💾 저장하기'}
            </button>

            <button className="btn btn-outline-primary py-3 fw-bold px-4" style={{ borderRadius: 12 }}
              onClick={handleShare} disabled={saving}>
              {saving ? '저장 중...' : '📤 공유하기'}
            </button>

            <button className="btn btn-outline-secondary py-3 fw-bold px-4" style={{ borderRadius: 12 }}
              onClick={handlePrint} disabled={saving}>
              🖨 출력하기
            </button>
            <button className="btn btn-outline-secondary px-4" onClick={() => navigate('/note')}
              disabled={saving}>취소</button>
          </div>
        </div>
      </div>

      {shareData && (
        <SharePreviewModal
          onClose={() => setShareData(null)}
          title={title.trim() || category.trim() || '제목없음'}
          category={category.trim()}
          date={new Date().toISOString().slice(0, 10)}
          contentText={shareData.contentText}
          url={shareData.url}
          allowComments={allowComments}
          onToggleComments={toggleComments}
        />
      )}

      {printOpen && printData && (
        <PrintPreviewModal onClose={() => setPrintOpen(false)} data={printData} />
      )}
    </div>
  )
}
