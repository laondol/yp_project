import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardAdminItem {
  id: string; db_id: number
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; reserve_url?: string; author_name?: string
  contact?: string
  event_date_display?: string
  apply_display?: string; apply_allday?: boolean
  repeat_text?: string; repeat_type?: string
  repeat_weekdays?: number; repeat_week_of_month?: number; repeat_weeks?: string; repeat_days?: string
  event_date_iso?: string; event_end_iso?: string; event_place?: string
  extra_schedules?: { id: number; display: string }[]
  is_approved: boolean; is_active: boolean
  created_at: string
}

interface YardOrgItem {
  id: number; name: string; url: string
  platform: string; is_active: boolean; created_at: string
}

export default function AdminYard() {
  const [items, setItems] = useState<YardAdminItem[]>([])
  const [orgs, setOrgs] = useState<YardOrgItem[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)

  const [orgName, setOrgName] = useState('')
  const [orgUrl, setOrgUrl] = useState('')
  const [orgMsg, setOrgMsg] = useState('')
  const [orgMsgOk, setOrgMsgOk] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/yard/admin').then(r => r.json()).catch(() => ({})),
      fetch('/api/yard/orgs').then(r => r.json()).catch(() => ({})),
    ])
      .then(([yardData, orgData]) => {
        setItems(yardData.items || [])
        setOrgs(orgData.orgs || [])
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // 독립 편집창 저장 시 목록 갱신
  useEffect(() => {
    const onMsg = (e: MessageEvent) => { if (e.data === 'yard-updated') load() }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const openCreate = () => {
    window.open('/yard/edit', 'yardEdit', 'width=620,height=900')
  }

  const openEdit = (it: YardAdminItem) => {
    window.open(`/yard/edit?id=${it.db_id}`, 'yardEdit', 'width=620,height=900')
  }

  // 링크로 추가하기: 페이지를 읽어 AI로 초안 생성 후 편집창 오픈
  const [impUrl, setImpUrl] = useState('')
  const [importing, setImporting] = useState(false)

  const handleImportLink = async () => {
    if (!impUrl.trim()) return
    setImporting(true)
    try {
      const res = await fetch('/api/yard/import-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: impUrl.trim() }),
      })
      const data = await res.json()
      setMsg(data.msg || ''); setMsgOk(data.status === 'success')
      if (data.status === 'success' && data.id) {
        setImpUrl('')
        load()
        window.open(`/yard/edit?id=${data.id}`, 'yardEdit', 'width=620,height=900')
      }
    } catch { setMsg('가져오기 오류'); setMsgOk(false) }
    setImporting(false)
  }

  // 🔁 반복일정 빠른 등록
  const [rTitle, setRTitle] = useState('')
  const [rAuthor, setRAuthor] = useState('')
  const [rPlace, setRPlace] = useState('')
  const [rType, setRType] = useState('')           // weekly | monthly_week | monthly_day | tbd
  const [rDays, setRDays] = useState<number[]>([]) // 요일 인덱스 (0=월)
  const [rWeeks, setRWeeks] = useState<number[]>([])  // 0=매주, 1~5=N째주 (다중 선택)
  const [rDates, setRDates] = useState('')         // 월별 날짜 "1,6"
  const [rStart, setRStart] = useState('')
  const [rEnd, setREnd] = useState('')
  const [rContact, setRContact] = useState('')
  const [rLink, setRLink] = useState('')
  const [rSaving, setRSaving] = useState(false)
  const [rMsg, setRMsg] = useState('')
  const [rMsgOk, setRMsgOk] = useState(false)

  const handleRepeatCreate = async () => {
    if (!rTitle.trim()) { alert('제목을 입력하세요.'); return }
    setRSaving(true)
    try {
      const weekdaysMask = rDays.reduce((m, i) => m | (1 << i), 0)
      const res = await fetch('/api/yard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: rTitle.trim(), author_name: rAuthor.trim(),
          event_place: rPlace.trim(), contact: rContact.trim(),
          source_url: rLink.trim(),
          repeat_type: rType, repeat_weekdays: weekdaysMask,
          repeat_weeks: rWeeks.join(','), repeat_week_of_month: rWeeks[0] || 0, repeat_days: rDates,
          repeat_start_time: rStart, repeat_end_time: rEnd,
          is_allday: !rStart,
        }),
      })
      const data = await res.json()
      setRMsg(data.msg || (data.status === 'success' ? '등록 완료' : '실패'))
      setRMsgOk(data.status === 'success')
      if (data.status === 'success') {
        setRTitle(''); setRAuthor(''); setRPlace(''); setRContact(''); setRLink('')
        load()
      }
    } catch { setRMsg('오류가 발생했습니다.'); setRMsgOk(false) }
    setRSaving(false)
  }

  const handleOrgCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/yard/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim(), url: orgUrl.trim() }),
      })
      const data = await res.json()
      setOrgMsg(data.msg || '등록'); setOrgMsgOk(data.status === 'success')
      if (data.status === 'success') { setOrgName(''); setOrgUrl(''); load() }
    } catch { setOrgMsg('오류'); setOrgMsgOk(false) }
  }

  const handleOrgDelete = async (orgId: number) => {
    if (!confirm('단체 등록을 삭제하시겠습니까? (자동수집이 중단됩니다)')) return
    const res = await fetch(`/api/yard/orgs/${orgId}`, { method: 'DELETE' })
    const data = await res.json()
    setOrgMsg(data.msg || ''); setOrgMsgOk(data.status === 'success')
    if (data.status === 'success') load()
  }

  const handleApprove = async (fid: string) => {
    try {
      const res = await fetch(`/api/yard/${fid}/approve`, { method: 'POST' })
      const data = await res.json()
      setMsg(data.msg || ''); setMsgOk(data.status === 'success')
      if (data.status === 'success') load()
    } catch { setMsg('승인 오류'); setMsgOk(false) }
  }

  const handleDelete = async (fid: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/yard/${fid}`, { method: 'DELETE' })
      const data = await res.json()
      setMsg(data.msg || '삭제'); setMsgOk(data.status === 'success')
      if (data.status === 'success') load()
    } catch { setMsg('삭제 오류'); setMsgOk(false) }
  }

  const pending = items.filter(i => !i.is_approved)
  const approved = items.filter(i => i.is_approved)

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">🌾 마당 관리</h3>

      {/* 단체 등록 (자동수집) */}
      <div className="card border-0 shadow-sm mb-4 p-4" style={{ borderRadius: 16, borderLeft: '4px solid #20c997' }}>
        <h6 className="fw-bold mb-2">🏢 자동수집 단체 등록</h6>
        <p className="small text-muted mb-2">
          네이버 블로그 주소를 등록하면 <strong>최신 글을 매일 자동으로 수집</strong>합니다 (승인 후 공개).
          페이스북·카카오·밴드는 자동수집이 불가하여 게시물 URL을 "직접 등록"으로 올려 주세요.
        </p>
        <form onSubmit={handleOrgCreate}>
          <div className="d-flex gap-2 mb-2 flex-wrap">
            <input className="form-control" style={{ maxWidth: 220 }} placeholder="단체명 (예: 두물붙농부시장)"
              value={orgName} onChange={e => setOrgName(e.target.value)} required />
            <input className="form-control" style={{ maxWidth: 320 }} placeholder="블로그 주소 (예: https://blog.naver.com/fromnature2019)"
              value={orgUrl} onChange={e => setOrgUrl(e.target.value)} required />
            <button type="submit" className="btn btn-success">➕ 단체 등록</button>
          </div>
          <span className={`small ${orgMsgOk ? 'text-success' : 'text-danger'}`}>{orgMsg}</span>
        </form>
        {orgs.length > 0 && (
          <div className="mt-2">
            {orgs.map(o => (
              <div key={o.id} className="d-flex justify-content-between align-items-center border rounded p-2 mb-1">
                <div className="small">
                  <strong>{o.name}</strong>
                  <span className={`badge ms-2 ${o.platform === 'naverblog' ? 'bg-success' : 'bg-secondary'}`}>
                    {o.platform === 'naverblog' ? '자동수집 ON' : '참고용 (자동수집 불가)'}
                  </span>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>{o.url}</div>
                </div>
                <button className="btn btn-sm btn-outline-danger" onClick={() => handleOrgDelete(o.id)}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 등록 버튼 */}
      <div className="card border-0 shadow-sm mb-4 p-3" style={{ borderRadius: 16 }}>
        <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <div>
            <h6 className="fw-bold mb-0">✏️ 소식 등록/편집</h6>
            <small className="text-muted">독립창에서 편집하며 원문 페이지를 나란히 열어두고 내용을 입력하세요.</small>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <div className="d-flex gap-1">
              <input type="url" className="form-control" style={{ width: 280 }} placeholder="링크로 추가 (블로그·카페·SNS 주소)"
                value={impUrl} onChange={e => setImpUrl(e.target.value)} />
              <button className="btn btn-outline-success text-nowrap" onClick={handleImportLink} disabled={importing || !impUrl.trim()}>
                {importing ? '⏳ 가져오는 중...' : '🔗 링크로 추가'}
              </button>
            </div>
            <button className="btn btn-success btn-lg px-4" onClick={openCreate}>✏️ 새 소식 등록</button>
          </div>
        </div>
        <span className={`small mt-1 d-block ${msgOk ? 'text-success' : 'text-danger'}`}>{msg}</span>
      </div>

      {/* 🔁 반복일정 빠른 등록 */}
      <div className="card border-0 shadow-sm mb-4 p-4" style={{ borderRadius: 16, borderLeft: '4px solid #20c997' }}>
        <h6 className="fw-bold mb-2">🔁 반복일정 빠른 등록</h6>
        <p className="small text-muted mb-2">매주·정기 반복되는 행사(정기장 등)를 등록합니다. 시간을 입력하지 않으면 종일로 표시됩니다.</p>
        <input className="form-control mb-2" placeholder="제목 (필수, 예: 양수리 정기장)"
          value={rTitle} onChange={e => setRTitle(e.target.value)} />
        <div className="d-flex gap-2 mb-2 flex-wrap">
          <input className="form-control" style={{ maxWidth: 200 }} placeholder="단체명/출처"
            value={rAuthor} onChange={e => setRAuthor(e.target.value)} />
          <input className="form-control" style={{ maxWidth: 240 }} placeholder="📍 장소"
            value={rPlace} onChange={e => setRPlace(e.target.value)} />
        </div>
        <select className="form-select form-select-sm mb-1" value={rType}
          onChange={e => setRType(e.target.value)}>
          <option value="">반복 유형 선택</option>
          <option value="weekly">🔁 매주 반복</option>
          <option value="monthly_week">🔁 매월 N째주 반복 (예: 첫째·셋째주 토요일)</option>
          <option value="monthly_day">🔁 매월 날짜 반복 (정기장: 1,6일 등)</option>
          <option value="tbd">⏳ 일시 미정</option>
        </select>
        {(rType === 'weekly' || rType === 'monthly_week') && (
          <div className="d-flex gap-1 flex-wrap mb-1">
            {['월', '화', '수', '목', '금', '토', '일'].map((d, i) => (
              <button type="button" key={d}
                className={`btn btn-sm ${rDays.includes(i) ? 'btn-success' : 'btn-outline-secondary'} py-0 px-2`}
                onClick={() => setRDays(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i])}>{d}</button>
            ))}
          </div>
        )}
        {rType === 'monthly_week' && (
          <div className="d-flex gap-1 flex-wrap mb-1">
            {['매주', '첫째주', '둘째주', '셋째주', '넷째주', '다섯째주'].map((wk, idx) => (
              <button type="button" key={wk}
                className={`btn btn-sm py-0 px-2 ${rWeeks.includes(idx) ? 'btn-success' : 'btn-outline-secondary'}`}
                onClick={() => setRWeeks(prev => prev.includes(idx) ? prev.filter(x => x !== idx) : [...prev, idx])}>{wk}</button>
            ))}
          </div>
        )}
        {rType === 'monthly_day' && (
          <div className="d-flex flex-wrap gap-1 mb-1">
            {Array.from({ length: 31 }, (_, i) => i + 1).map(d => {
              const selected = rDates.split(',').filter(Boolean).map(Number).includes(d)
              return (
                <button type="button" key={d}
                  className={`btn btn-sm py-0 px-1 ${selected ? 'btn-success' : 'btn-outline-secondary'}`}
                  style={{ width: 34, fontSize: '0.75rem' }}
                  onClick={() => {
                    const nums = new Set(rDates.split(',').filter(Boolean).map(Number))
                    if (nums.has(d)) nums.delete(d); else nums.add(d)
                    setRDates([...nums].sort((a, b) => a - b).join(','))
                  }}>{d}</button>
              )
            })}
          </div>
        )}
        {(rType === 'weekly' || rType === 'monthly_week' || rType === 'monthly_day') && (
          <div className="row g-2 mb-2" style={{ maxWidth: 420 }}>
            <div className="col-6">
              <label className="small text-muted mb-1">🕒 시작시간 (미입력 시 종일)</label>
              <input type="time" className="form-control form-control-sm" value={rStart}
                onChange={e => setRStart(e.target.value)} />
            </div>
            <div className="col-6">
              <label className="small text-muted mb-1">🕔 종료시간</label>
              <input type="time" className="form-control form-control-sm" value={rEnd}
                onChange={e => setREnd(e.target.value)} />
            </div>
          </div>
        )}
        {rType === 'tbd' && (
          <small className="text-muted d-block mb-2">날짜가 정해지면 목록의 ✏️ 수정으로 입력하세요.</small>
        )}
        <div className="d-flex gap-2 mb-2 flex-wrap">
          <input className="form-control" style={{ maxWidth: 240 }} placeholder="📞 연락처 (선택)"
            value={rContact} onChange={e => setRContact(e.target.value)} />
          <input type="url" className="form-control" style={{ maxWidth: 280 }} placeholder="🔗 링크 (선택)"
            value={rLink} onChange={e => setRLink(e.target.value)} />
        </div>
        <button className="btn btn-success" onClick={handleRepeatCreate} disabled={rSaving || !rTitle.trim() || !rType}>
          {rSaving ? '⏳ 등록 중...' : '✅ 반복일정 등록'}
        </button>
        <span className={`small mt-1 d-block ${rMsgOk ? 'text-success' : 'text-danger'}`}>{rMsg}</span>
      </div>

      {/* 승인 대기 */}
      <div className="card border-0 shadow-sm mb-4 p-3" style={{ borderRadius: 16, borderLeft: '4px solid #f0ad4e' }}>
        <h6 className="fw-bold mb-3">⏳ 승인 대기 (자동수집) <span className="badge bg-warning text-dark">{pending.length}</span></h6>
        {loading ? (
          <div className="text-center py-3 text-muted"><div className="spinner-border spinner-border-sm" /></div>
        ) : pending.length === 0 ? (
          <div className="text-center text-muted small py-2">승인 대기 중인 소식이 없습니다.</div>
        ) : (
          <div className="row g-3">
            {pending.map(p => (
              <div key={p.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
                  <div className="card-body p-3 d-flex flex-column">
                    <div className="small text-muted mb-1">#{p.db_id} · 수집 {formatKST(p.created_at, { month: '2-digit', day: '2-digit' })}</div>
                    {/* 제목 (맨위) */}
                    <h6 className="fw-bold mb-2">{p.title}</h6>

                    {/* 반복 일정 */}
                    {p.repeat_text && <div className="small mb-1">🔁 {p.repeat_text}</div>}

                    {/* 1차 일정 */}
                    {p.event_date_display && <div className="small mb-1">📅 {p.event_date_display}</div>}
                    {/* 추가 일정 */}
                    {(p.extra_schedules || []).map((s: any) => (
                      <div key={s.id} className="small mb-1">📅 {s.display}</div>
                    ))}

                    {p.event_place && <div className="small mb-1">📍 {p.event_place}</div>}

                    {/* 신청기간 + 예약/신청 바로가기 + 연락처 */}
                    {(p.apply_display || p.reserve_url || p.contact) && (
                      <div className="small mb-1 p-2 bg-light rounded">
                        {p.apply_display && <div>🗓️ 신청기간: {p.apply_display}</div>}
                        {p.reserve_url && (
                          <div>🎟️ <a href={p.reserve_url} target="_blank" rel="noopener noreferrer" className="text-success fw-bold">
                            예약/신청 바로가기
                          </a></div>
                        )}
                        {p.contact && <div>📞 {p.contact}</div>}
                      </div>
                    )}

                    {/* 메모 (스크롤로 전체 내용 확인) */}
                    {p.content && (
                      <div className="small text-muted mb-2 p-2 bg-light rounded"
                        style={{ maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                        {p.content}
                      </div>
                    )}

                    <div className="small text-muted mb-1">👤 {p.author_name || '관리자'}</div>
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="small text-primary mb-2">
                        🔗 자세히 보기 (원문) →
                      </a>
                    )}
                    <div className="d-flex gap-1 flex-wrap mt-auto pt-2 border-top">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(p)}>✏️ 수정</button>
                      <button className="btn btn-sm btn-success" onClick={() => handleApprove(p.id)}>✅ 승인</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p.id)}>🗑️ 삭제</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 공개중 */}
      <div className="card border-0 shadow-sm mb-4 p-3" style={{ borderRadius: 16, borderLeft: '4px solid #27ae60' }}>
        <h6 className="fw-bold mb-3">✅ 마당에 공개 중 <span className="badge bg-success">{approved.length}</span></h6>
        {loading ? (
          <div className="text-center py-3 text-muted"><div className="spinner-border spinner-border-sm" /></div>
        ) : approved.length === 0 ? (
          <div className="text-center text-muted small py-2">공개 중인 소식이 없습니다.</div>
        ) : (
          <div className="row g-3">
            {approved.map(p => (
              <div key={p.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16 }}>
                  <div className="card-body p-3 d-flex flex-column">
                    <div className="small text-muted mb-1">#{p.db_id} · 등록 {formatKST(p.created_at, { month: '2-digit', day: '2-digit' })}</div>
                    {/* 제목 (맨위) */}
                    <h6 className="fw-bold mb-2">{p.title}</h6>

                    {/* 반복 일정 */}
                    {p.repeat_text && <div className="small mb-1">🔁 {p.repeat_text}</div>}

                    {/* 1차 일정 */}
                    {p.event_date_display && <div className="small mb-1">📅 {p.event_date_display}</div>}
                    {/* 추가 일정 */}
                    {(p.extra_schedules || []).map((s: any) => (
                      <div key={s.id} className="small mb-1">📅 {s.display}</div>
                    ))}

                    {p.event_place && <div className="small mb-1">📍 {p.event_place}</div>}

                    {/* 신청기간 + 예약/신청 바로가기 + 연락처 */}
                    {(p.apply_display || p.reserve_url || p.contact) && (
                      <div className="small mb-1 p-2 bg-light rounded">
                        {p.apply_display && <div>🗓️ 신청기간: {p.apply_display}</div>}
                        {p.reserve_url && (
                          <div>🎟️ <a href={p.reserve_url} target="_blank" rel="noopener noreferrer" className="text-success fw-bold">
                            예약/신청 바로가기
                          </a></div>
                        )}
                        {p.contact && <div>📞 {p.contact}</div>}
                      </div>
                    )}

                    {/* 메모 (스크롤로 전체 내용 확인) */}
                    {p.content && (
                      <div className="small text-muted mb-2 p-2 bg-light rounded"
                        style={{ maxHeight: 110, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                        {p.content}
                      </div>
                    )}

                    <div className="small text-muted mb-1">👤 {p.author_name || '관리자'}</div>
                    {p.source_url && (
                      <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="small text-primary mb-2">
                        🔗 자세히 보기 (원문) →
                      </a>
                    )}
                    <div className="d-flex gap-1 flex-wrap mt-auto pt-2 border-top">
                      <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(p)}>✏️ 수정</button>
                      <button className="btn btn-sm btn-outline-secondary" title="비공개로 전환" onClick={() => handleApprove(p.id)}>숨기기</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p.id)}>🗑️ 삭제</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
