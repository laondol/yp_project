import { useState, useRef, useCallback, useEffect } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import type Konva from 'konva'
import type { EditorElement, EditorSnapshot, WidgetEditorProps } from './types'
import URLImage from './URLImage'
import VectorShape from './VectorShape'
import TextElement from './TextElement'
import DrawingLine from './DrawingLine'
import Toolbar from './Toolbar'

let nextId = 1
function uid() { return `el_${Date.now()}_${nextId++}` }

export default function WidgetEditor({ initialData, onSave }: WidgetEditorProps) {
  const [elements, setElements] = useState<EditorElement[]>(initialData?.elements || [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isDrawingMode, setIsDrawingMode] = useState(false)
  const [isTextTypingMode, setIsTextTypingMode] = useState(false)
  const [canvasW] = useState(initialData?.canvasWidth || 800)
  const [canvasH] = useState(initialData?.canvasHeight || 600)
  const [bgColor] = useState(initialData?.backgroundColor || '#ffffff')
  const [dragOver, setDragOver] = useState(false)

  const stageRef = useRef<Konva.Stage>(null)
  const drawingRef = useRef<{ id: string; points: number[] } | null>(null)
  const selectedEl = elements.find(el => el.id === selectedId) || null

  // 텍스트 타이핑 모드: 클릭 시 텍스트 생성
  const handleStageClick = useCallback((e: any) => {
    if (e.target !== e.target.getStage()) return
    
    if (isTextTypingMode) {
      const stage = e.target.getStage()
      const pos = stage.getPointerPosition()
      if (!pos) return

      const defaultSpan = { text: '', fontSize: 20, fill: '#000000', bold: false, italic: false, underline: false }
      const id = uid()
      const newEl: EditorElement = {
        id, type: 'text' as const, x: pos.x, y: pos.y,
        width: 200, height: 40, boxWidth: 200, boxHeight: 40,
        text: '', spans: [defaultSpan],
        fontSize: 20, fontFamily: 'sans-serif',
        fill: '#000000', rotation: 0, opacity: 1, visible: true,
        textMode: 'graphic' as const,
        isSelected: false,
      }
      setElements(prev => [...prev, newEl])
      setSelectedId(id)
      setIsTextTypingMode(false)
      return
    }

    if (isDrawingMode) return
    setSelectedId(null)
  }, [isTextTypingMode, isDrawingMode])

  // 드로잉 중 마우스 이동 처리
  const handleMouseDown = useCallback((e: any) => {
    if (!isDrawingMode) return
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    if (!pos) return

    const id = uid()
    drawingRef.current = { id, points: [pos.x, pos.y] }
    setElements(prev => [...prev, {
      id, type: 'drawing', points: [pos.x, pos.y],
      stroke: '#000000', strokeWidth: 3, opacity: 1, visible: true,
    }])
  }, [isDrawingMode])

  const handleMouseMove = useCallback((e: any) => {
    if (!isDrawingMode || !drawingRef.current) return
    const stage = e.target.getStage()
    const pos = stage.getPointerPosition()
    if (!pos) return

    drawingRef.current.points.push(pos.x, pos.y)
    setElements(prev => prev.map(el =>
      el.id === drawingRef.current!.id
        ? { ...el, points: [...drawingRef.current!.points] }
        : el
    ))
  }, [isDrawingMode])

  const handleMouseUp = useCallback(() => {
    drawingRef.current = null
  }, [])

  // 배경 클릭 시 선택 해제 (더 이상 사용 안 함 - handleStageClick에서 처리)

  // 요소 업데이트
  const handleElementChange = useCallback((newEl: EditorElement) => {
    setElements(prev => prev.map(el => el.id === newEl.id ? newEl : el))
  }, [])

  // 요소 추가
  const addElement = useCallback((el: EditorElement) => {
    setElements(prev => [...prev, el])
    setSelectedId(el.id)
  }, [])

  const addText = useCallback(() => {
    const defaultSpan = { text: '텍스트를 입력하세요', fontSize: 20, fill: '#000000', bold: false, italic: false, underline: false }
    addElement({
      id: uid(), type: 'text', x: 50, y: 50,
      width: 200, height: 40, boxWidth: 200, boxHeight: 40,
      text: '텍스트를 입력하세요', spans: [defaultSpan],
      fontSize: 20, fontFamily: 'sans-serif',
      fill: '#000000', rotation: 0, opacity: 1, visible: true,
      textMode: 'graphic',
      isSelected: false,
    })
  }, [addElement])

  const addImage = useCallback((src: string) => {
    const img = new window.Image()
    img.onload = () => {
      addElement({
        id: uid(), type: 'image', x: 50, y: 50,
        width: Math.min(img.width, 300), height: Math.min(img.height, 250),
        src, rotation: 0, opacity: 1, visible: true,
      })
    }
    img.src = src
  }, [addElement])

  const addRect = useCallback(() => {
    addElement({
      id: uid(), type: 'shape', shapeType: 'rect', x: 100, y: 100,
      width: 120, height: 80, fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 2,
      rotation: 0, opacity: 1, visible: true,
    })
  }, [addElement])

  const addCircle = useCallback(() => {
    addElement({
      id: uid(), type: 'shape', shapeType: 'circle', x: 150, y: 150,
      width: 100, height: 100, fill: '#dcfce7', stroke: '#16a34a', strokeWidth: 2,
      rotation: 0, opacity: 1, visible: true,
    })
  }, [addElement])

  const addTriangle = useCallback(() => {
    addElement({
      id: uid(), type: 'shape', shapeType: 'triangle', x: 200, y: 100,
      width: 100, height: 100, fill: '#fef3c7', stroke: '#d97706', strokeWidth: 2,
      rotation: 0, opacity: 1, visible: true,
    })
  }, [addElement])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setElements(prev => prev.filter(el => el.id !== selectedId))
    setSelectedId(null)
  }, [selectedId])

  // 드래그앤드롭
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true) }, [])
  const handleDragLeave = useCallback(() => setDragOver(false), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    Array.from(e.dataTransfer.files).forEach(f => {
      if (!f.type.startsWith('image/') && !/\.(heic|heif|svg)$/i.test(f.name)) return
      const reader = new FileReader()
      reader.onload = (ev) => { if (ev.target?.result) addImage(ev.target.result as string) }
      reader.readAsDataURL(f)
    })
  }, [addImage])

  // 내보내기
  const exportPNG = useCallback(() => {
    const url = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!url) return
    const a = document.createElement('a'); a.download = `editor-${Date.now()}.png`; a.href = url; a.click()
  }, [])

  const exportHTML5 = useCallback(() => {
    const url = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!url) return
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Editor Export</title>
<style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f0f0f0}
img{box-shadow:0 2px 12px rgba(0,0,0,.2)}</style></head>
<body><img src="${url}"></body></html>`
    const blob = new Blob([html], { type: 'text/html' })
    const a = document.createElement('a'); a.download = `editor-${Date.now()}.html`; a.href = URL.createObjectURL(blob); a.click()
  }, [])

  const exportRTF = useCallback(() => {
    const url = stageRef.current?.toDataURL({ pixelRatio: 2 })
    if (!url) return
    const b64 = url.split(',')[1] || ''
    const rtf = `{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}
{\\pard\\qc\\b\\fs36 Editor Export\\b0\\par}
{\\pard\\par}
{\\pict\\pngblip\\picw${canvasW * 20}\\pich${canvasH * 20}
${b64}
}}`
    const blob = new Blob([rtf], { type: 'application/rtf' })
    const a = document.createElement('a'); a.download = `editor-${Date.now()}.rtf`; a.href = URL.createObjectURL(blob); a.click()
  }, [canvasW, canvasH])

  const handleSaveJSON = useCallback(() => {
    const snapshot: EditorSnapshot = { elements, canvasWidth: canvasW, canvasHeight: canvasH, backgroundColor: bgColor }
    const image = stageRef.current?.toDataURL({ pixelRatio: 2 }) || ''
    onSave?.(snapshot, image)
  }, [elements, canvasW, canvasH, bgColor, onSave])

  // 키보드 단축키
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault()
        deleteSelected()
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, deleteSelected])

  return (
    <div className="d-flex flex-column h-100 border rounded overflow-hidden bg-white">
      <Toolbar
        isDrawingMode={isDrawingMode}
        isTextTypingMode={isTextTypingMode}
        onToggleDrawingMode={() => { setIsDrawingMode(!isDrawingMode); setSelectedId(null); setIsTextTypingMode(false) }}
        onToggleTextTypingMode={() => { setIsTextTypingMode(!isTextTypingMode); setSelectedId(null); setIsDrawingMode(false) }}
        onAddText={addText}
        onAddImage={addImage}
        onAddRect={addRect}
        onAddCircle={addCircle}
        onAddTriangle={addTriangle}
        onDelete={deleteSelected}
        hasSelection={!!selectedId}
        onExportPNG={exportPNG}
        onExportHTML5={exportHTML5}
        onExportRTF={exportRTF}
        onSave={handleSaveJSON}
      />

      <div className="d-flex flex-grow-1 overflow-hidden">
        {/* 캔버스 */}
        <div className="flex-grow-1 d-flex align-items-center justify-content-center p-2"
          style={{ background: '#e5e7eb', position: 'relative', cursor: isTextTypingMode ? 'text' : (isDrawingMode ? 'crosshair' : 'default') }}
          onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
          <Stage
            ref={stageRef}
            width={canvasW}
            height={canvasH}
            style={{ boxShadow: '0 2px 12px rgba(0,0,0,.15)', cursor: isTextTypingMode ? 'text' : (isDrawingMode ? 'crosshair' : 'default') }}
            onMouseDown={isDrawingMode ? handleMouseDown : handleStageClick}
            onTouchStart={isDrawingMode ? handleMouseDown : handleStageClick}
            onMouseMove={handleMouseMove}
            onTouchMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchEnd={handleMouseUp}
          >
            <Layer>
              <RectForBackground width={canvasW} height={canvasH} fill={bgColor} />
              {elements.map(el => {
                if (!el.visible) return null
                if (el.type === 'image') {
                  return <URLImage key={el.id} element={el} isSelected={el.id === selectedId}
                    onSelect={() => !isDrawingMode && setSelectedId(el.id)} onChange={handleElementChange} />
                }
                if (el.type === 'shape') {
                  return <VectorShape key={el.id} element={el} isSelected={el.id === selectedId}
                    onSelect={() => !isDrawingMode && setSelectedId(el.id)} onChange={handleElementChange} />
                }
                if (el.type === 'text') {
                  return <TextElement key={el.id} element={el} isSelected={el.id === selectedId}
                    onSelect={() => !isDrawingMode && setSelectedId(el.id)} onChange={handleElementChange} />
                }
                if (el.type === 'drawing') {
                  return <DrawingLine key={el.id} element={el} />
                }
                return null
              })}
            </Layer>
          </Stage>

          {dragOver && (
            <div className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
              style={{ background: 'rgba(37,99,235,.15)', border: '3px dashed #2563eb', borderRadius: 8, pointerEvents: 'none', zIndex: 999 }}>
              <span className="fw-bold text-primary">🖼 여기에 이미지를 드롭하세요</span>
            </div>
          )}
        </div>

        {/* 속성 패널 */}
        <div className="border-start overflow-auto p-2" style={{ width: 200, fontSize: '0.8rem', flexShrink: 0 }}>
          <div className="fw-bold mb-2">📐 속성</div>
          {selectedEl ? (
            <PropsPanel element={selectedEl} onChange={handleElementChange} />
          ) : (
            <div className="text-muted small">요소를 선택하세요</div>
          )}
        </div>
      </div>
    </div>
  )
}

// 배경용 Rect (이벤트 전달 안 함)
function RectForBackground({ width, height, fill }: { width: number; height: number; fill: string }) {
  return <Rect x={0} y={0} width={width} height={height} fill={fill} />
}

// 속성 패널
function PropsPanel({ element, onChange }: { element: EditorElement; onChange: (el: EditorElement) => void }) {
  if (element.type === 'text') {
    return (
      <div className="d-flex flex-column gap-2">
        <div>
          <label className="form-label small fw-bold">폰트 크기</label>
          <div className="d-flex align-items-center gap-1">
            <input type="range" className="form-range form-range-sm" min={8} max={72} value={element.fontSize}
              onChange={e => onChange({ ...element, fontSize: +e.target.value })} />
            <input type="number" className="form-control form-control-sm" value={element.fontSize} style={{ width: 50 }}
              onChange={e => onChange({ ...element, fontSize: Math.max(8, +e.target.value) })} />
          </div>
        </div>
        <div>
          <label className="form-label small fw-bold">폰트</label>
          <select className="form-select form-select-sm" value={element.fontFamily}
            onChange={e => onChange({ ...element, fontFamily: e.target.value })}>
            <option value="sans-serif">Sans-serif</option>
            <option value="serif">Serif</option>
            <option value="monospace">Monospace</option>
            <option value="cursive">Cursive</option>
          </select>
        </div>
        <div>
          <label className="form-label small fw-bold">색상</label>
          <input type="color" className="form-control form-control-sm form-control-color" value={element.fill}
            onChange={e => onChange({ ...element, fill: e.target.value })} />
        </div>
        <div>
          <label className="form-label small fw-bold">박스 크기</label>
          <div className="d-flex gap-1">
            <input type="number" className="form-control form-control-sm" value={element.boxWidth} placeholder="W"
              onChange={e => onChange({ ...element, boxWidth: Math.max(60, +e.target.value) })} style={{ width: 70 }} />
            <span className="align-self-center">×</span>
            <input type="number" className="form-control form-control-sm" value={element.boxHeight} placeholder="H"
              onChange={e => onChange({ ...element, boxHeight: Math.max(24, +e.target.value) })} style={{ width: 70 }} />
          </div>
        </div>
        <div>
          <label className="form-label small fw-bold">텍스트</label>
          <textarea className="form-control form-control-sm" rows={3} value={element.text}
            onChange={e => onChange({ ...element, text: e.target.value })} />
        </div>
      </div>
    )
  }

  if (element.type === 'shape') {
    return (
      <div className="d-flex flex-column gap-2">
        <div>
          <label className="form-label small fw-bold">채우기</label>
          <input type="color" className="form-control form-control-sm form-control-color" value={element.fill}
            onChange={e => onChange({ ...element, fill: e.target.value })} />
        </div>
        <div>
          <label className="form-label small fw-bold">테두리</label>
          <input type="color" className="form-control form-control-sm form-control-color" value={element.stroke}
            onChange={e => onChange({ ...element, stroke: e.target.value })} />
        </div>
        <div>
          <label className="form-label small fw-bold">테두리 두께</label>
          <input type="number" className="form-control form-control-sm" value={element.strokeWidth}
            onChange={e => onChange({ ...element, strokeWidth: Math.max(0, +e.target.value) })} />
        </div>
      </div>
    )
  }

  if (element.type === 'drawing') {
    return (
      <div className="d-flex flex-column gap-2">
        <div>
          <label className="form-label small fw-bold">선 색상</label>
          <input type="color" className="form-control form-control-sm form-control-color" value={element.stroke}
            onChange={e => onChange({ ...element, stroke: e.target.value })} />
        </div>
        <div>
          <label className="form-label small fw-bold">선 두께</label>
          <input type="number" className="form-control form-control-sm" value={element.strokeWidth}
            onChange={e => onChange({ ...element, strokeWidth: Math.max(1, +e.target.value) })} />
        </div>
      </div>
    )
  }

  return <div className="text-muted small">속성 없음</div>
}
