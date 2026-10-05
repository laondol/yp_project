import { useRef, useState, useEffect } from 'react'
import QRCode from 'qrcode'

interface Props {
  onClose: () => void
  title: string
  category: string
  date: string
  contentText: string
  url: string
  allowComments: boolean
  onToggleComments: () => void
}

export default function SharePreviewModal({
  onClose, title, category, date, contentText, url, allowComments, onToggleComments,
}: Props) {
  const qrRef = useRef<HTMLCanvasElement>(null)
  const [hint, setHint] = useState('')

  const isIOS = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isMobile = typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent)
  const canWebShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const encUrl = encodeURIComponent(url)
  const encText = encodeURIComponent(`${title} ${url}`)

  useEffect(() => {
    if (url && qrRef.current) {
      QRCode.toCanvas(qrRef.current, url, {
        width: 176, margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [url])

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setHint('링크를 복사했습니다.')
    } catch {
      prompt('링크 복사', url)
    }
  }
  const openWin = (u: string) => window.open(u, '_blank', 'noopener,noreferrer')
  const smsShare = () => {
    window.location.href = isIOS ? `sms:&body=${encText}` : `sms:?body=${encText}`
  }
  const fbShare = () => openWin(`https://www.facebook.com/sharer/sharer.php?u=${encUrl}`)
  const xShare = () => openWin(`https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encUrl}`)
  const lineShare = () => openWin(`https://social-plugins.line.me/lineit/share?url=${encUrl}`)
  const mailShare = () => { window.location.href = `mailto:?subject=${encodeURIComponent(title)}&body=${encText}` }
  const nativeShare = () => {
    if (!canWebShare) return
    navigator.share({ title, url }).catch(() => {})
  }
  const saveQr = () => {
    if (!qrRef.current) return
    const a = document.createElement('a')
    a.href = qrRef.current.toDataURL()
    a.download = 'note-qr.png'
    a.click()
    setHint('QR코드 이미지를 저장했습니다.')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1060, overflow: 'auto' }}
      onClick={onClose}>
      <div className="bg-white mx-auto my-4 p-4" style={{ maxWidth: 640, borderRadius: 16, zIndex: 1061 }}
        onClick={e => e.stopPropagation()}>

        <div className="d-flex justify-content-between align-items-center mb-3">
          <b>📤 공유하기</b>
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>✕ 닫기</button>
        </div>

        {/* 공유 미리보기 카드 */}
        <div className="mb-3" style={{ border: '1px solid #dee2e6', borderRadius: 12, padding: 16, background: '#fbfcfd' }}>
          <div className="mb-1 d-flex align-items-center gap-2 flex-wrap">
            {category && <span className="badge bg-light text-dark border">{category}</span>}
            <div className="btn-group" role="group" aria-label="댓글 허용 설정">
              <button type="button"
                className={`btn btn-sm ${allowComments ? 'btn-success' : 'btn-outline-secondary'}`}
                onClick={() => { if (!allowComments) onToggleComments() }}>댓글가능</button>
              <button type="button"
                className={`btn btn-sm ${!allowComments ? 'btn-secondary' : 'btn-outline-secondary'}`}
                onClick={() => { if (allowComments) onToggleComments() }}>댓글불가</button>
            </div>
            <small className="text-muted">{date}</small>
          </div>
          <div className="fw-bold mb-1" style={{ fontSize: 17 }}>{title}</div>
          <div className="text-muted small mb-2" style={{
            display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            lineHeight: 1.6,
          }}>{contentText}</div>
          <div className="small text-break" style={{ color: '#0d6efd' }}>🔗 {url}</div>
        </div>

        <div className="d-flex gap-3 align-items-center mb-3 flex-wrap">
          <canvas ref={qrRef} className="border rounded" />
          <div className="small text-muted" style={{ maxWidth: 320 }}>
            QR코드를 인쇄하거나 이미지로 저장해 오프라인에서도 공유할 수 있습니다.
            <div className="mt-2">
              <button className="btn btn-sm btn-outline-success" onClick={saveQr}>💾 QR 이미지 저장</button>
            </div>
          </div>
        </div>

        {hint && <div className="alert alert-info py-2 small mb-3">{hint}</div>}

        <div className="d-flex gap-2 flex-wrap">
          <button className="btn btn-outline-primary fw-bold" onClick={copyLink}>🔗 링크 복사</button>
          {isMobile && (
            <button className="btn btn-outline-secondary" onClick={smsShare}>💬 문자</button>
          )}
          <button className="btn btn-outline-secondary" onClick={fbShare}>📘 페이스북</button>
          <button className="btn btn-outline-secondary" onClick={xShare}>𝕏 트위터(X)</button>
          <button className="btn btn-outline-secondary" onClick={lineShare}>🟢 라인</button>
          <button className="btn btn-outline-secondary" onClick={mailShare}>✉️ 이메일</button>
          {canWebShare && (
            <button className="btn btn-outline-success fw-bold" onClick={nativeShare}>📲 휴대폰으로 공유</button>
          )}
        </div>

        {!canWebShare && (
          <div className="small text-muted mt-3">
            인스타그램·카카오톡은 링크를 복사해 앱에 붙여넣으세요. (휴대폰에서는 '📲 휴대폰으로 공유'로 앱 목록이 열립니다)
          </div>
        )}
      </div>
    </div>
  )
}
