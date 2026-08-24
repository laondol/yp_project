import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

type RampStatus = { open: boolean; volunteer_open: boolean; all_closed: boolean; waiting: number }

export default function ServiceRampPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [status, setStatus] = useState<RampStatus>({ open: true, volunteer_open: true, all_closed: false, waiting: 0 })
  const [statusLoading, setStatusLoading] = useState(true)

  const [vName, setVName] = useState('')
  const [vEmail, setVEmail] = useState(user?.email || '')
  const [vPhone, setVPhone] = useState('')
  const [vError, setVError] = useState('')
  const [vLoading, setVLoading] = useState(false)
  const [vSuccess, setVSuccess] = useState(false)

  const isLeader = !!user && user.role === 'leader'

  useEffect(() => {
    fetch('/service/ramp/apply-status', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setStatus({
        open: !!d.open,
        volunteer_open: !!d.volunteer_open,
        all_closed: !!d.all_closed,
        waiting: d.waiting || 0,
      }))
      .catch(() => {})
      .finally(() => setStatusLoading(false))
  }, [])

  const toggleApply = async (section: 'ramp' | 'volunteer') => {
    if (!isLeader) return
    const open = section === 'ramp' ? !status.open : !status.volunteer_open
    try {
      const res = await fetch('/admin/ramp/apply-toggle', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section, open }),
      })
      const d = await res.json()
      if (typeof d.open === 'boolean') {
        setStatus({
          open: !!d.open,
          volunteer_open: !!d.volunteer_open,
          all_closed: !!d.all_closed,
          waiting: d.waiting || 0,
        })
      }
    } catch { /* noop */ }
  }

  const renderToggle = (isOpen: boolean, section: 'ramp' | 'volunteer') => {
    if (!isLeader) return null
    return (
      <button
        type="button"
        className={'btn btn-sm ' + (isOpen ? 'btn-outline-success' : 'btn-outline-danger')}
        onClick={() => toggleApply(section)}
        title="클릭하여 신청 받기/안받기 전환"
      >
        {statusLoading ? '…' : (isOpen ? '✅ 신청 가능' : '⛔ 신청 마감')}
      </button>
    )
  }

  const handleVolunteer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!status.volunteer_open) return
    if (!vName || !vEmail) { setVError('이름과 이메일을 입력해주세요.'); return }
    setVError(''); setVLoading(true)
    try {
      const res = await fetch('/service/ramp/volunteer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: vName, email: vEmail, phone: vPhone }),
      })
      const data = await res.json()
      if (!res.ok) { setVError(data.error || data.msg || '신청 실패'); return }
      setVSuccess(true)
    } catch { setVError('서버 연결 실패') }
    finally { setVLoading(false) }
  }

  return (
    <div className="py-3">
      <div className="card border-0 shadow-sm mb-4 text-center" style={{ borderRadius: 16, background: 'linear-gradient(135deg, #198754, #20c997)' }}>
        <div className="card-body p-5 text-white">
          <div style={{ fontSize: 48 }}>♿</div>
          <h3 className="fw-bold mt-2">함께사는양평 휠체어 경사로</h3>
          <p className="mb-0 small opacity-75">장애인과 노약자, 모든 이웃이 편리하게 다닐 수 있는 양평을 만듭니다.</p>
        </div>
      </div>

      {status.all_closed && (
        <div className="alert alert-warning text-center fw-bold mb-4">🚫 신청 마감</div>
      )}

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-2">📊 현재까지 경사로 설치 현황</h5>
          <div className="row text-center g-2 mt-2">
            <div className="col-4">
              <div className="p-2 bg-light rounded">
                <div className="fw-bold" style={{ color: '#198754', fontSize: 24 }}>{status.waiting}</div>
                <div className="small text-muted">신청 대기</div>
              </div>
            </div>
            <div className="col-4">
              <div className="p-2 bg-light rounded">
                <div className="fw-bold" style={{ color: '#198754', fontSize: 24 }}>0</div>
                <div className="small text-muted">설치 완료</div>
              </div>
            </div>
            <div className="col-4">
              <div className="p-2 bg-light rounded">
                <div className="fw-bold" style={{ color: '#198754', fontSize: 24 }}>0</div>
                <div className="small text-muted">자원봉사자</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-2">🔧 경사로 설치 안내</h5>
          <ol className="small mb-0 text-muted" style={{ lineHeight: 2 }}>
            <li>경사로가 필요한 장소를 사진과 함께 신청해주세요.</li>
            <li>현장 확인 후 맞춤형 경사로를 제작합니다.</li>
            <li>자원봉사자와 함께 설치를 진행합니다.</li>
            <li>설치 후 정기적인 점검을 통해 안전을 유지합니다.</li>
          </ol>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <h5 className="fw-bold mb-2">🎬 설치 영상</h5>
          <div className="bg-light d-flex align-items-center justify-content-center rounded" style={{ height: 200 }}>
            <span className="text-muted small">▶ 경사로 설치 영상 (준비 중)</span>
          </div>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="fw-bold mb-0">📝 경사로 설치 신청</h5>
            {renderToggle(status.open, 'ramp')}
          </div>
          {!status.open && (
            <div className="alert alert-secondary py-2 small mb-3">현재 경사로 설치 신청을 받지 않고 있습니다. (신청 마감)</div>
          )}
          <form method="POST" action="/service/ramp/apply" encType="multipart/form-data">
            <div className="mb-2">
              <input type="text" name="name" className="form-control" placeholder="이름" required defaultValue={user?.real_name || ''} disabled={!status.open} />
            </div>
            <div className="mb-2">
              <input type="email" name="email" className="form-control" placeholder="이메일" required defaultValue={user?.email || ''} disabled={!status.open} />
            </div>
            <div className="mb-2">
              <input type="tel" name="phone" className="form-control" placeholder="연락처" disabled={!status.open} />
            </div>
            <div className="mb-2">
              <input type="text" name="location" className="form-control" placeholder="설치 희망 장소 (예: 양평군 oo면)" required disabled={!status.open} />
            </div>
            <div className="mb-2">
              <input type="text" name="step_height" className="form-control" placeholder="계단 높이 (예: 20cm)" disabled={!status.open} />
            </div>
            <div className="mb-2">
              <select name="ownership" className="form-select" required defaultValue="" disabled={!status.open}>
                <option value="" disabled>소유 구분 선택</option>
                <option value="본인소유">본인소유</option>
                <option value="임대/기타">임대/기타</option>
              </select>
            </div>
            <div className="mb-2">
              <label className="form-label small mb-1">현장 사진 (선택)</label>
              <input type="file" name="photo" className="form-control" accept="image/*" disabled={!status.open} />
            </div>
            <div className="form-check mb-2">
              <input className="form-check-input" type="checkbox" name="agree_removal" id="agree_removal_in" disabled={!status.open} />
              <label className="form-check-label small" htmlFor="agree_removal_in">설치 시 기존 구조물 철거에 동의합니다.</label>
            </div>
            <div className="form-check mb-2">
              <input className="form-check-input" type="checkbox" name="agree_damage" id="agree_damage_in" disabled={!status.open} />
              <label className="form-check-label small" htmlFor="agree_damage_in">시공 중 발생할 수 있는 손상에 동의합니다.</label>
            </div>
            <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={!status.open}>경사로 설치 신청하기</button>
          </form>
        </div>
      </div>

      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h5 className="fw-bold mb-0">🙋 자원봉사 신청</h5>
            {renderToggle(status.volunteer_open, 'volunteer')}
          </div>
          {!status.volunteer_open && (
            <div className="alert alert-secondary py-2 small mb-3">현재 자원봉사 신청을 받지 않고 있습니다. (신청 마감)</div>
          )}
          {vSuccess ? (
            <div className="alert alert-success py-2 small">자원봉사 신청이 완료되었습니다. 감사합니다!</div>
          ) : (
            <form onSubmit={handleVolunteer}>
              {vError && <div className="alert alert-danger py-2 small">{vError}</div>}
              <div className="mb-2">
                <input type="text" className="form-control" placeholder="이름" value={vName} onChange={e => setVName(e.target.value)} required disabled={!status.volunteer_open} />
              </div>
              <div className="mb-2">
                <input type="email" className="form-control" placeholder="이메일" value={vEmail} onChange={e => setVEmail(e.target.value)} required disabled={!status.volunteer_open} />
              </div>
              <div className="mb-3">
                <input type="tel" className="form-control" placeholder="연락처" value={vPhone} onChange={e => setVPhone(e.target.value)} disabled={!status.volunteer_open} />
              </div>
              <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={vLoading || !status.volunteer_open}>
                {vLoading ? '신청 중...' : '자원봉사 신청하기'}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="text-center">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/intro')}>← 인트로</button>
      </div>
    </div>
  )
}
