import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const FULL_TERMS = `
<h5 class="fw-bold">제1장 총칙</h5>
<hr />
<h6 class="fw-bold mt-3">제1조 (목적)</h6>
<p>본 약관은 함께사는양평(이하 "서비스")이 제공하는 온라인 커뮤니티 서비스의 이용 조건 및 절차, 회원과 운영진의 권리·의무·책임을 규정함을 목적으로 합니다.</p>
<h6 class="fw-bold mt-3">제2조 (용어의 정의)</h6>
<ol>
  <li><strong>"회원"</strong>이란 본 약관에 동의하고 서비스에 가입하여 서비스를 이용하는 자를 말합니다.</li>
  <li><strong>"관리자(admin)"</strong>란 서비스의 전반적인 운영 및 관리를 담당하는 자를 말합니다.</li>
  <li><strong>"책임자(leader)"</strong>란 권역별 커뮤니티 운영 책임을 맡은 자를 말합니다.</li>
  <li><strong>"활동가(activist)"</strong>란 같은 리(里) 주민과 소통하며 커뮤니티 활동을 촉진하는 자를 말합니다.</li>
  <li><strong>"벗"</strong>이란 회원 간 승인된 친구 관계를 말합니다.</li>
  <li><strong>"닢"</strong>이란 서비스 내에서 사용되는 가상 포인트를 말합니다.</li>
</ol>
<h6 class="fw-bold mt-3">제3조 (약관의 게시 및 개정)</h6>
<p>본 약관은 서비스 가입 화면에 게시되며, 운영위원회의 의결을 거쳐 개정될 수 있습니다. 개정 시 최소 7일 전 공지사항을 통해 고지합니다.</p>

<h5 class="fw-bold mt-4">제2장 회원 가입 및 관리</h5>
<hr />
<h6 class="fw-bold mt-3">제4조 (가입 자격)</h6>
<p>양평에 대해 관심이 있고 함께하는 양평의 회원약관과 운영규칙을 잘 준수할 수 있는 누구나 가입할 수 있습니다.</p>
<h6 class="fw-bold mt-3">제5조 (주민 인증 및 활동 범위)</h6>
<ol>
  <li>GPS 위치 기반 인증 또는 고지서·지역화폐카드 사진 제출을 통해 리(里) 단위 주민 인증을 받을 수 있습니다.</li>
  <li><strong>리 단위 인증을 완료한 회원</strong>은 오프라인 모임 참여, 마을 의사결정 투표, 활동가 보증 등 대면 활동이 가능합니다.</li>
  <li><strong>리 단위 인증을 하지 않은 회원</strong>은 온라인 활동(게시글, 댓글, 공유 등)만 가능합니다.</li>
</ol>
<h6 class="fw-bold mt-3">제6조 (회원 탈퇴 및 자격 상실)</h6>
<ol>
  <li>회원은 언제든지 탈퇴를 요청할 수 있습니다.</li>
  <li>타인 정보 도용, 법령 위반, 타 회원 피해, AI 지킴이 연속 3회 이상 게시불가 판정 시 자격이 제한될 수 있습니다.</li>
</ol>
<h6 class="fw-bold mt-3">제7조 (벗 관계)</h6>
<ol>
  <li>회원은 다른 회원에게 벗 신청을 할 수 있으며, 상대방이 수락하면 벗 관계가 성립됩니다.</li>
  <li>벗 관계 해지는 일방의 요청으로 가능합니다.</li>
  <li>벗 관계인 회원 간에만 쪽지 발송이 가능합니다(관리자, 책임자, 활동가 제외).</li>
</ol>

<h5 class="fw-bold mt-4">제3장 닢</h5>
<hr />
<h6 class="fw-bold mt-3">제8조 (닢 지급)</h6>
<table class="table table-bordered small">
  <thead class="table-light"><tr><th>구분</th><th>지급액</th><th>비고</th></tr></thead>
  <tbody>
    <tr><td>회원 가입</td><td class="text-success fw-bold">+1,000닢</td><td>최초 1회</td></tr>
    <tr><td>30일 주기 지급</td><td class="text-success fw-bold">+1,000닢</td><td>매 30일마다 로그인 시 자동 지급</td></tr>
  </tbody>
</table>
<h6 class="fw-bold mt-3">제9조 (닢 차감)</h6>
<table class="table table-bordered small">
  <thead class="table-light"><tr><th>항목</th><th>차감액</th><th>비고</th></tr></thead>
  <tbody>
    <tr><td>게시글 등록</td><td class="text-danger fw-bold">-100닢</td><td>누구의꿈 등록 시</td></tr>
    <tr><td>댓글 작성</td><td class="text-danger fw-bold">-10닢</td><td>게시글/뉴스 댓글 포함</td></tr>
    <tr><td>쪽지 발송</td><td class="text-danger fw-bold">-10닢</td><td>1통당</td></tr>
    <tr><td>좋아요/나빠요</td><td class="text-danger fw-bold">-5닢</td><td>게시물당 1회만 가능</td></tr>
  </tbody>
</table>

<h5 class="fw-bold mt-4">제4장 AI 지킴이 콘텐츠 심사</h5>
<hr />
<h6 class="fw-bold mt-3">제12조 (AI 심사 원칙)</h6>
<ol>
  <li>모든 콘텐츠는 등록 즉시 AI 지킴이가 분석하여 점수(-50~50)를 부여합니다.</li>
  <li>게시불가(-50점 이하) 판정을 받은 게시글은 30일 이내 수정하여 재심사 가능하며, 수정 시 100닢 차감됩니다.</li>
  <li>AI 심사 결과에 이의가 있는 경우 관리자 또는 책임자에게 토론을 요청할 수 있습니다.</li>
</ol>

<h5 class="fw-bold mt-4">제5장 위치 기반 서비스</h5>
<hr />
<h6 class="fw-bold mt-3">제14조 (위치 정보)</h6>
<ol>
  <li>회원의 위치 정보는 서비스 내에서만 사용되며, 회원의 동의 없이 외부에 제공되지 않습니다.</li>
  <li>위치 정보는 양평군 내에서만 갱신 가능합니다.</li>
  <li>회원은 언제든지 위치 공유를 해제할 수 있습니다.</li>
</ol>

<h5 class="fw-bold mt-4">제6장 분쟁 해결 및 중재</h5>
<hr />
<h6 class="fw-bold mt-3">제15조 (중재위원회)</h6>
<ol>
  <li>회원 간의 모든 분쟁은 내부 중재위원회의 조정 규칙을 따라야 합니다.</li>
  <li>중재 결과에 이의가 있는 회원은 별도 법적 절차를 진행할 수 있습니다.</li>
</ol>
<h6 class="fw-bold mt-3">제16조 (면책 조항)</h6>
<ol>
  <li>서비스는 천재지변, 시스템 장애 등 불가항력적 사유로 인한 서비스 중단에 대해 책임을 지지 않습니다.</li>
  <li>회원 간의 분쟁으로 인한 손해에 대해 서비스는 책임을 지지 않습니다.</li>
</ol>
`

