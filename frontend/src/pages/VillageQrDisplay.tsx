import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'

export default function VillageQrDisplay() {
  const [searchParams] = useSearchParams()
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const [qrError, setQrError] = useState('')
  const [videoUrl, setVideoUrl] = useState(searchParams.get('video') || '')
  const [editUrl, setEditUrl] = useState(searchParams.get('video') || '')
  const [showEdit, setShowEdit] = useState(false)

  const targetUrl = searchParams.get('url') || window.location.origin + '/village'
  const title = searchParams.get('title') || 'QR 코드'

  useEffect(() => {
    const canvas = qrCanvasRef.current
    if (!canvas) return
    QRCode.toCanvas(canvas, targetUrl, {
      width: 400, margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => setQrError('QR 생성 실패'))
  }, [targetUrl])

  const applyVideo = () => {
    setVideoUrl(editUrl)
    setShowEdit(false)
  }

  const embedUrl = videoUrl
    ? videoUrl.includes('youtube.com/watch?v=')
      ? videoUrl.replace('youtube.com/watch?v=', 'youtube.com/embed/')
      : videoUrl.includes('youtu.be/')
        ? videoUrl.replace('youtu.be/', 'youtube.com/embed/')
        : videoUrl
    : ''

  return (
    <div style={{
      position: 'fixed', inset: 0, overflow: 'hidden',
      background: '#000', color: '#fff',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        display: 'flex', gap: 40, alignItems: 'center', justifyContent: 'center',
        flexWrap: 'wrap', padding: 20, maxWidth: '90vw',
      }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: 20, fontSize: 28 }}>{title}</h2>
          <div style={{ background: '#fff', padding: 16, borderRadius: 16, display: 'inline-block' }}>
            <canvas ref={qrCanvasRef} width={400} height={400} style={{ borderRadius: 8 }} />
            {qrError && <p style={{ color: '#f00', marginTop: 8 }}>{qrError}</p>}
          </div>
        </div>

        {embedUrl && (
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ marginBottom: 20, fontSize: 28 }}>홍보 영상</h2>
            <div style={{
              width: 480, maxWidth: '80vw', aspectRatio: '16/9',
              borderRadius: 16, overflow: 'hidden', background: '#111',
            }}>
              <iframe src={embedUrl} width="100%" height="100%" style={{ border: 0 }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>
        )}
      </div>

      <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 1000 }}>
        {!showEdit ? (
          <button onClick={() => setShowEdit(true)}
            style={{ padding: '8px 16px', borderRadius: 8, background: '#333', color: '#fff', border: 'none', cursor: 'pointer' }}>
            ⚙️ 영상 설정
          </button>
        ) : (
          <div style={{ background: '#222', padding: 16, borderRadius: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={editUrl} onChange={e => setEditUrl(e.target.value)}
              placeholder="YouTube URL 입력"
              style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #555', background: '#333', color: '#fff', width: 280 }} />
            <button onClick={applyVideo}
              style={{ padding: '6px 12px', borderRadius: 6, background: '#0d6efd', color: '#fff', border: 'none', cursor: 'pointer' }}>적용</button>
            <button onClick={() => setShowEdit(false)}
              style={{ padding: '6px 12px', borderRadius: 6, background: '#444', color: '#fff', border: 'none', cursor: 'pointer' }}>닫기</button>
          </div>
        )}
      </div>
    </div>
  )
}