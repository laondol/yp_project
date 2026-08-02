import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hashPassword } from '../lib/password'

export default function LoginPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { refresh } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [showUpgrade, setShowUpgrade] = useState(false)
  const [upgradePw, setUpgradePw] = useState('')
  const [upgradePw2, setUpgradePw2] = useState('')
  const [upgradeShow, setUpgradeShow] = useState(false)
  const [upgradeMsg, setUpgradeMsg] = useState('')
  const [upgradeError, setUpgradeError] = useState('')
  const [upgrading, setUpgrading] = useState(false)

  const [linkEmail, setLinkEmail] = useState('')
  const [linkSent, setLinkSent] = useState(false)
  const [linkLoading, setLinkLoading] = useState(false)
  const [debugUrl, setDebugUrl] = useState('')
  const [showLinkBox, setShowLinkBox] = useState(false)

  const doRedirect = () => {
    // 로그인 응답의 intro_page_enabled를 사용합니다.
    // 1) 작업 중이던 페이지가 있으면(next) 그 페이지로
    // 2) 없으면 회원정보 페이지에서 인트로로 지정한 곳으로 (지정=회원정보, 미지정=인트로)
    const loggedInUserId = (window as any).__yp_user_id__;
    const introOn = (window as any).__yp_intro_on__ === true;
    const next = searchParams.get('next')
      || (introOn && loggedInUserId ? `/user/${loggedInUserId}` : '/intro');
    navigate(next)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      // 1차 시도: 클라이언트 해시만 전송 (평문은 DevTools에 노출 안 됨)
      const password_hash = await hashPassword(password)
      let res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password_hash }),
        credentials: 'include',
      })
      let data = await res.json()

      // 레거시(평문 저장) 계정 → 평문으로 재시도 (기존 동작 유지)
      if (data.needs_plaintext) {
        res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
          credentials: 'include',
        })
        data = await res.json()
      }

      if (!res.ok) {
        setError(data.error || data.msg || '로그인 실패')
        return
      }

      // 전역 상태를 새 회원 정보로 갱신합니다.
      await refresh()

      if (data.unread_count > 0) {
        alert(`📨 읽지 않은 편지가 ${data.unread_count}통 있습니다.`)
      }

      ;(window as any).__yp_user_id__ = data.user?.id
      ;(window as any).__yp_intro_on__ = data.user?.intro_page_enabled === true

      // 레거시 계정이면 전환 안내 모달 (거절하면 그대로 진행)
      if (data.user?.password_v2 === false) {
        setShowUpgrade(true)
        return
      }

      doRedirect()
    } catch {
      setError('서버 연결에 실패했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleUpgrade = async () => {
    if (upgradePw.length < 8) { setUpgradeError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (upgradePw !== upgradePw2) { setUpgradeError('비밀번호가 일치하지 않습니다.'); return }
    setUpgradeError(''); setUpgrading(true); setUpgradeMsg('')
    try {
      const password_hash = await hashPassword(upgradePw)
      const res = await fetch('/api/auth/upgrade-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password_hash }),
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { setUpgradeError(data.msg || '전환 실패'); return }
      setUpgradeMsg('더 안전한 로그인 방식으로 전환되었습니다.')
      ;(window as any).__yp_user_id__ = undefined
      ;(window as any).__yp_intro_on__ = undefined
      await refresh()
      setTimeout(() => {
        setShowUpgrade(false)
        doRedirect()
      }, 1200)
    } catch { setUpgradeError('서버 연결 실패') }
    finally { setUpgrading(false) }
  }

  const handleSendLink = async () => {
    if (!linkEmail) { setError('이메일을 입력해주세요.'); return }
    setError(''); setLinkLoading(true); setDebugUrl('')
    try {
      const fd = new FormData(); fd.append('email', linkEmail)
      const next = searchParams.get('next')
      if (next) fd.append('next', next)
      const res = await fetch('/login/send-link', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (data.status === 'error') { setError(data.msg || '전송 실패'); return }
      setLinkSent(true)
      if (data.debug_url) setDebugUrl(data.debug_url)
    } catch { setError('서버 연결 실패') }
    finally { setLinkLoading(false) }
  }

  return (
    <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '70vh' }}>
      <div className="card border-0 shadow-sm" style={{ maxWidth: 420, width: '100%', borderRadius: 16 }}>
        <div className="card-body p-4">
          <h4 className="fw-bold text-center mb-1 text-success">함께사는양평 로그인</h4>
          <p className="text-muted text-center small mb-4">양평의 맑은 소통에 참여하세요.</p>

          <div className="alert alert-success text-center py-2 small mb-3" role="alert">
            🔐 <strong>보안 강화 안내</strong><br />
            기존 회원님께서는 더 안전한 로그인을 위해<br />
            <strong>새 비밀번호 설정이 필요</strong>할 수 있습니다.
          </div>

          {error && <div className="alert alert-danger text-center py-2 small">{error}</div>}

          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <input type="text" className="form-control form-control-lg bg-light border-0"
                value={username} onChange={e => setUsername(e.target.value)}
                placeholder="이메일" required />
            </div>
            <div className="mb-4">
              <input type="password" className="form-control form-control-lg bg-light border-0"
                value={password} onChange={e => setPassword(e.target.value)}
                placeholder="비밀번호" required />
            </div>
            <button type="submit" className="btn btn-success w-100 py-3 fw-bold" disabled={loading}
              style={{ borderRadius: 12 }}>
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <div className="text-center mt-3">
            <Link to="/reset-password" className="text-muted small text-decoration-none d-block mb-1">비밀번호 찾기</Link>
            <span className="text-muted small">아직 회원이 아니신가요? </span>
            <Link to="/register" className="text-success fw-bold small text-decoration-none">회원 가입하기</Link>
            <div className="mt-1">
              <Link to="/terms" className="text-muted small text-decoration-none">회원약관 및 닢 규칙</Link>
            </div>
          </div>

          <hr className="my-3" />
          <div className="text-center">
            <button className="btn btn-sm btn-outline-success w-100" type="button" onClick={() => setShowLinkBox(!showLinkBox)}>
              이메일 링크로 로그인
            </button>
            {showLinkBox && (
              <div className="mt-2">
                {!linkSent ? (
                  <>
                    <input type="email" className="form-control form-control-sm mb-2" placeholder="이메일 주소"
                      value={linkEmail} onChange={e => setLinkEmail(e.target.value)} />
                    <button className="btn btn-sm btn-success w-100" onClick={handleSendLink} disabled={linkLoading}>
                      {linkLoading ? '전송 중...' : '로그인 링크 보내기'}
                    </button>
                  </>
                ) : (
                  <div className="alert alert-info py-2 small mb-0 text-start">
                    [{linkEmail}]로 로그인 링크를 발송했습니다.<br />
                    이메일을 확인하고 링크를 클릭해 주세요.<br />
                    이메일이 안보이면 스팸(정크)메일함도 확인 부탁드립니다.
                    {debugUrl && (
                      <div className="mt-2">
                        <a href={debugUrl} className="fw-bold">[DEV] 로그인 링크로 바로 가기</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {showUpgrade && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
          style={{ background: 'rgba(0,0,0,0.5)', zIndex: 5000 }}>
          <div className="card border-0 shadow-lg" style={{ maxWidth: 440, width: '100%', borderRadius: 16 }}>
            <div className="card-body p-4">
              <h5 className="fw-bold mb-1 text-success">🔐 더 안전한 로그인 방식</h5>
              <p className="small text-muted mb-3">
                함께사는양평이 로그인 보안을 강화했습니다.<br />
                새 비밀번호를 설정하면 비밀번호가 네트워크에 전송되는 것을 막아 더 안전하게 로그인할 수 있습니다.
              </p>
              {upgradeMsg && <div className="alert alert-success py-2 small">{upgradeMsg}</div>}
              {upgradeError && <div className="alert alert-danger py-2 small">{upgradeError}</div>}
              {!upgradeMsg && (
                <>
                  <div className="input-group mb-2">
                    <input type={upgradeShow ? 'text' : 'password'} className="form-control" placeholder="새 비밀번호 (8자 이상)"
                      value={upgradePw} onChange={e => setUpgradePw(e.target.value)} />
                    <button type="button" className="btn btn-outline-secondary" tabIndex={-1}
                      onClick={() => setUpgradeShow(s => !s)} title={upgradeShow ? '비밀번호 숨기기' : '비밀번호 보기'}>
                      {upgradeShow ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <input type="password" className="form-control mb-3" placeholder="새 비밀번호 확인"
                    value={upgradePw2} onChange={e => setUpgradePw2(e.target.value)} />
                  <button className="btn btn-success w-100 mb-2 fw-bold" onClick={handleUpgrade} disabled={upgrading}>
                    {upgrading ? '전환 중...' : '전환하기'}
                  </button>
                </>
              )}
              {!upgradeMsg && (
                <button className="btn btn-outline-secondary w-100 btn-sm" onClick={() => { setShowUpgrade(false); doRedirect() }}>
                  다음에 하기
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
