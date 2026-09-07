import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function EditProfilePage() {
  const navigate = useNavigate()
  const [realName, setRealName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [officeAddress, setOfficeAddress] = useState('')
  const [userId, setUserId] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [isNeighbor, setIsNeighbor] = useState(false)
  const [isResident, setIsResident] = useState(false)
  const [town, setTown] = useState('')
  const [village, setVillage] = useState('')
  const [neighborLoading, setNeighborLoading] = useState(false)
  const [neighborMsg, setNeighborMsg] = useState('')
  const [neighborMsgOk, setNeighborMsgOk] = useState(false)
  const [showHomeModal, setShowHomeModal] = useState(false)
  const [pendingCoords, setPendingCoords] = useState<{lat: number; lon: number} | null>(null)

  const [pwStep, setPwStep] = useState(1)
  const [pwCode, setPwCode] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwNew2, setPwNew2] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwMsgOk, setPwMsgOk] = useState(false)
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => {
    fetch('/api/user/edit-profile')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error === 'login' ? '로그인이 필요합니다.' : d.error); return }
        setRealName(d.real_name || '')
        setEmail(d.email || '')
        setPhone(d.phone || '')
        setHomeAddress(d.home_address || '')
        setOfficeAddress(d.office_address || '')
        setUserId(d.id)
        setIsNeighbor(d.is_neighbor || false)
        setIsResident(d.is_verified_resident || false)
        setTown(d.town || '')
        setVillage(d.village || '')
      })
      .catch(() => setError('데이터를 불러오지 못했습니다.'))
  }, [])

  const handleSave = async () => {
    if (!email) { setError('이메일은 필수입니다.'); return }
    setError(''); setLoading(true)
    try {
      const fd = new FormData()
      fd.append('real_name', realName)
      fd.append('email', email)
      fd.append('phone', phone)
      fd.append('home_address', homeAddress)
      fd.append('office_address', officeAddress)
      const res = await fetch('/api/user/edit-profile', { method: 'POST', body: fd })
      const d = await res.json()
      if (d.status === 'success') {
        alert(d.msg)
        navigate(d.redirect || `/user/${userId}`)
      } else {
        setError(d.msg || '오류가 발생했습니다.')
      }
    } catch {
      setError('오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyNeighbor = () => {
    if (!navigator.geolocation) { setNeighborMsg('GPS를 지원하지 않는 브라우저입니다.'); setNeighborMsgOk(false); return }
    setNeighborLoading(true); setNeighborMsg('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPendingCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setShowHomeModal(true)
        setNeighborLoading(false)
      },
      () => { setNeighborMsg('위치 정보를 가져올 수 없습니다.'); setNeighborMsgOk(false); setNeighborLoading(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const submitVerifyNeighbor = async (isHome: boolean) => {
    if (!pendingCoords) return
    setNeighborLoading(true)
    setShowHomeModal(false)
    try {
      const res = await fetch('/user/verify-neighbor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: pendingCoords.lat, lon: pendingCoords.lon, is_home: isHome })
      })
      const d = await res.json()
      if (d.status === 'success') {
        setIsNeighbor(true)
        if (d.town) { setTown(d.town); setVillage(d.village || '') }
        if (d.is_resident) {
          setIsResident(true)
          setNeighborMsg('주민 인증이 완료되었습니다! 🏠 동네 소식을 더 빨리 받아보실 수 있습니다.')
        } else if (d.home_match) {
          setIsResident(true)
          setNeighborMsg('집 주소 확인! 주민 인증이 완료되었습니다! 🏠')
        } else if (d.home_set) {
          setNeighborMsg('이웃인증 완료! 🏘️ 주민이 되려면 집 주소에서 인증해 주세요. 주민이 되면 동네 소식을 더 빨리 받으실 수 있습니다.')
        } else if (isHome) {
          setNeighborMsg('집 주소가 설정되었습니다! 다시 인증하면 주민이 됩니다.')
        } else {
          setNeighborMsg('이웃인증 완료! 🏘️ 주민이 되려면 집 주소에서 인증해 주세요. 주민이 되면 동네 소식을 더 빨리 받으실 수 있습니다.')
        }
        setNeighborMsgOk(true)
      } else {
        setNeighborMsg(d.msg || '인증 실패')
        setNeighborMsgOk(false)
      }
    } catch {
      setNeighborMsg('인증 요청 중 오류가 발생했습니다.')
      setNeighborMsgOk(false)
    } finally { setNeighborLoading(false); setPendingCoords(null) }
  }

  const handleSendCode = async () => {
    setPwLoading(true)
    try {
      const res = await fetch('/api/user/change-password/send-code', { method: 'POST' })
      const d = await res.json()
      if (d.status === 'success') {
        setPwStep(2)
        setPwMsg(d.msg)
        setPwMsgOk(true)
      } else {
        setPwMsg(d.msg || '오류가 발생했습니다.')
        setPwMsgOk(false)
      }
    } catch {
      setPwMsg('오류가 발생했습니다.')
      setPwMsgOk(false)
    } finally {
      setPwLoading(false)
    }
  }

  const handleChangePw = async () => {
    if (!pwCode) { setPwMsg('인증번호를 입력하세요.'); setPwMsgOk(false); return }
    if (!pwNew || pwNew.length < 4) { setPwMsg('비밀번호는 4자 이상이어야 합니다.'); setPwMsgOk(false); return }
    if (pwNew !== pwNew2) { setPwMsg('비밀번호가 일치하지 않습니다.'); setPwMsgOk(false); return }
    setPwLoading(true)
    try {
      const res = await fetch('/api/user/change-password/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pwCode, password: pwNew }),
      })
      const d = await res.json()
      if (d.status === 'success') {
        setPwMsg(d.msg)
        setPwMsgOk(true)
        setTimeout(() => { if (userId) navigate(`/user/${userId}`) }, 1500)
      } else {
        setPwMsg(d.msg || '오류가 발생했습니다.')
        setPwMsgOk(false)
      }
    } catch {
      setPwMsg('오류가 발생했습니다.')
      setPwMsgOk(false)
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <div className="container py-4" style={{ maxWidth: 500 }}>
      <div className="card border-0 shadow-sm" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          <h4 className="fw-bold mb-4">회원정보 수정</h4>
          {error && <div className="alert alert-danger py-2 small">{error}</div>}
          <div className="mb-3">
            <label className="form-label small fw-bold">이름 (실명)</label>
            <input type="text" value={realName} onChange={e => setRealName(e.target.value)} className="form-control" placeholder="이름" />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">이메일</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="form-control" placeholder="이메일" required />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">전화번호</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="form-control" placeholder="010-1234-5678" />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">집 주소</label>
            <input type="text" value={homeAddress} onChange={e => setHomeAddress(e.target.value)} className="form-control" placeholder="양평군 ..." />
          </div>
          <div className="mb-3">
            <label className="form-label small fw-bold">회사 주소</label>
            <input type="text" value={officeAddress} onChange={e => setOfficeAddress(e.target.value)} className="form-control" placeholder="근무지 주소" />
          </div>
          <button type="button" className="btn btn-success w-100 py-2 fw-bold" onClick={handleSave} disabled={loading}>
            {loading ? '저장 중...' : '저장'}
          </button>
          <div className="text-center mt-3">
            {userId && (
              <button type="button" className="btn btn-sm btn-link text-muted text-decoration-none" onClick={() => navigate(`/user/${userId}`)}>
                &larr; 돌아가기
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm mt-4" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-2">이웃인증</h5>
          <p className="text-muted small mb-3">양평군내 GPS 위치인증을 통해 이웃이 됩니다.</p>
          {isNeighbor && (
            <div className="mb-2">
              <span className="badge bg-success">✅ 이웃인증 완료</span>
              {isResident && <span className="badge bg-primary ms-1">🏠 주민</span>}
              {town && <span className="text-muted small ms-2">{town} {village}</span>}
            </div>
          )}
          {neighborMsg && <div className={`small mb-2 ${neighborMsgOk ? 'text-success' : 'text-danger'}`}>{neighborMsg}</div>}
          {!isNeighbor ? (
            <button type="button" className="btn btn-success w-100 py-2 fw-bold" onClick={handleVerifyNeighbor} disabled={neighborLoading}>
              {neighborLoading ? '인증 중...' : '📍 이웃인증하기'}
            </button>
          ) : (
            <button type="button" className="btn btn-outline-success w-100 py-2 fw-bold" onClick={handleVerifyNeighbor} disabled={neighborLoading}>
              {neighborLoading ? '인증 중...' : '🔄 이웃인증 갱신'}
            </button>
          )}
        </div>
      </div>

      {showHomeModal && (
        <div className="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center" style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="bg-white rounded-4 p-4 mx-3" style={{ maxWidth: 380, width: '100%' }}>
            <h5 className="fw-bold mb-3">이 위치가 집인가요?</h5>
            <p className="text-muted small mb-3">집으로 설정하면 주민 인증을 받습니다.</p>
            <div className="d-flex gap-2">
              <button className="btn btn-success flex-fill fw-bold" onClick={() => submitVerifyNeighbor(true)}>
                🏠 예, 집입니다
              </button>
              <button className="btn btn-outline-secondary flex-fill fw-bold" onClick={() => submitVerifyNeighbor(false)}>
                🏘️ 아니요, 이웃만
              </button>
            </div>
            <button className="btn btn-link text-muted w-100 mt-2" onClick={() => { setShowHomeModal(false); setPendingCoords(null) }}>취소</button>
          </div>
        </div>
      )}

      <div className="card border-0 shadow-sm mt-4" style={{ borderRadius: 18 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-3">비밀번호 변경</h5>
          <p className="text-muted small mb-3">이메일 인증 후 현재 비밀번호 없이 변경 가능합니다.</p>
          {pwStep === 1 && (
            <button type="button" className="btn btn-outline-success w-100 py-2 fw-bold" onClick={handleSendCode} disabled={pwLoading}>
              {pwLoading ? '발송 중...' : '인증번호 발송'}
            </button>
          )}
          {pwStep === 2 && (
            <>
              {pwMsg && pwMsgOk && <div className="mb-2"><small className="text-muted">{pwMsg}</small></div>}
              <div className="mb-3">
                <input type="text" className="form-control" value={pwCode} onChange={e => setPwCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 인증번호" maxLength={6} inputMode="numeric" />
              </div>
              <div className="mb-3">
                <input type="password" className="form-control" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="새 비밀번호 (4자 이상)" minLength={4} />
              </div>
              <div className="mb-3">
                <input type="password" className="form-control" value={pwNew2} onChange={e => setPwNew2(e.target.value)} placeholder="새 비밀번호 확인" minLength={4} />
              </div>
              <button type="button" className="btn btn-success w-100 py-2 fw-bold" onClick={handleChangePw} disabled={pwLoading}>
                {pwLoading ? '변경 중...' : '비밀번호 변경'}
              </button>
              {pwMsg && !pwMsgOk && <div className="small mt-2 text-danger">{pwMsg}</div>}
              {pwMsg && pwMsgOk && <div className="small mt-2 text-success">{pwMsg}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}