export default function RegisterPage() {
  const navigate = useNavigate()

  const [termsConfirmed, setTermsConfirmed] = useState(false)
  const [email, setEmail] = useState('')
  const [emailVerified, setEmailVerified] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [code, setCode] = useState('')
  const [codeChecking, setCodeChecking] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [showPwConfirm, setShowPwConfirm] = useState(false)
  const [realName, setRealName] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [officeAddress, setOfficeAddress] = useState('')
  const [lat, setLat] = useState<number | null>(null)
  const [lon, setLon] = useState<number | null>(null)
  const [town, setTown] = useState('')
  const [village, setVillage] = useState('')
  const [neighborChecked, setNeighborChecked] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/auth/register/status', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        if (d.verified && d.email) {
          setEmail(d.email)
          setEmailVerified(true)
          setTermsConfirmed(true)
        }
      })
      .catch(() => {})

    return () => {
      fetch('/api/auth/register/cancel', { method: 'POST', credentials: 'include' }).catch(() => {})
    }
  }, [])

  const handleSendCode = async () => {
    if (!email) { setError('이메일을 입력해주세요.'); return }
    setError(''); setLoading(true)
    try {
      const fd = new FormData()
      fd.append('email', email)
      fd.append('purpose', 'register')
      const res = await fetch('/register/send-code', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (data.status === 'error') { setError(data.msg || '인증 코드 전송 실패'); return }
      setCodeSent(true)
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }

  const handleVerifyCode = async () => {
    if (!code || code.length !== 6) { setError('6자리 인증 코드를 입력해주세요.'); return }
    setError(''); setCodeChecking(true)
    try {
      const fd = new FormData()
      fd.append('code', code)
      const res = await fetch('/register/verify-code', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (data.status === 'error') { setError(data.msg || '인증 실패'); return }
      setEmailVerified(true)
    } catch { setError('서버 연결 실패') }
    finally { setCodeChecking(false) }
  }

  const handleCurrentLocation = (target: 'home' | 'office') => {
    if (!navigator.geolocation) { setError('GPS를 지원하지 않는 브라우저입니다.'); return }
    setError('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        setLat(latitude); setLon(longitude)
        try {
          const geo = await fetch(`/api/reverse-geocode-detail?lat=${latitude}&lon=${longitude}`)
          const geoData = await geo.json()
          const addr = geoData.address || `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
          const t = geoData.town || ''
          const v = geoData.village || ''
          if (target === 'home') {
            setHomeAddress(addr)
            setTown(t); setVillage(v)
            const nb = await fetch(`/api/check-neighbor?lat=${latitude}&lon=${longitude}`)
            const nbData = await nb.json()
            if (nbData.in_yangpyeong) {
              setNeighborChecked(true)
              if (!t) { setTown(nbData.town || ''); setVillage(nbData.village || '') }
            }
          } else {
            setOfficeAddress(addr)
          }
        } catch { setError('주소 확인 실패') }
      },
      () => { setError('GPS 권한이 필요합니다. 브라우저 설정을 확인해주세요.') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleNeighborCheck = () => {
    if (!navigator.geolocation) { setError('GPS를 지원하지 않는 브라우저입니다.'); return }
    setError('')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const latitude = pos.coords.latitude
        const longitude = pos.coords.longitude
        setLat(latitude); setLon(longitude)
        try {
          const nb = await fetch(`/api/check-neighbor?lat=${latitude}&lon=${longitude}`)
          const nbData = await nb.json()
          if (!nbData.in_yangpyeong) {
            setError('양평군 내에서만 이웃인증이 가능합니다.')
            return
          }
          setTown(nbData.town || ''); setVillage(nbData.village || '')
          const geo = await fetch(`/api/reverse-geocode-detail?lat=${latitude}&lon=${longitude}`)
          const geoData = await geo.json()
          const gpsAddr = geoData.address || ''
          if (homeAddress && homeAddress !== gpsAddr) {
            if (confirm('집주소를 현재 위치로 변경하시겠습니까?')) {
              setHomeAddress(gpsAddr)
            }
          } else if (!homeAddress) {
            setHomeAddress(gpsAddr)
          }
          setNeighborChecked(true)
        } catch { setError('이웃인증 확인 실패') }
      },
      () => { setError('GPS 권한이 필요합니다. 브라우저 설정을 확인해주세요.') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const handleSubmit = async () => {
    if (!emailVerified) { setError('이메일 인증을 먼저 완료해 주세요.'); return }
    if (!password || password !== passwordConfirm || password.length < 8) {
      setError('비밀번호를 8자 이상 입력하고 일치시켜 주세요.'); return
    }
    setError(''); setLoading(true)
    try {
      const fd = new FormData()
      const { hashPassword } = await import('../lib/password')
      fd.append('password_hash', await hashPassword(password))
      fd.append('real_name', realName)
      if (homeAddress) fd.append('home_address', homeAddress)
      if (officeAddress) fd.append('office_address', officeAddress)
      if (lat !== null) fd.append('lat', String(lat))
      if (lon !== null) fd.append('lon', String(lon))
      if (town) fd.append('town', town)
      if (village) fd.append('village', village)
      fd.append('is_neighbor', neighborChecked ? '1' : '0')
      const res = await fetch('/api/auth/register', { method: 'POST', body: fd, credentials: 'include' })
      const data = await res.json()
      if (!res.ok || data.status === 'error') { setError(data.error || data.msg || '회원가입 실패'); return }
      alert('회원가입이 완료되었습니다.')
      navigate('/login')
    } catch { setError('서버 연결 실패') }
    finally { setLoading(false) }
  }

  return (
    <div className="d-flex justify-content-center" style={{ minHeight: '70vh' }}>
      <div className="card border-0 shadow-sm" style={{ maxWidth: 520, width: '100%', borderRadius: 16 }}>
        <div className="card-body p-4">
          <h4 className="fw-bold text-center mb-3" style={{ color: '#198754' }}>회원가입</h4>

          {error && <div className="alert alert-danger py-2 small">{error}</div>}

          {/* 약관 전문 (처음부터 펼쳐짐) */}
          <div className="card border mb-2" style={{ maxHeight: 350, overflowY: 'auto', fontSize: '0.8rem' }}>
            <div className="card-body p-3" dangerouslySetInnerHTML={{ __html: FULL_TERMS }} />
            <div className="card-footer text-center bg-white border-0 pt-0">
              {!termsConfirmed ? (
                <button type="button" className="btn btn-success px-4" onClick={() => setTermsConfirmed(true)}>
                  확인했습니다
                </button>
              ) : (
                <div className="text-success fw-bold small py-1">✅ 약관에 동의했습니다</div>
              )}
            </div>
          </div>

          {/* 체크박스 */}
          <div className="form-check mb-3">
            <input
              type="checkbox"
              className="form-check-input"
              id="agreeTerms"
              checked={termsConfirmed}
              readOnly
              onClick={() => {
                if (!termsConfirmed) {
                  alert('전문을 보시고 확인을 누르셔야 체크가 가능합니다.')
                }
              }}
            />
            <label className="form-check-label small" htmlFor="agreeTerms">
              약관 및 닢 규칙에 동의합니다 (필수)
            </label>
          </div>

          {/* 이메일 (약관 동의 후 활성화) */}
          {termsConfirmed && !emailVerified && (
            <div className="mb-3">
              <label className="form-label small fw-bold">이메일</label>
              <div className="input-group">
                <input
                  type="email"
                  className="form-control"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="example@email.com"
                  disabled={codeSent}
                  required
                />
                <button className="btn btn-success" onClick={handleSendCode} disabled={loading || codeSent}>
                  {loading ? '전송 중...' : codeSent ? '전송 완료' : '인증 코드 받기'}
                </button>
              </div>
              {codeSent && (
                <div className="mt-2">
                  <div className="input-group">
                    <input
                      type="text"
                      className="form-control"
                      value={code}
                      onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="6자리 코드 입력"
                      maxLength={6}
                      style={{ letterSpacing: 6, textAlign: 'center', fontWeight: 'bold' }}
                    />
                    <button className="btn btn-outline-success" onClick={handleVerifyCode} disabled={codeChecking || code.length !== 6}>
                      {codeChecking ? '확인 중...' : '인증 확인'}
                    </button>
                  </div>
                  <div className="text-muted small mt-1">
                    [{email}]로 인증 코드를 발송했습니다. 메일함을 확인해 주세요.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 이메일 인증 완료 */}
          {emailVerified && (
            <div className="alert alert-success py-2 small mb-3">
              ✅ 이메일 인증 완료: <strong>{email}</strong>
            </div>
          )}

          {/* 이메일 인증 후 폼 */}
          {emailVerified && (
            <>
              {/* 비밀번호 */}
              <div className="mb-3">
                <label className="form-label small fw-bold">비밀번호</label>
                <div className="input-group mb-2">
                  <input
                    type={showPw ? 'text' : 'password'}
                    className="form-control"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="8자 이상 입력"
                    minLength={8}
                    required
                  />
                  <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPw(!showPw)}>
                    {showPw ? '🙈' : '👁️'}
                  </button>
                </div>
                <div className="input-group">
                  <input
                    type={showPwConfirm ? 'text' : 'password'}
                    className="form-control"
                    value={passwordConfirm}
                    onChange={e => setPasswordConfirm(e.target.value)}
                    placeholder="비밀번호 다시 입력"
                    required
                  />
                  <button className="btn btn-outline-secondary" type="button" onClick={() => setShowPwConfirm(!showPwConfirm)}>
                    {showPwConfirm ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              {/* 이름 */}
              <div className="mb-3">
                <label className="form-label small fw-bold">이름 (선택)</label>
                <input type="text" className="form-control" value={realName} onChange={e => setRealName(e.target.value)} placeholder="이름" />
              </div>

              {/* 집주소 */}
              <div className="mb-3">
                <label className="form-label small fw-bold">집주소 (선택)</label>
                <div className="input-group">
                  <input type="text" className="form-control" value={homeAddress} onChange={e => setHomeAddress(e.target.value)} placeholder="집주소" />
                  <button className="btn btn-outline-success" type="button" onClick={() => handleCurrentLocation('home')}>
                    📍 현재 위치 적용
                  </button>
                </div>
              </div>

              {/* 회사주소 */}
              <div className="mb-3">
                <label className="form-label small fw-bold">회사주소 (선택)</label>
                <div className="input-group">
                  <input type="text" className="form-control" value={officeAddress} onChange={e => setOfficeAddress(e.target.value)} placeholder="회사주소" />
                  <button className="btn btn-outline-success" type="button" onClick={() => handleCurrentLocation('office')}>
                    📍 현재 위치 적용
                  </button>
                </div>
              </div>

              {/* 이웃인증 */}
              <div className="mb-3">
                <label className="form-label small fw-bold">이웃인증</label>
                <button className="btn btn-success w-100 py-2 fw-bold mb-2" onClick={handleNeighborCheck} disabled={loading}>
                  {loading ? '인증 중...' : neighborChecked ? '✅ 이웃인증 완료' : '이웃인증'}
                </button>
                {neighborChecked && (town || village) && (
                  <div className="text-success small fw-bold">🏠 {town} {village}</div>
                )}
              </div>

              {/* 가입 완료 */}
              <button className="btn btn-success w-100 py-2 fw-bold" onClick={handleSubmit} disabled={loading}>
                {loading ? '가입 중...' : '🌳 회원가입 완료'}
              </button>
            </>
          )}

          <div className="text-center mt-3">
            <button className="btn btn-sm btn-link text-muted text-decoration-none" onClick={() => navigate('/login')}>로그인으로</button>
          </div>
        </div>
      </div>
    </div>
  )
}
