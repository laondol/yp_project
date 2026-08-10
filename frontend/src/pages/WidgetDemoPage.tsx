import { useState } from 'react'
import { WidgetEditor, type EditorSnapshot } from '../components/WidgetEditor'

export default function WidgetDemoPage() {
  const [saved, setSaved] = useState<{ json: EditorSnapshot; image: string } | null>(null)

  return (
    <div className="container-fluid py-3" style={{ height: '100vh' }}>
      <h5 className="mb-2">🎨 위젯 에디터</h5>
      <p className="text-muted small mb-2">
        선택/그리기 모드 전환, 도형/텍스트/이미지 추가, 드래그앤드롭 가능
      </p>
      <div style={{ height: 'calc(100vh - 120px)' }}>
        <WidgetEditor onSave={(json, image) => setSaved({ json, image })} />
      </div>
      {saved && (
        <div className="mt-3 p-3 border rounded bg-light">
          <h6>저장된 결과</h6>
          <pre className="small" style={{ maxHeight: 150, overflow: 'auto' }}>{JSON.stringify(saved.json, null, 2)}</pre>
          {saved.image && <img src={saved.image} alt="exported" style={{ maxWidth: 300, border: '1px solid #ccc', borderRadius: 4 }} />}
        </div>
      )}
    </div>
  )
}
