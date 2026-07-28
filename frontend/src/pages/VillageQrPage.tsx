import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import QRCode from 'qrcode'

const COUNTDOWN = 600

const pages = [
  { label: '마을 메인', path: '/village' },
  { label: '활동 목록', path: '/village/events' },
  { label: '마을 관리', path: '/village/admin' },
  { label: '내 바람', path: '/village/my-wishes' },
]

export default function VillageQrPage() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const didQrCanvasRef = useRef<HTMLCanvasElement>(null)
  const [selectedPage, setSelectedPage] = useState(pages[0].path)
  const [qrLoaded, setQrLoaded] = useState(false)
  const [qrError, setQrError] = useState('')
  const [countdown, setCountdown] = useState(COUNTDOWN)
  const [mode, setMode] = useState<'invite' | 'signup' | 'did'>('invite')

  const [didSessionId, setDidSessionId] = useState('')
  const [didQrLoaded, setDidQrLoaded] = useState(false)
  const [didQrError, setDidQrError] = useState('')
  const [didExpiresIn, setDidExpiresIn] = useState(0)
  const [didCountdown, setDidCountdown] = useState(0)
  const [creatingDidQr, setCreatingDidQr] = useState(false)

  const managed = user?.managed_pages ?? []
  const hasAccess = managed.some((p: string) => p === 'village' || p.startsWith('vi_'))

  const baseUrl = window.location.origin

  const renderQr = async (url: string, canvas: HTMLCanvasElement, colorDark: string) => {
    try {
      await QRCode.toCanvas(canvas, url, {
        width: 256, margin: 2,
        color: { dark: colorDark, light: '#ffffff' },
      })
      return true
    } catch {
      return false
    }
  }

  const generatePageQr = async () => {
    setQrLoaded(false)
    setQrError('')
    const url = `${baseUrl}${selectedPage}`
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const ok = await renderQr(url, canvas, '#198754')
    if (ok) setQrLoaded(true)
    else setQrError('QR 코드 생성 실패')
  }

  const generateSignupQr = async () => {
    setQrLoaded(false)
    setQrError('')
    const url = `${baseUrl}/register`
    const canvas = qrCanvasRef.current
    if (!canvas) return
    const ok = await renderQr(url, canvas, '#6f42c1')
    if (ok) setQrLoaded(true)
    else setQrError('QR 코드 생성 실패')
  }

  const generateDidQr = async (sessionId: string) => {
    setDidQrLoaded(false)
    setDidQrError('')
    const url = `${baseUrl}/did/claim?session=${sessionId}`
    const canvas = didQrCanvasRef.current
    if (!canvas) return
    const ok = await renderQr(url, canvas, '#0d6efd')
    if (ok) setDidQrLoaded(true)
    else setDidQrError('QR 코드 생성 실패')
  }

  const createDidQr = async () => {
    setCreatingDidQr(true)
    setDidQrError('')
    setDidSessionId('')
    try {
      const r = await fetch('/api/did/qr-session', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const d = await r.json()
      if (d.sessionId) {
        setDidSessionId(d.sessionId)
        setDidExpiresIn(d.expiresIn || 180)
        setDidCountdown(d.expiresIn || 180)
        setTimeout(() => generateDidQr(d.sessionId), 100)
      } else { setDidQrError(d.error || '세션 생성 실패') }
    } catch { setDidQrError('세션 생성 실패') }
    finally { setCreatingDidQr(false) }
  }

  useEffect(() => {
    if (authLoading || !hasAccess) return
    if (mode === 'invite') generatePageQr()
  }, [selectedPage, authLoading, mode])

  useEffect(() => {
    if (authLoading || !hasAccess || mode !== 'invite') return
    generatePageQr()
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { generatePageQr(); return COUNTDOWN }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [selectedPage, authLoading, mode])

  useEffect(() => {
    if (authLoading || !hasAccess || mode !== 'signup') return
    setCountdown(COUNTDOWN)
    generateSignupQr()
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { generateSignupQr(); return COUNTDOWN }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [authLoading, mode])

  useEffect(() => {
    if (didCountdown <= 0 || mode !== 'did') return
    const timer = setInterval(() => {
      setDidCountdown(prev => {
        if (prev <= 1) { createDidQr(); return didExpiresIn }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [didCountdown, mode, didExpiresIn])

  const fmt = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (authLoading) return <Loading />
  if (!hasAccess) return <ErrorMessage message="접근 권한이 없습니다." />

  return (
    <div style={{ maxWidth: 500, margin: '0 auto' }}>
      <div className="card border-0 shadow-sm p-4 text-center" style={{ borderRadius: 16 }}>
        <h4 className="fw-bold mb-3">QR / VC 발급</h4>

        <div className="d-flex gap-2 justify-content-center mb-3 flex-wrap">
          <button className={`btn btn-sm ${mode === 'invite' ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => { setMode('invite'); setCountdown(COUNTDOWN) }}>📱 초대 QR</button>
          <button className={`btn btn-sm ${mode === 'signup' ? 'btn-primary' : 'btn-outline-primary'}`}
            onClick={() => { setMode('signup'); setCountdown(COUNTDOWN) }}>📝 회원가입 QR</button>
          <button className={`btn btn-sm ${mode === 'did' ? 'btn-info' : 'btn-outline-info'}`}
            onClick={() => setMode('did')}>🆔 VC 발급</button>
        </div>

        {mode === 'invite' && (
          <>
            <div className="mb-3">
              <label className="small fw-bold mb-1">페이지 선택</label>
              <select className="form-select" value={selectedPage} onChange={e => { setSelectedPage(e.target.value); setCountdown(COUNTDOWN) }}>
                {pages.map(p => <option key={p.path} value={p.path}>{p.label}</option>)}
              </select>
            </div>
            <div className="mb-3 d-flex justify-content-center">
              <canvas ref={qrCanvasRef} width={256} height={256} style={{ borderRadius: 8 }} />
            </div>
            {qrError && <div className="alert alert-danger py-2 small">{qrError}</div>}
            {qrLoaded && (
              <div className="mb-2">
                <span className={`badge fs-6 ${countdown < 60 ? 'bg-danger' : 'bg-success'}`}>{fmt(countdown)}</span>
                <p className="small text-muted mt-1">QR 코드는 10분마다 자동 갱신됩니다.</p>
              </div>
            )}
            <button className="btn btn-sm btn-outline-success me-2" onClick={() => { setCountdown(COUNTDOWN); generatePageQr() }}>
              🔄 새로고침
            </button>
            <button className="btn btn-sm btn-outline-primary me-2" onClick={() => window.open(`/village/qr-display?url=${encodeURIComponent(`${baseUrl}${selectedPage}`)}`, '_blank')}>
              🖥️ 영상 모드
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/village')}>
              ← 마을
            </button>
          </>
        )}

        {mode === 'signup' && (
          <>
            <p className="small text-muted mb-3">비회원을 회원가입 페이지로 안내하는 QR 코드입니다.</p>
            <div className="mb-3 d-flex justify-content-center">
              <canvas ref={qrCanvasRef} width={256} height={256} style={{ borderRadius: 8 }} />
            </div>
            {qrError && <div className="alert alert-danger py-2 small">{qrError}</div>}
            {qrLoaded && (
              <div className="mb-2">
                <span className={`badge fs-6 ${countdown < 60 ? 'bg-danger' : 'bg-primary'}`}>{fmt(countdown)}</span>
                <p className="small text-muted mt-1">QR 코드는 10분마다 자동 갱신됩니다.</p>
              </div>
            )}
            <button className="btn btn-sm btn-outline-primary me-2" onClick={() => { setCountdown(COUNTDOWN); generateSignupQr() }}>
              🔄 새로고침
            </button>
            <button className="btn btn-sm btn-outline-primary me-2" onClick={() => window.open(`/village/qr-display?url=${encodeURIComponent(`${baseUrl}/register`)}&title=회원가입`, '_blank')}>
              🖥️ 영상 모드
            </button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/village')}>
              ← 마을
            </button>
          </>
        )}

        {mode === 'did' && (
          <>
            <p className="small text-muted mb-3">마을 주민에게 DID/VC를 발급합니다.<br />
              <small>주민이 QR을 스캔하면 마을지기 승인 후 발급됩니다.</small>
            </p>

            <div className="mb-4 p-3 border rounded" style={{ background: '#f8f9fa' }}>
              <h6 className="fw-bold mb-2">📲 QR로 VC 발급 신청</h6>
              <p className="small text-muted mb-2">주민이 QR을 스캔하면 승인 요청이 접수됩니다.</p>
              {!didSessionId ? (
                <button className="btn btn-primary btn-sm" onClick={createDidQr} disabled={creatingDidQr}>
                  {creatingDidQr ? '생성 중...' : '🆔 VC 발급 QR 생성'}
                </button>
              ) : (
                <>
                  <div className="d-flex justify-content-center mb-2">
                    <canvas ref={didQrCanvasRef} width={256} height={256} style={{ borderRadius: 8 }} />
                  </div>
                  {didQrError && <div className="alert alert-danger py-2 small">{didQrError}</div>}
                  {didQrLoaded && (
                    <div className="mb-2">
                      <span className={`badge fs-6 ${didCountdown < 30 ? 'bg-danger' : 'bg-info'}`}>{fmt(didCountdown)}</span>
                      <p className="small text-muted mt-1">3분 후 자동 갱신</p>
                    </div>
                  )}
                  <button className="btn btn-sm btn-outline-primary me-2" onClick={createDidQr}>🔄 새 QR</button>
                </>
              )}
            </div>

            <div className="d-flex gap-2 justify-content-center mb-2">
              <button className="btn btn-outline-info btn-sm" onClick={() => navigate('/village/qr-approvals')}>
                📋 승인 대기 목록
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}