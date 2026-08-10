import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'

export interface LocationValue {
  lat: string
  lng: string
  addr: string
}

export interface ContentEditorHandle {
  getContent: () => string
  getDrawingData: () => string
  getLocation: () => LocationValue
  setContent: (html: string) => void
  focus: () => void
}

interface ContentEditorProps {
  initialContent?: string
  showLocation?: boolean
  uploadUrl?: string
  placeholder?: string
  onLocationChange?: (loc: LocationValue) => void
}

type OverlayBox = { x: number; y: number; w: number; h: number; deg: number }

/** 꿈꾸기/노트 공용 리치 에디터: contentEditable + 이미지 정렬/회전/크기 + 그림판 + 위치 */
const ContentEditor = forwardRef<ContentEditorHandle, ContentEditorProps>(function ContentEditor({
  initialContent,
  showLocation = true,
  uploadUrl = '/api/board/upload-image',
  placeholder = '내용을 입력해 주세요. (사진은 Ctrl+V로 붙여넣기 가능)',
  onLocationChange,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const [showCanvas, setShowCanvas] = useState(false)
  const [activeImg, setActiveImg] = useState<HTMLImageElement | null>(null)
  const [overlayRect, setOverlayRect] = useState<OverlayBox | null>(null)
  const dragRef = useRef<{ kind: 'rotate' | 'resize'; startX: number; startY: number; baseW: number; baseH: number; natRatio: number; orgAngle: number; cx: number; cy: number } | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [addr, setAddr] = useState('')
  const [geoBusy, setGeoBusy] = useState(false)

  useEffect(() => {
    if (editorRef.current && initialContent && !editorRef.current.innerHTML) {
      editorRef.current.innerHTML = initialContent
    }
  }, [initialContent])

  useImperativeHandle(ref, () => ({
    getContent: () => editorRef.current?.innerHTML || '',
    getDrawingData: () => canvasRef.current?.toDataURL('image/png') || '',
    getLocation: () => ({ lat, lng, addr }),
    setContent: (html: string) => {
      if (editorRef.current) editorRef.current.innerHTML = html
    },
    focus: () => editorRef.current?.focus(),
  }), [lat, lng, addr])

  const execCmd = useCallback((cmd: string) => {
    document.execCommand(cmd, false)
    editorRef.current?.focus()
  }, [])

  // ---------- 드래그 크기 조절 / 회전 핸들 ----------
  const imgBaseSize = useCallback((img: HTMLImageElement) => {
    const w = img.style.width ? parseFloat(img.style.width) : (img.naturalWidth || img.offsetWidth || 300)
    const h = img.style.height ? parseFloat(img.style.height) : (img.naturalHeight || img.offsetHeight || 200)
    return { w: w || 300, h: h || 200 }
  }, [])

  const getRotationDegrees = useCallback((img: HTMLImageElement): number => {
    const transform = img.style.transform
    if (!transform) return parseFloat(img.dataset.rot || '0')
    const match = transform.match(/rotate\(([^)]+)deg\)/)
    return match ? parseFloat(match[1]) : parseFloat(img.dataset.rot || '0')
  }, [])

  const setImgRot = useCallback((img: HTMLImageElement, deg: number) => {
    deg = ((deg % 360) + 360) % 360
    img.dataset.rot = String(deg)
    img.style.transform = `rotate(${deg}deg)`
  }, [])

  const computeBox = useCallback((img: HTMLImageElement): OverlayBox => {
    const ed = editorRef.current
    const base = imgBaseSize(img)
    const deg = getRotationDegrees(img)
    if (!ed) return { x: img.offsetLeft, y: img.offsetTop, w: base.w, h: base.h, deg }
    const x = img.offsetLeft - ed.scrollLeft
    const y = img.offsetTop - ed.scrollTop
    const cx = x + img.offsetWidth / 2
    const cy = y + img.offsetHeight / 2
    return { x: cx - base.w / 2, y: cy - base.h / 2, w: base.w, h: base.h, deg }
  }, [imgBaseSize, getRotationDegrees])

  const detectImage = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement
    const imgEl = t.closest('img')
    if (imgEl && editorRef.current?.contains(imgEl)) {
      setActiveImg(imgEl)
      setOverlayRect(computeBox(imgEl))
    } else {
      setActiveImg(null)
      setOverlayRect(null)
    }
  }, [computeBox])

  useEffect(() => {
    if (!activeImg) {
      setOverlayRect(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      setOverlayRect(computeBox(activeImg))
    }
    tick()
    const ed = editorRef.current
    ed?.addEventListener('scroll', tick)
    window.addEventListener('resize', tick)
    return () => {
      cancelAnimationFrame(raf)
      ed?.removeEventListener('scroll', tick)
      window.removeEventListener('resize', tick)
    }
  }, [activeImg, computeBox])

  const applyImgAlign = useCallback((how: 'left' | 'center' | 'right') => {
    const img = activeImg
    if (!img) return
    const style = img.style
    if (how === 'left') {
      style.float = 'left'
      style.display = ''
      style.marginRight = '12px'
      style.marginLeft = '0px'
      style.width = ''
    } else if (how === 'right') {
      style.float = 'right'
      style.display = ''
      style.marginLeft = '12px'
      style.marginRight = '0px'
      style.width = ''
    } else {
      style.float = 'none'
      style.display = 'block'
      style.margin = '10px auto'
      style.width = ''
    }
    setActiveImg(null)
  }, [activeImg])

  const scaleActiveImg = useCallback((dir: 'up' | 'down') => {
    const img = activeImg
    if (!img) return
    const styleImg = img.style
    const cur = parseInt(styleImg.width, 10) || img.naturalWidth || img.clientWidth || 300
    const next = Math.max(60, Math.min(600, cur + (dir === 'up' ? 60 : -60)))
    styleImg.width = next + 'px'
    styleImg.height = 'auto'
    setOverlayRect(computeBox(img))
    setActiveImg(null)
  }, [activeImg, computeBox])

  const rotateActive = useCallback((dir: 'ccw' | 'cw') => {
    const img = activeImg
    if (!img) return
    const cur = getRotationDegrees(img)
    const next = dir === 'cw' ? (cur + 90) % 360 : (cur - 90 + 360) % 360
    setImgRot(img, next)
    setOverlayRect(computeBox(img))
  }, [activeImg, computeBox, getRotationDegrees, setImgRot])

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>, kind: 'rotate' | 'resize') => {
    const img = activeImg
    if (!img) return
    e.preventDefault()
    e.stopPropagation()
    const base = imgBaseSize(img)
    const r = img.getBoundingClientRect()
    dragRef.current = {
      kind,
      startX: e.clientX,
      startY: e.clientY,
      baseW: base.w,
      baseH: base.h,
      natRatio: base.w / base.h,
      orgAngle: getRotationDegrees(img),
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
    }
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      const im = activeImg
      if (!d || !im) return
      if (d.kind === 'resize') {
        const dx = ev.clientX - d.startX
        const dy = ev.clientY - d.startY
        const rad = (d.orgAngle * Math.PI) / 180
        const inflated = (dx * Math.cos(-rad) - dy * Math.sin(-rad)) * 2
        const newW = Math.max(60, Math.min(700, d.baseW + inflated))
        const newH = Math.max(45, Math.min(600, newW / d.natRatio))
        im.style.width = newW + 'px'
        im.style.height = newH + 'px'
      } else {
        const ra = Math.atan2(ev.clientY - d.cy, ev.clientX - d.cx) * 180 / Math.PI
        const rb = Math.atan2(d.startY - d.cy, d.startX - d.cx) * 180 / Math.PI
        const ang = d.orgAngle + (ra - rb)
        setImgRot(im, ang)
      }
      setOverlayRect(computeBox(im))
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [activeImg, computeBox, imgBaseSize, getRotationDegrees, setImgRot])

  const insertAtCursor = (html: string) => {
    const ed = editorRef.current
    if (!ed) return
    ed.focus()
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0 && ed.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0)
      range.deleteContents()
      const node = document.createElement('div')
      node.innerHTML = html
      const frag = document.createDocumentFragment()
      while (node.firstChild) frag.appendChild(node.firstChild)
      range.insertNode(frag)
      range.collapse(false)
      sel.removeAllRanges()
      sel.addRange(range)
    } else {
      ed.innerHTML = ed.innerHTML + html
    }
    ed.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']
  const isImageFile = (f: File): boolean => {
    const ext = (f.name.split('.').pop() || '').toLowerCase()
    if (f.type.startsWith('image/') || IMG_EXTS.includes(ext)) return true
    if (f.type === '' && /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(f.name)) return true
    return false
  }

  const uploadImage = useCallback(async (file: File) => {
    if (!isImageFile(file)) {
      alert('사진만 붙여넣기/업로드할 수 있습니다.')
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (data.status !== 'success' || !data.url) {
        alert(data.msg || '이미지 업로드에 실패했습니다.')
        return
      }
      insertAtCursor(`<img draggable="false" src="${data.url}" style="max-width:100%;border-radius:10px;margin:6px 0" alt="첨부 이미지" />`)
    } catch {
      alert('이미지 업로드에 실패했습니다.')
    }
  }, [uploadUrl])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    for (const f of Array.from(files)) {
      await uploadImage(f)
    }
    e.target.value = ''
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const it of Array.from(items)) {
      if (it.type.startsWith('image/')) {
        e.preventDefault()
        const file = it.getAsFile()
        if (file) uploadImage(file)
        return
      }
    }
  }

  const clearCanvas = () => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
  }

  const startDraw = () => { drawingRef.current = true }
  const stopDraw = () => {
    drawingRef.current = false
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
  }

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const rect = c.getBoundingClientRect()
    const sx = c.width / rect.width
    const sy = c.height / rect.height
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sy
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#333'
    ctx.lineTo(x, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const applyDrawing = async () => {
    const c = canvasRef.current
    if (!c) return
    const dataUrl = c.toDataURL('image/png')
    if (dataUrl.length < 2000) {
      alert('그림을 먼저 그려 주세요.')
      return
    }
    const blob = await (await fetch(dataUrl)).blob()
    const file = new File([blob], 'drawing.png', { type: 'image/png' })
    await uploadImage(file)
    setShowCanvas(false)
  }

  const getMyPlace = () => {
    if (!navigator.geolocation) {
      alert('이 브라우저에서는 위치를 알 수 없어요. 주소를 직접 입력해 주세요.')
      return
    }
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(async pos => {
      const la = pos.coords.latitude.toFixed(6)
      const lo = pos.coords.longitude.toFixed(6)
      setLat(la)
      setLng(lo)
      try {
        const res = await fetch('/api/reverse-geocode-detail?lat=' + la + '&lon=' + lo, { credentials: 'include' })
        const data = await res.json()
        if (data.address) setAddr(data.address)
        else setAddr('')
      } catch {
        setAddr('')
      }
      setGeoBusy(false)
      onLocationChange?.({ lat: la, lng: lo, addr })
    }, () => {
      setGeoBusy(false)
      alert('위치를 찾지 못했습니다. 주소를 직접 입력해 주세요.')
    }, { timeout: 8000 })
  }

  const handleLocationInput = (key: 'lat' | 'lng' | 'addr', v: string) => {
    if (key === 'lat') setLat(v)
    else if (key === 'lng') setLng(v)
    else setAddr(v)
    onLocationChange?.(
      key === 'lat' ? { lat: v, lng, addr }
      : key === 'lng' ? { lat, lng: v, addr }
      : { lat, lng, addr: v }
    )
  }

  return (
    <div>
      <div className="mb-2">
        <div className="btn-group btn-group-sm flex-wrap">
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('bold')} title="굵게"><b>B</b></button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('italic')} title="기울임"><i>I</i></button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('underline')} title="밑줄"><u>U</u></button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('insertUnorderedList')} title="목록">&bull;</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('insertOrderedList')} title="번호">1.</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => fileInputRef.current?.click()} title="사진/파일">📎</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => setShowCanvas(prev => !prev)} title="그리기">✏️</button>
        </div>
        {activeImg && (
          <div className="btn-group btn-group-sm flex-wrap mt-1">
            <button type="button" className="btn btn-outline-primary" onClick={() => applyImgAlign('left')} title="왼쪽 정렬(글자가 옆으로)">↔️ 왼쪽</button>
            <button type="button" className="btn btn-outline-primary" onClick={() => applyImgAlign('center')} title="가운데 정렬">가운데</button>
            <button type="button" className="btn btn-outline-primary" onClick={() => applyImgAlign('right')} title="오른쪽 정렬">오른쪽</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => scaleActiveImg('down')} title="축소">➖</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => scaleActiveImg('up')} title="확대">➕</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => rotateActive('ccw')} title="왼쪽으로 90° 회전">⟲</button>
            <button type="button" className="btn btn-outline-secondary" onClick={() => rotateActive('cw')} title="오른쪽으로 90° 회전">⟳</button>
            <button type="button" className="btn btn-outline-warning" onClick={() => { const img = activeImg; if (img) img.remove(); setActiveImg(null); }} title="이미지 삭제">🗑</button>
          </div>
        )}
      </div>

      <div className="mb-3" style={{ position: 'relative' }}>
        <div
          ref={editorRef}
          contentEditable
          className="form-control"
          style={{
            minHeight: 250, maxHeight: 500, overflowY: 'auto',
            borderRadius: 12, padding: 12,
          }}
          onPaste={handlePaste}
          onClick={detectImage}
          data-placeholder={placeholder}
        />
        {activeImg && overlayRect && (
          <div style={{
            position: 'absolute', left: overlayRect.x, top: overlayRect.y,
            width: overlayRect.w, height: overlayRect.h,
            boxSizing: 'border-box',
            transform: `rotate(${overlayRect.deg}deg)`, transformOrigin: 'center center',
            pointerEvents: 'none', zIndex: 5000,
          }}>
            <div style={{ position: 'absolute', inset: 0, border: '2px solid #2980b9', borderRadius: 6 }} />
            <div onPointerDown={e => onHandleDown(e, 'rotate')}
              style={{
                position: 'absolute', left: '50%', top: -26,
                transform: 'translateX(-50%)',
                width: 24, height: 24, background: '#2980b9',
                borderRadius: '50%', cursor: 'grab', zIndex: 5001, touchAction: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 12, boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                pointerEvents: 'auto',
              }}>↻</div>
            <div style={{ position: 'absolute', left: '50%', top: -15, width: 1, height: 15, background: '#2980b9', pointerEvents: 'none' }} />
            <div onPointerDown={e => onHandleDown(e, 'resize')}
              style={{
                position: 'absolute', right: -6, bottom: -6,
                width: 24, height: 24, background: '#27ae60', borderRadius: '50%',
                cursor: 'nwse-resize', zIndex: 5001, touchAction: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                pointerEvents: 'auto',
              }}>⤢</div>
          </div>
        )}
      </div>

      <input type="file" ref={fileInputRef} className="d-none" accept="image/*,.heic,.heif,application/pdf" multiple onChange={handleFileChange} />

      {showCanvas && (
        <div className="mb-3">
          <canvas
            ref={canvasRef}
            width={400}
            height={300}
            style={{
              border: '1px solid #ccc', background: 'white',
              cursor: 'crosshair', width: '100%', borderRadius: 12,
            }}
            onMouseDown={startDraw}
            onMouseUp={stopDraw}
            onMouseMove={draw}
            onMouseLeave={stopDraw}
          />
          <div className="d-flex gap-2 mt-1">
            <button type="button" className="btn btn-sm btn-light" onClick={clearCanvas}>지우기</button>
            <button type="button" className="btn btn-sm btn-success" onClick={applyDrawing}>그림 본문에 넣기</button>
          </div>
        </div>
      )}

      {showLocation && (
        <div className="mb-3 p-3 border rounded" style={{ background: '#f8f9fa' }}>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <label className="fw-bold small mb-0">📍 위치 (선택)</label>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={getMyPlace} disabled={geoBusy}>
              {geoBusy ? '찾는 중...' : '내 위치 가져오기'}
            </button>
          </div>
          <input
            type="text"
            className="form-control form-control-sm mb-2"
            placeholder="주소 또는 위치 설명 (예: 양평읍 양근리, 커뮤니티센터 앞)"
            value={addr}
            onChange={e => handleLocationInput('addr', e.target.value)}
          />
          <div className="d-flex gap-2">
            <input
              type="number"
              step="0.000001"
              className="form-control form-control-sm"
              placeholder="위도"
              value={lat}
              onChange={e => handleLocationInput('lat', e.target.value)}
            />
            <input
              type="number"
              step="0.000001"
              className="form-control form-control-sm"
              placeholder="경도"
              value={lng}
              onChange={e => handleLocationInput('lng', e.target.value)}
            />
          </div>
          <small className="text-muted d-block mt-1">주소 검색·수정 가능하며, GPS로 현재 위치를 자동 입력할 수 있습니다.</small>
        </div>
      )}
    </div>
  )
})

export default ContentEditor