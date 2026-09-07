import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) { setError('이메일을 입력해주세요.'); return }
    setError(''); setMessage(''); setLoading(true)
    try {
      const res = await fetch('/reset-password/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || data.msg || '전송 실패'); return }
      setMessage('인증번호가 이메일로 발송되었습니다. 받은 인증번호를 입력하세요.')
      setStep('code')
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code || code.length !== 6) { setError('인증번호 6자리를 입력해주세요.'); return }
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (password !== confirm) { setError('비밀번호가 일치하지 않습니다.'); return }
    setError(''); setMessage(''); setLoading(true)
    try {
      const { hashPassword } = await import('../lib/password')
      const password_hash = await hashPassword(password)
      const res = await fetch('/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, password_hash }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || data.msg || '실패'); return }
      if (data.auto_login) {
        setMessage('비밀번호가 변경되었습니다. 자동 로그인됩니다.')
        setTimeout(() => navigate('/'), 1000)
      } else {
        setMessage('비밀번호가 변경되었습니다. 로그인 페이지로 이동합니다.')
        setTimeout(() => navigate('/login'), 1000)
      }
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '70vh' }}>
      <div className="card border-0 shadow-sm" style={{ maxWidth: 420, width: '100%', borderRadius: 16 }}>
        <div className="card-body p-4">
          <h4 className="fw-bold text-center mb-1" style={{ color: '#198754' }}>비밀번호 재설정</h4>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          {message && <div className="alert alert-success py-2 small">{message}</div>}

          {step === 'email' && (
            <>
              <p className="text-muted text-center small mb-3">가입한 이메일을 입력하면 인증번호를 보내드립니다.</p>
              <form onSubmit={handleSendCode}>
                <div className="mb-3">
                  <label className="form-label small fw-bold">이메일</label>
                  <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="가입한 이메일 주소" required autoFocus />
                </div>
                <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={loading}>
                  {loading ? '전송 중...' : '인증번호 받기'}
                </button>
              </form>
            </>
          )}

          {step === 'code' && (
            <>
              <p className="text-muted text-center small mb-3">이메일로 받은 인증번호와 새 비밀번호를 입력하세요.</p>
              <form onSubmit={handleConfirm}>
                <div className="mb-3">
                  <label className="form-label small fw-bold">인증번호 (6자리)</label>
                  <input type="text" className="form-control" value={code} onChange={e => setCode(e.target.value)} placeholder="이메일로 받은 인증번호" maxLength={6} required autoFocus inputMode="numeric" pattern="[0-9]*" />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">새 비밀번호</label>
                  <input type="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} placeholder="8자 이상" minLength={8} required />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-bold">비밀번호 확인</label>
                  <input type="password" className="form-control" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="다시 입력" required />
                </div>
                <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={loading}>
                  {loading ? '처리 중...' : '비밀번호 변경'}
                </button>
              </form>
            </>
          )}

          <div className="text-center mt-3">
            <Link to="/login" className="text-decoration-none text-muted small">← 로그인으로</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
