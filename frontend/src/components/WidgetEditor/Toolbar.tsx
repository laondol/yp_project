import { useRef } from 'react'

interface Props {
  isDrawingMode: boolean
  isTextTypingMode: boolean
  onToggleDrawingMode: () => void
  onToggleTextTypingMode: () => void
  onAddText: () => void
  onAddImage: (src: string) => void
  onAddRect: () => void
  onAddCircle: () => void
  onAddTriangle: () => void
  onDelete: () => void
  hasSelection: boolean
  onExportPNG: () => void
  onExportHTML5: () => void
  onExportRTF: () => void
  onSave: () => void
}

export default function Toolbar({
  isDrawingMode, isTextTypingMode, onToggleDrawingMode, onToggleTextTypingMode,
  onAddText, onAddImage, onAddRect, onAddCircle, onAddTriangle,
  onDelete, hasSelection,
  onExportPNG, onExportHTML5, onExportRTF, onSave,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const src = ev.target?.result as string
        onAddImage(src)
      }
      reader.readAsDataURL(file)
    })
    e.target.value = ''
  }

  return (
    <div className="d-flex align-items-center gap-1 flex-wrap p-2 border-bottom bg-white" style={{ fontSize: '0.85rem' }}>
      <input ref={fileInputRef} type="file" accept="image/*,.heic,.heif,.svg" style={{ display: 'none' }} onChange={handleFileChange} />

      <div className="btn-group btn-group-sm me-2">
        <button className={`btn ${!isDrawingMode && !isTextTypingMode ? 'btn-primary' : 'btn-outline-secondary'}`}
          onClick={onToggleDrawingMode} title="선택 모드 (Esc)">
          ↖ 선택
        </button>
        <button className={`btn ${isDrawingMode ? 'btn-danger' : 'btn-outline-secondary'}`}
          onClick={onToggleDrawingMode} title="자유 드로잉 모드">
          ✎ 그리기
        </button>
        <button className={`btn ${isTextTypingMode ? 'btn-success' : 'btn-outline-secondary'}`}
          onClick={onToggleTextTypingMode} title="텍스트 타이핑 모드 (클릭 후 바로 입력)">
          T 타이핑
        </button>
      </div>

      <div className="vr mx-1" />

      <div className="btn-group btn-group-sm me-2">
        <button className="btn btn-outline-secondary" onClick={onAddText} title="텍스트 박스 추가">T 박스</button>
        <button className="btn btn-outline-secondary" onClick={() => fileInputRef.current?.click()} title="이미지 불러오기">🖼 이미지</button>
      </div>

      <div className="vr mx-1" />

      <div className="btn-group btn-group-sm me-2">
        <button className="btn btn-outline-secondary" onClick={onAddRect} title="사각형">□</button>
        <button className="btn btn-outline-secondary" onClick={onAddCircle} title="원">○</button>
        <button className="btn btn-outline-secondary" onClick={onAddTriangle} title="삼각형">△</button>
      </div>

      {hasSelection && (
        <button className="btn btn-sm btn-outline-danger" onClick={onDelete} title="삭제">🗑</button>
      )}

      <div className="ms-auto d-flex gap-1">
        <button className="btn btn-sm btn-outline-success" onClick={onExportPNG} title="PNG 저장">📷 PNG</button>
        <button className="btn btn-sm btn-outline-info" onClick={onExportHTML5} title="HTML5 저장">🌐 HTML5</button>
        <button className="btn btn-sm btn-outline-warning" onClick={onExportRTF} title="RTF 저장">📄 RTF</button>
        <button className="btn btn-sm btn-primary" onClick={onSave} title="JSON 저장">💾 저장</button>
      </div>
    </div>
  )
}