import { useRef, useState, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react'
import Cropper from 'cropperjs'
import 'cropperjs/dist/cropper.css'

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
  fileUploadUrl?: string
  placeholder?: string
  onLocationChange?: (loc: LocationValue) => void
}

type OverlayBox = { x: number; y: number; w: number; h: number; deg: number }

/** 꿈꾸기/노트 공용 리치 에디터: contentEditable + 이미지 정렬/회전/크기 + 그림판 + 위치 */
const ContentEditor = forwardRef<ContentEditorHandle, ContentEditorProps>(function ContentEditor({
  initialContent,
  showLocation = true,
  uploadUrl = '/api/board/upload-image',
  fileUploadUrl = '/api/upload/file',
  placeholder = '내용을 입력해 주세요. (사진은 Ctrl+V로 붙여넣기 가능)',
  onLocationChange,
}, ref) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileAttachRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const dragRef = useRef<{ kind: 'rotate' | 'resize'; corner?: 'br' | 'bl' | 'tr' | 'tl'; startX: number; startY: number; baseW: number; baseH: number; natRatio: number; orgAngle: number; cx: number; cy: number; startML: number; startMT: number } | null>(null)
  const matchSelRef = useRef<{ range: Range } | null>(null)
  const savedRange = useRef<Range | null>(null)
  const [showCanvas, setShowCanvas] = useState(false)
  const [activeImg, setActiveImg] = useState<HTMLImageElement | null>(null)
  const [overlayRect, setOverlayRect] = useState<OverlayBox | null>(null)
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [addr, setAddr] = useState('')
  const [geoBusy, setGeoBusy] = useState(false)
  const [fileUploading, setFileUploading] = useState(false)
  const [showFormat, setShowFormat] = useState(false)
  const [showPara, setShowPara] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [fontSizePx, setFontSizePx] = useState('16')
  const [tableRows, setTableRows] = useState(3)
  const [tableCols, setTableCols] = useState(3)
  const [tblBorderW, setTblBorderW] = useState('1')
  const [tblBorderStyle, setTblBorderStyle] = useState('solid')
  const [tblBorderColor, setTblBorderColor] = useState('#333333')
  const [showDraw, setShowDraw] = useState(false)
  const [drawMode, setDrawMode] = useState<'free' | 'line' | 'circle'>('free')
  const [drawColor, setDrawColor] = useState('#333333')

  // 이미지 크롭 모달
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const cropImgRef = useRef<HTMLImageElement>(null)
  const cropperRef = useRef<any>(null)
  const cropFileRef = useRef<File | null>(null)
  const cropMatchRef = useRef<Range | null>(null)
  const [cropMode, setCropMode] = useState<'upload' | 'replace'>('upload')
  const cropTargetImgRef = useRef<HTMLImageElement | null>(null)

  // 이미지 투명화 모달 (색상 기반 마법봉)
  const [transSrc, setTransSrc] = useState<string | null>(null)
  const transCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [transTol, setTransTol] = useState(30)
  const transWorkRef = useRef<{ ctx: CanvasRenderingContext2D; img: ImageData; w: number; h: number } | null>(null)

  const [drawWidth, setDrawWidth] = useState(3)
  const drawStartRef = useRef<{ x: number; y: number } | null>(null)
  const drawSnapRef = useRef<ImageData | null>(null)

  useEffect(() => {
    if (editorRef.current && initialContent) {
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

  const saveSelection = useCallback(() => {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0)
      if (editorRef.current?.contains(r.commonAncestorContainer)) savedRange.current = r
    }
  }, [])

  const restoreSelection = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    ed.focus()
    if (savedRange.current) {
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(savedRange.current)
    }
  }, [])

  const applyCmd = useCallback((cmd: string, val?: string) => {
    restoreSelection()
    document.execCommand(cmd, false, val)
  }, [restoreSelection])

  // ---------- 드래그 크기 조절 / 회전 핸들 ----------
  const imgBaseSize = useCallback((img: HTMLImageElement) => {
    const w = img.offsetWidth || img.clientWidth || img.naturalWidth || 300
    const h = img.offsetHeight || img.clientHeight || img.naturalHeight || 200
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
      style.margin = '2px 2px 2px 0'
      style.width = ''
    } else if (how === 'right') {
      style.float = 'right'
      style.display = ''
      style.margin = '2px 0 2px 2px'
      style.width = ''
    } else {
      style.float = 'none'
      style.display = 'block'
      style.margin = '2px auto'
      style.width = ''
    }
    setActiveImg(null)
  }, [activeImg])

  const scaleActiveImg = useCallback((dir: 'up' | 'down') => {
    const img = activeImg
    if (!img) return
    const styleImg = img.style
    // 현재 화면에 보이는 너비를 기준으로 조절 (naturalWidth 기준이면 max-width:100%에 의해 줄어들지 않음)
    const cur = img.clientWidth || parseInt(styleImg.width, 10) || img.naturalWidth || 300
    const finalW = Math.max(60, Math.min(cur + (dir === 'up' ? 60 : -60), 2000))
    styleImg.width = finalW + 'px'
    styleImg.height = 'auto'
    // 명시적 너비가 컨테이너보다 작을 때 max-width:100%가 표시 크기를 가둬두지 않도록 해제
    styleImg.maxWidth = 'none'
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

  const onHandleDown = useCallback((e: React.PointerEvent<HTMLDivElement>, kind: 'rotate' | 'resize', corner?: 'br' | 'bl' | 'tr' | 'tl') => {
    const img = activeImg
    if (!img) return
    e.preventDefault()
    e.stopPropagation()
    const base = imgBaseSize(img)
    const r = img.getBoundingClientRect()
    const natRatio = (img.naturalWidth && img.naturalHeight)
      ? img.naturalWidth / img.naturalHeight
      : (base.w / base.h)
    dragRef.current = {
      kind,
      corner,
      startX: e.clientX,
      startY: e.clientY,
      baseW: base.w,
      baseH: base.h,
      natRatio,
      orgAngle: getRotationDegrees(img),
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      startML: parseFloat(img.style.marginLeft) || 0,
      startMT: parseFloat(img.style.marginTop) || 0,
    }
    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      const im = activeImg
      if (!d || !im) return
      if (d.kind === 'resize') {
        const dx = ev.clientX - d.startX
        const dy = ev.clientY - d.startY
        const rad = (d.orgAngle * Math.PI) / 180
        const w1 = dx * Math.cos(rad) + dy * Math.sin(rad)
        const c = d.corner || 'br'
        const dW = (c === 'br' || c === 'tr') ? w1 : -w1
        const newW = Math.max(60, Math.min(700, d.baseW + dW))
        const newH = newW / d.natRatio
        im.style.width = newW + 'px'
        im.style.height = 'auto'
        const dWpx = newW - d.baseW
        const dHpx = newH - d.baseH
        if (!im.style.cssFloat) {
          let ml = d.startML
          let mt = d.startMT
          if (c === 'bl' || c === 'tl') ml = d.startML - dWpx
          if (c === 'tl' || c === 'tr') mt = d.startMT - dHpx
          im.style.marginLeft = ml + 'px'
          im.style.marginTop = mt + 'px'
        }
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

  const applyStyleToSelection = useCallback((prop: string, val: string) => {
    restoreSelection()
    const sel = window.getSelection()
    const ed = editorRef.current
    if (!ed || !sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (range.collapsed) {
      const span = document.createElement('span')
      span.style.cssText = `${prop}:${val}`
      span.appendChild(document.createTextNode('​'))
      range.insertNode(span)
      const r2 = document.createRange()
      r2.setStart(span.firstChild as Text, 1)
      r2.collapse(true)
      sel.removeAllRanges()
      sel.addRange(r2)
      ed.dispatchEvent(new Event('input', { bubbles: true }))
      return
    }
    const span = document.createElement('span')
    span.style.cssText = `${prop}:${val}`
    try {
      range.surroundContents(span)
    } catch {
      const frag = range.extractContents()
      span.appendChild(frag)
      range.insertNode(span)
    }
    sel.removeAllRanges()
    ed.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection])

  const insertTable = useCallback((rows: number, cols: number) => {
    const r = Math.max(1, Math.min(50, rows | 0))
    const c = Math.max(1, Math.min(50, cols | 0))
    let html = '<table style="border-collapse:collapse;width:100%;margin:8px 0"><tbody>'
    for (let i = 0; i < r; i++) {
      html += '<tr>'
      for (let j = 0; j < c; j++) {
        html += '<td style="border:1px solid #ccc;padding:6px;">&nbsp;</td>'
      }
      html += '</tr>'
    }
    html += '</tbody></table>'
    insertAtCursor(html)
  }, [insertAtCursor])

  const deleteTableAtCursor = useCallback(() => {
    restoreSelection()
    const sel = window.getSelection()
    const ed = editorRef.current
    if (!ed) return
    let node: Node | null = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : ed
    while (node && node !== ed) {
      if ((node as HTMLElement).tagName === 'TABLE') {
        (node as HTMLElement).remove()
        ed.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      node = node.parentNode
    }
    alert('커서를 지울 표 안에 두고 눌러주세요.')
  }, [restoreSelection])

  const getTableContext = useCallback(() => {
    const sel = window.getSelection()
    const ed = editorRef.current
    if (!ed || !sel || sel.rangeCount === 0) return null
    let node: Node | null = sel.getRangeAt(0).startContainer
    let cell: HTMLElement | null = null
    let row: HTMLElement | null = null
    let table: HTMLElement | null = null
    while (node && node !== ed) {
      const el = node as HTMLElement
      if (el.tagName === 'TD' || el.tagName === 'TH') cell = el
      if (el.tagName === 'TR') row = el
      if (el.tagName === 'TABLE') { table = el; break }
      node = node.parentNode
    }
    return table ? { table, row, cell } : null
  }, [])

  const insertRowBelow = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    const rowEl = ctx?.row as HTMLTableRowElement | null
    if (!ctx || !ctx.table || !rowEl) { alert('표 안에 커서를 두세요.'); return }
    const n = rowEl.cells.length
    const tr = document.createElement('tr')
    for (let i = 0; i < n; i++) {
      const td = document.createElement('td')
      td.style.cssText = 'border:1px solid #ccc;padding:6px;'
      td.innerHTML = '&nbsp;'
      tr.appendChild(td)
    }
    if (rowEl.nextSibling) rowEl.parentNode!.insertBefore(tr, rowEl.nextSibling)
    else rowEl.parentNode!.appendChild(tr)
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const deleteRow = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    if (!ctx || !ctx.row) { alert('표 안에 커서를 두세요.'); return }
    ctx.row.remove()
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const insertColRight = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    const rowEl = ctx?.row as HTMLTableRowElement | null
    const cellEl = ctx?.cell as HTMLTableCellElement | null
    if (!ctx || !ctx.table || !rowEl || !cellEl) { alert('표 안에 커서를 두세요.'); return }
    const idx = Array.prototype.indexOf.call(rowEl.cells, cellEl)
    ctx.table.querySelectorAll('tr').forEach((el) => {
      const tr = el as HTMLTableRowElement
      const ref = tr.cells[idx]
      const td = document.createElement('td')
      td.style.cssText = 'border:1px solid #ccc;padding:6px;'
      td.innerHTML = '&nbsp;'
      if (ref && ref.nextSibling) tr.insertBefore(td, ref.nextSibling)
      else tr.appendChild(td)
    })
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const deleteCol = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    const rowEl = ctx?.row as HTMLTableRowElement | null
    const cellEl = ctx?.cell as HTMLTableCellElement | null
    if (!ctx || !ctx.table || !rowEl || !cellEl) { alert('표 안에 커서를 두세요.'); return }
    const idx = Array.prototype.indexOf.call(rowEl.cells, cellEl)
    ctx.table.querySelectorAll('tr').forEach((el) => {
      const tr = el as HTMLTableRowElement
      if (tr.cells[idx]) tr.cells[idx].remove()
    })
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const toggleHeaderRow = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    const tableEl = ctx?.table as HTMLTableElement | null
    if (!ctx || !tableEl || !tableEl.rows[0]) { alert('표 안에 커서를 두세요.'); return }
    const firstRow = tableEl.rows[0]
    const isHeader = firstRow.cells[0] && firstRow.cells[0].tagName === 'TH'
    Array.from(firstRow.cells).forEach((c) => {
      const cellEl = c as HTMLTableCellElement
      const newEl = document.createElement(isHeader ? 'td' : 'th')
      newEl.style.cssText = cellEl.style.cssText
      newEl.innerHTML = cellEl.innerHTML
      cellEl.replaceWith(newEl)
    })
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const setCellBg = useCallback((color: string) => {
    restoreSelection()
    const ctx = getTableContext()
    if (!ctx || !ctx.cell) { alert('표 안에 커서를 두세요.'); return }
    ctx.cell.style.backgroundColor = color
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const applyTableBorder = useCallback(() => {
    restoreSelection()
    const ctx = getTableContext()
    if (!ctx || !ctx.table) { alert('표 안에 커서를 두세요.'); return }
    const b = `${tblBorderW}px ${tblBorderStyle} ${tblBorderColor}`
    ctx.table.style.borderCollapse = 'collapse'
    ctx.table.style.border = b
    ctx.table.querySelectorAll('td,th').forEach((c) => {
      const cell = c as HTMLTableCellElement
      cell.style.border = b
    })
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext, tblBorderW, tblBorderStyle, tblBorderColor])

  const setTableBg = useCallback((color: string) => {
    restoreSelection()
    const ctx = getTableContext()
    if (!ctx || !ctx.table) { alert('표 안에 커서를 두세요.'); return }
    ctx.table.style.backgroundColor = color
    editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
  }, [restoreSelection, getTableContext])

  const IMG_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif']
  const isImageFile = (f: File): boolean => {
    const ext = (f.name.split('.').pop() || '').toLowerCase()
    if (f.type.startsWith('image/') || IMG_EXTS.includes(ext)) return true
    if (f.type === '' && /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i.test(f.name)) return true
    return false
  }

  const uploadImage = useCallback(async (file: File, matchRange?: Range | null) => {
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
      if (matchRange) {
        const img = document.createElement('img')
        img.src = data.url
        img.draggable = false
        img.alt = '매치 이미지'
        img.style.cssText = 'float:left;margin:2px;border-radius:8px;height:5em;width:auto;max-width:none;vertical-align:top;'
        const r = matchRange.cloneRange()
        r.collapse(false)
        r.insertNode(img)
        editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
      } else {
        insertAtCursor(`<img draggable="false" src="${data.url}" style="float:left;margin:2px;border-radius:8px;max-width:60%;height:auto" alt="첨부 이미지" />`)
      }
    } catch {
      alert('이미지 업로드에 실패했습니다.')
    }
  }, [uploadUrl, insertAtCursor])

  // cropperjs is bundled (imported at top) — no CDN dependency

  const requestCrop = (file: File, matchRange?: Range | null) => {
    if (!isImageFile(file)) {
      uploadImage(file, matchRange ?? null)
      return
    }
    setCropMode('upload')
    cropFileRef.current = file
    cropMatchRef.current = matchRange ?? null
    setCropSrc(URL.createObjectURL(file))
  }

  useEffect(() => {
    if (!cropSrc) return
    const img = cropImgRef.current
    if (!img) return
    img.onload = () => {
      if (cropperRef.current) cropperRef.current.destroy()
      cropperRef.current = new Cropper(img, { viewMode: 1, autoCropArea: 1 })
    }
    img.src = cropSrc
  }, [cropSrc])

  const closeCrop = () => {
    if (cropperRef.current) { cropperRef.current.destroy(); cropperRef.current = null }
    if (cropSrc && cropSrc.startsWith('blob:')) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
    cropFileRef.current = null
    cropMatchRef.current = null
    setCropMode('upload')
    cropTargetImgRef.current = null
  }

  const uploadCroppedBlob = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const fd = new FormData()
      fd.append('file', blob, 'cropped.png')
      fetch(uploadUrl, { method: 'POST', body: fd, credentials: 'include' })
        .then(r => r.json())
        .then(d => { if (d.status === 'success' && d.url) resolve(d.url); else reject(new Error(d.msg || 'fail')) })
        .catch(reject)
    })

  const startCropActive = () => {
    if (!activeImg) return
    cropTargetImgRef.current = activeImg
    setCropMode('replace')
    setCropSrc(activeImg.src)
  }

  const applyCrop = () => {
    if (!cropperRef.current) return
    const canvas = cropperRef.current.getCroppedCanvas({ maxWidth: 1600, maxHeight: 1600, imageSmoothingQuality: 'high' })
    canvas.toBlob((b: Blob | null) => {
      if (!b) return
      if (cropMode === 'replace' && cropTargetImgRef.current) {
        uploadCroppedBlob(b)
          .then(url => {
            const el = cropTargetImgRef.current
            if (el) {
              el.src = url
              editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
            }
            closeCrop()
          })
          .catch(() => alert('이미지 자르기 업로드에 실패했습니다.'))
        return
      }
      const base = (cropFileRef.current?.name || 'image').replace(/\.[^.]+$/, '')
      const f = new File([b], base + '.png', { type: 'image/png' })
      uploadImage(f, cropMatchRef.current)
      closeCrop()
    }, 'image/png')
  }

  const startTransparent = () => {
    if (!activeImg) return
    cropTargetImgRef.current = activeImg
    setTransSrc(activeImg.src)
  }

  useEffect(() => {
    if (!transSrc) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const max = 1600
      let w = img.naturalWidth
      let h = img.naturalHeight
      const scale = Math.min(1, max / Math.max(w, h))
      w = Math.max(1, Math.round(w * scale))
      h = Math.max(1, Math.round(h * scale))
      const canvas = transCanvasRef.current
      if (!canvas) return
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)
      transWorkRef.current = { ctx, img: imgData, w, h }
    }
    img.src = transSrc
  }, [transSrc])

  const transClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const work = transWorkRef.current
    const canvas = transCanvasRef.current
    if (!work || !canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * (canvas.width / rect.width))
    const y = Math.floor((e.clientY - rect.top) * (canvas.height / rect.height))
    if (x < 0 || y < 0 || x >= work.w || y >= work.h) return
    const d = work.img.data
    const si = (y * work.w + x) * 4
    if (d[si + 3] === 0) return
    const sr = d[si]
    const sg = d[si + 1]
    const sb = d[si + 2]
    const sa = d[si + 3]
    const tol = transTol
    const match = (i: number) =>
      Math.abs(d[i] - sr) <= tol &&
      Math.abs(d[i + 1] - sg) <= tol &&
      Math.abs(d[i + 2] - sb) <= tol &&
      Math.abs(d[i + 3] - sa) <= tol
    const stack: number[] = [x, y]
    while (stack.length) {
      const py = stack.pop() as number
      const px = stack.pop() as number
      if (px < 0 || py < 0 || px >= work.w || py >= work.h) continue
      const i = (py * work.w + px) * 4
      if (!match(i)) continue
      d[i + 3] = 0
      stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1)
    }
    work.ctx.putImageData(work.img, 0, 0)
  }

  const closeTrans = () => {
    if (transSrc && transSrc.startsWith('blob:')) URL.revokeObjectURL(transSrc)
    setTransSrc(null)
    transWorkRef.current = null
    cropTargetImgRef.current = null
  }

  const applyTrans = () => {
    const canvas = transCanvasRef.current
    if (!canvas) return
    canvas.toBlob((b: Blob | null) => {
      if (!b) return
      if (cropTargetImgRef.current) {
        uploadCroppedBlob(b)
          .then(url => {
            const el = cropTargetImgRef.current
            if (el) {
              el.src = url
              editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
            }
            closeTrans()
          })
          .catch(() => alert('이미지 투명화 업로드에 실패했습니다.'))
        return
      }
      closeTrans()
    }, 'image/png')
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) { matchSelRef.current = null; return }
    const mr = matchSelRef.current?.range ?? null
    for (const f of Array.from(files)) {
      if (files.length === 1) requestCrop(f, mr)
      else await uploadImage(f, mr)
    }
    matchSelRef.current = null
    e.target.value = ''
  }

  const startMatch = () => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      alert('먼저 본문에서 글자를 드래그해 선택하세요.')
      return
    }
    const range = sel.getRangeAt(0)
    if (!sel.toString().trim()) {
      alert('글자를 선택하세요.')
      return
    }
    if (activeImg) {
      const img = activeImg
      img.style.cssFloat = 'left'
      img.style.margin = '2px'
      img.style.maxWidth = 'none'
      img.style.height = img.style.height || '5em'
      img.style.width = 'auto'
      img.style.verticalAlign = 'top'
      const r = range.cloneRange()
      r.collapse(false)
      img.remove()
      r.insertNode(img)
      setActiveImg(null)
      editorRef.current?.dispatchEvent(new Event('input', { bubbles: true }))
    } else {
      matchSelRef.current = { range }
      fileInputRef.current?.click()
    }
  }

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files?.length) return
    setFileUploading(true)
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', f)
        const r = await fetch(fileUploadUrl, { method: 'POST', body: fd, credentials: 'include' })
        let res: any = {}
        try { res = await r.json() } catch { res = { error: await r.text().catch(() => '') } }
        if (r.ok && res.url) {
          const name = res.name || f.name
          insertAtCursor(
            `<div style="margin:6px 0"><a href="${res.url}" rel="noopener noreferrer" download="${name}" ` +
            `style="display:inline-block;padding:6px 10px;border:1px solid #dee2e6;border-radius:8px;background:#f8f9fa;color:#198754;text-decoration:none;font-size:0.9rem;">📎 ${name}</a></div>`
          )
        } else {
          const msg = res.error || `상태 ${r.status}`
          alert('파일 업로드 실패: ' + msg + (r.status === 401 ? '\n(로그인이 필요합니다. 시크릿 창이라면 해당 창에서 다시 로그인하세요.)' : ''))
        }
      }
    } catch (err) {
      alert('파일 업로드 실패: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setFileUploading(false)
      if (fileAttachRef.current) fileAttachRef.current.value = ''
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const it of Array.from(items)) {
      if (it.type.startsWith('image/')) {
        e.preventDefault()
        const file = it.getAsFile()
        if (file) requestCrop(file)
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

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current
    if (!c) return
    drawingRef.current = true
    const rect = c.getBoundingClientRect()
    const x = (e.clientX - rect.left) * (c.width / rect.width)
    const y = (e.clientY - rect.top) * (c.height / rect.height)
    drawStartRef.current = { x, y }
    const ctx = c.getContext('2d')
    if (!ctx) return
    drawSnapRef.current = ctx.getImageData(0, 0, c.width, c.height)
    if (drawMode === 'free') { ctx.beginPath(); ctx.moveTo(x, y) }
  }

  const stopDraw = () => {
    drawingRef.current = false
    drawStartRef.current = null
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
    const x = (e.clientX - rect.left) * (c.width / rect.width)
    const y = (e.clientY - rect.top) * (c.height / rect.height)
    const s = drawStartRef.current
    ctx.lineWidth = drawWidth
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = drawColor
    if (drawMode === 'free') {
      ctx.lineTo(x, y)
      ctx.stroke()
      return
    }
    if (!s) return
    if (drawSnapRef.current) ctx.putImageData(drawSnapRef.current, 0, 0)
    ctx.beginPath()
    if (drawMode === 'line') {
      ctx.moveTo(s.x, s.y)
      ctx.lineTo(x, y)
    } else {
      const cx = (s.x + x) / 2
      const cy = (s.y + y) / 2
      ctx.ellipse(cx, cy, Math.abs(x - s.x) / 2, Math.abs(y - s.y) / 2, 0, 0, Math.PI * 2)
    }
    ctx.stroke()
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

  useEffect(() => {
    if (!showCanvas) return
    const size = () => {
      const c = canvasRef.current
      const ed = editorRef.current
      if (!c || !ed) return
      const w = ed.clientWidth
      const h = ed.clientHeight
      c.width = w
      c.height = h
      c.style.width = w + 'px'
      c.style.height = h + 'px'
    }
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [showCanvas])

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
        <div className="btn-group btn-group-sm" style={{ display: 'flex', flexWrap: 'nowrap' }}>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`btn ${showFormat ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setShowFormat(v => !v); setShowPara(false); setShowTable(false); setShowDraw(false) }} title="글꾸미기">🎨 글꾸미기 ▾</button>
            {showFormat && (
              <div className="btn-group btn-group-sm flex-wrap mt-1" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 6000, background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: 4 }}>
                <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('bold')} title="굵게"><b>B</b></button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('italic')} title="기울임"><i>I</i></button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('underline')} title="밑줄"><u>U</u></button>
                <select className="btn btn-outline-secondary" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { applyCmd('fontName', v); e.target.value = '' } }} title="글꼴">
                  <option value="">글꼴</option>
                  <option value="Batang">바탕체</option>
                  <option value="Gungsuh">궁서체</option>
                  <option value="Dotum">돋움체</option>
                  <option value="Gulim">굴림체</option>
                  <option value="Malgun Gothic">맑은 고딕</option>
                  <option value="Arial">Arial</option>
                  <option value="Verdana">Verdana</option>
                  <option value="Courier New">Courier New</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Times New Roman">Times New Roman</option>
                </select>
                <input type="number" className="btn btn-outline-secondary" style={{ width: 64 }} min={6} max={200} placeholder="px" value={fontSizePx} onChange={(e) => setFontSizePx(e.target.value)} onBlur={() => { if (fontSizePx) applyStyleToSelection('font-size', fontSizePx + 'px') }} title="글자 크기(px)" />
                <input type="color" className="btn btn-outline-secondary" style={{ padding: 2, width: 38 }} title="글자 색" onChange={(e) => applyCmd('foreColor', e.target.value)} />
                <input type="color" className="btn btn-outline-secondary" style={{ padding: 2, width: 38 }} title="형광펜(배경)" onChange={(e) => applyCmd('hiliteColor', e.target.value)} />
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`btn ${showPara ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setShowPara(v => !v); setShowTable(false); setShowFormat(false); setShowDraw(false) }} title="문단">📑 문단 ▾</button>
            {showPara && (
              <div className="btn-group btn-group-sm flex-wrap mt-1" style={{ position: 'absolute', top: '100%', left: 0, zIndex: 6000, background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: 4 }}>
                <button type="button" className="btn btn-outline-secondary" onClick={() => applyCmd('justifyLeft')} title="왼쪽 정렬">⬅</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => applyCmd('justifyCenter')} title="가운데 정렬">⬌</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => applyCmd('justifyRight')} title="오른쪽 정렬">➡</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => applyCmd('justifyFull')} title="양쪽 정렬">⬌⬌</button>
                <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('insertOrderedList')} title="번호 목록">1.</button>
                <select className="btn btn-outline-secondary" defaultValue="" onChange={(e) => { const v = e.target.value; if (v) { applyCmd('formatBlock', v); e.target.value = '' } }} title="문단 서식">
                  <option value="">문단</option>
                  <option value="P">일반 문단</option>
                  <option value="H2">제목 1</option>
                  <option value="H3">제목 2</option>
                  <option value="BLOCKQUOTE">인용</option>
                  <option value="PRE">코드</option>
                </select>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`btn ${showTable ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { setShowTable(v => !v); setShowPara(false); setShowFormat(false); setShowDraw(false) }} title="표">▦ 표 ▾</button>
            {showTable && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 6000, background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center', maxWidth: 560 }}>
                <label>행 <input type="number" min={1} max={20} value={tableRows} onChange={(e) => setTableRows(Number(e.target.value))} style={{ width: 48 }} /></label>
                <label>열 <input type="number" min={1} max={20} value={tableCols} onChange={(e) => setTableCols(Number(e.target.value))} style={{ width: 48 }} /></label>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { insertTable(tableRows, tableCols); setShowTable(false) }}>표 삽입</button>
                <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => { deleteTableAtCursor(); setShowTable(false) }}>🗑 표 삭제</button>
                <span style={{ flexBasis: '100%', height: 0 }} />
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={insertRowBelow}>➕ 행 추가</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={deleteRow}>➖ 행 삭제</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={insertColRight}>➕ 열 추가</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={deleteCol}>➖ 열 삭제</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={toggleHeaderRow}>🔝 머리글 행</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>🎨 셀 배경 <input type="color" style={{ width: 32, height: 28 }} onChange={(e) => setCellBg(e.target.value)} /></label>
                <span style={{ flexBasis: '100%', height: 0 }} />
                <span style={{ fontWeight: 600 }}>테두리</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>두께
                  <select className="btn btn-outline-secondary btn-sm" value={tblBorderW} onChange={(e) => setTblBorderW(e.target.value)}>
                    <option value="0">0</option>
                    <option value="1">1px</option>
                    <option value="2">2px</option>
                    <option value="3">3px</option>
                    <option value="4">4px</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>모양
                  <select className="btn btn-outline-secondary btn-sm" value={tblBorderStyle} onChange={(e) => setTblBorderStyle(e.target.value)}>
                    <option value="solid">실선</option>
                    <option value="dashed">점선</option>
                    <option value="dotted">점</option>
                    <option value="double">이중선</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>색상
                  <input type="color" value={tblBorderColor} style={{ width: 32, height: 28 }} onChange={(e) => setTblBorderColor(e.target.value)} />
                </label>
                <button type="button" className="btn btn-primary btn-sm" onClick={applyTableBorder}>테두리 적용</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>▣ 표 배경
                  <input type="color" style={{ width: 32, height: 28 }} onChange={(e) => setTableBg(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button type="button" className={`btn ${showDraw ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => { const n = !showDraw; setShowDraw(n); setShowCanvas(n); setShowFormat(false); setShowPara(false); setShowTable(false) }} title="그리기">✏️ 그리기 ▾</button>
            {showDraw && (
              <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 6000, background: '#fff', border: '1px solid #ccc', borderRadius: 8, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
                <span style={{ fontWeight: 600 }}>모드</span>
                <button type="button" className={`btn btn-sm ${drawMode === 'free' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDrawMode('free')}>자유</button>
                <button type="button" className={`btn btn-sm ${drawMode === 'line' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDrawMode('line')}>직선</button>
                <button type="button" className={`btn btn-sm ${drawMode === 'circle' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setDrawMode('circle')}>원형</button>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>두께
                  <input type="number" min={1} max={40} value={drawWidth} onChange={(e) => setDrawWidth(Number(e.target.value))} style={{ width: 56 }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 2 }}>색상
                  <input type="color" value={drawColor} onChange={(e) => setDrawColor(e.target.value)} style={{ width: 32, height: 28 }} />
                </label>
                <span style={{ flexBasis: '100%', height: 0 }} />
                <button type="button" className="btn btn-light btn-sm" onClick={clearCanvas}>지우기</button>
                <button type="button" className="btn btn-success btn-sm" onClick={applyDrawing}>그림 본문에 넣기</button>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setShowDraw(false); setShowCanvas(false) }}>닫기</button>
              </div>
            )}
          </div>

          <button type="button" className="btn btn-outline-secondary" onClick={() => fileInputRef.current?.click()} title="사진/파일 첨부">📎 이미지첨부</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => fileAttachRef.current?.click()} title="파일 첨부 (이미지 외 모든 파일)" disabled={fileUploading}>
            {fileUploading ? '⏳' : '📁'} 파일첨부
          </button>
          <button type="button" className="btn btn-outline-secondary" onClick={startMatch} title="선택한 글자와 이미지 매치">💞 매치</button>
          <button type="button" className="btn btn-outline-secondary" onClick={() => execCmd('insertUnorderedList')} title="목록">&bull; 단락</button>

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
            <button type="button" className="btn btn-outline-primary" onClick={startCropActive} title="이미지 자르기">✂ 자르기</button>
            <button type="button" className="btn btn-outline-primary" onClick={startTransparent} title="배경/색상 투명화">🪄 투명화</button>
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
          onMouseUp={saveSelection}
          onKeyUp={saveSelection}
          onBlur={saveSelection}
          data-placeholder={placeholder}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute', left: 0, top: 0, zIndex: 4000,
            pointerEvents: showCanvas ? 'auto' : 'none',
            background: 'transparent', cursor: showCanvas ? 'crosshair' : 'default',
            borderRadius: 12, display: showCanvas ? 'block' : 'none',
          }}
          onMouseDown={startDraw}
          onMouseUp={stopDraw}
          onMouseMove={draw}
          onMouseLeave={stopDraw}
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
            {(['tl', 'tr', 'bl', 'br'] as const).map((corner) => {
              const cStyle: React.CSSProperties = {
                position: 'absolute',
                width: 24, height: 24, background: '#27ae60', borderRadius: '50%',
                cursor: (corner === 'tl' || corner === 'br') ? 'nwse-resize' : 'nesw-resize',
                zIndex: 5001, touchAction: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 10, boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                pointerEvents: 'auto',
              }
              if (corner === 'tl') { cStyle.left = -6; cStyle.top = -6 }
              if (corner === 'tr') { cStyle.right = -6; cStyle.top = -6 }
              if (corner === 'bl') { cStyle.left = -6; cStyle.bottom = -6 }
              if (corner === 'br') { cStyle.right = -6; cStyle.bottom = -6 }
              return (
                <div key={corner} onPointerDown={e => onHandleDown(e, 'resize', corner)}
                  style={cStyle}>⤢</div>
              )
            })}
          </div>
        )}
      </div>

      <input type="file" ref={fileInputRef} className="d-none" accept="image/*,.heic,.heif,application/pdf" multiple onChange={handleFileChange} />
      <input type="file" ref={fileAttachRef} className="d-none" multiple accept="*/*" onChange={handleFileAttach} />

      {showCanvas && (
        <div className="d-flex gap-2 mb-2">
          <button type="button" className="btn btn-sm btn-light" onClick={clearCanvas}>지우기</button>
          <button type="button" className="btn btn-sm btn-success" onClick={applyDrawing}>그림 본문에 넣기</button>
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

      {cropSrc && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 7000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeCrop}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: 520, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="fw-bold mb-2">이미지 자르기</div>
            <div style={{ maxHeight: '60vh', overflow: 'hidden' }}>
              <img ref={cropImgRef} alt="crop" style={{ maxWidth: '100%', display: 'block' }} />
            </div>
            <div className="d-flex justify-content-end gap-2 mt-3">
              <button type="button" className="btn btn-sm btn-secondary" onClick={closeCrop}>취소</button>
              <button type="button" className="btn btn-sm btn-success" onClick={applyCrop}>적용</button>
            </div>
          </div>
        </div>
      )}

      {transSrc && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 7000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={closeTrans}
        >
          <div
            style={{ background: '#fff', borderRadius: 12, padding: 16, maxWidth: 520, width: '100%' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="fw-bold mb-2">이미지 투명화 (클릭한 색 제거)</div>
            <div
              style={{
                maxHeight: '60vh', overflow: 'auto',
                backgroundImage: 'linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%)',
                backgroundSize: '16px 16px',
                backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
                backgroundColor: '#fff',
              }}
            >
              <canvas ref={transCanvasRef} onClick={transClick} style={{ maxWidth: '100%', display: 'block', cursor: 'crosshair' }} />
            </div>
            <div className="d-flex align-items-center gap-2 my-2">
              <label className="small mb-0">유사도</label>
              <input type="range" min={0} max={255} value={transTol} onChange={e => setTransTol(Number(e.target.value))} style={{ flex: 1 }} />
              <span className="small">{transTol}</span>
            </div>
            <small className="text-muted d-block mb-2">이미지에서 제거할 색을 클릭하세요. 여러 번 클릭해 영역을 추가로 지울 수 있습니다.</small>
            <div className="d-flex justify-content-end gap-2 mt-2">
              <button type="button" className="btn btn-sm btn-secondary" onClick={closeTrans}>취소</button>
              <button type="button" className="btn btn-sm btn-success" onClick={applyTrans}>적용</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export default ContentEditor