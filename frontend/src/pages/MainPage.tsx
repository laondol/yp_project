import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'

export default function MainPage() {
  const navigate = useNavigate()
  const contentEditorRef = useRef<ContentEditorHandle>(null)
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [countdown, setCountdown] = useState(0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const content = contentEditorRef.current?.getContent()?.trim() || ''
    if (!title.trim() || !content || content === '<br>' || submitting) return
    setSubmitting(true)

    const loc = contentEditorRef.current?.getLocation() || { lat: '', lng: '', addr: '' }

    const fd = new FormData()
    fd.append('title', title.trim())
    fd.append('content', content)
    if (loc.lat) fd.append('latitude', loc.lat)
    if (loc.lng) fd.append('longitude', loc.lng)
    if (loc.addr.trim()) fd.append('address', loc.addr.trim())
    const drawingData = contentEditorRef.current?.getDrawingData()
    if (drawingData && drawingData.length > 2000) fd.append('drawing_data', drawingData)

    let success = false
    try {
      const res = await fetch('/submit', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (data.status === 'success' || data.id) {
        success = true
      } else {
        alert(data.msg || '오류 발생')
        setSubmitting(false)
        return
      }
    } catch {
      alert('서버 연결 실패')
      setSubmitting(false)
      return
    }

    if (!success) return
    setCountdown(10)
    const iv = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(iv)
          navigate('/all-proposals')
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  if (countdown > 0) {
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
        background: 'rgba(255,255,255,0.98)', zIndex: 9999,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      }}>
        <div style={{
          padding: 50, border: '3px solid #27ae60', borderRadius: 30,
          background: 'white', boxShadow: '0 15px 50px rgba(0,0,0,0.15)',
          textAlign: 'center',
        }}>
          <h2 style={{ color: '#27ae60', marginBottom: 15 }}>🌳 정상적으로 등록되었습니다.</h2>
          <p style={{ color: '#666', marginBottom: 20 }}>
            소중한 양평 자치 제안 기록소로 이동합니다.
          </p>
          <div className="spinner-grow text-success" role="status" style={{ width: '3rem', height: '3rem' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="py-3">
      <h3 className="fw-bold mb-4 text-center">💭 꿈꾸기</h3>
      <p className="text-muted text-center mb-4 small">
        양평을 위해 꾸는 꿈 그 꿈이 양평의 미래입니다. 
      </p>

      <form onSubmit={handleSubmit}>
        <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 18 }}>
          <div className="card-body p-4">
            <div className="mb-3">
              <label className="form-label fw-bold small">제목</label>
              <input
                type="text"
                className="form-control"
                placeholder="제목을 입력해 주세요"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                style={{ borderRadius: 12, padding: 12 }}
              />
            </div>

            <ContentEditor
              ref={contentEditorRef}
              placeholder="우리 공동체를 위한 소중한 제안을 적어주세요. (사진은 Ctrl+V로 붙여넣기 가능)"
            />

            <button
              type="submit"
              className="btn btn-success w-100 py-3 fw-bold"
              style={{ borderRadius: 12, fontSize: '1.1rem' }}
              disabled={submitting || !title.trim()}
            >
              {submitting ? '등록 중...' : '제안 제출하기'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}