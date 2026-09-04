import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

interface YardExtraSchedule {
  id: number; display: string
  event_start_iso?: string; event_end_iso?: string; is_allday?: boolean
}

interface ScheduleRow {
  key: number; start: string; end: string
}

/** 시간 미입력(또는 00:00)이면 종일로 자동 판정 */
const isAlldayValue = (dt: string): boolean => !dt.includes('T') || dt.endsWith('T00:00')

/** 마당 소식 등록/편집 독립창 (원문 새창과 나란히 입력용) */
export default function YardEditPage() {
  const [params] = useSearchParams()
  const editId = params.get('id')

  const [loading, setLoading] = useState(!!editId)
  const [fTitle, setFTitle] = useState('')
  const [fAuthor, setFAuthor] = useState('')
  const [fStartDt, setFStartDt] = useState('')   // 1차 일정: 시작년월일시
  const [fEndDt, setFEndDt] = useState('')       // 1차 일정: 종료년월일시
  const [fPlace, setFPlace] = useState('')
  const [fApplyStart, setFApplyStart] = useState('')
  const [fApplyEnd, setFApplyEnd] = useState('')
  const [fContent, setFContent] = useState('')
  const [fLink, setFLink] = useState('')
  const [fContact, setFContact] = useState('')
  const [fReserve, setFReserve] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)

  // 추가 일정: DB에 저장된 것 + 새로 입력 중인 것
  const [savedExtra, setSavedExtra] = useState<YardExtraSchedule[]>([])
  const [newRows, setNewRows] = useState<ScheduleRow[]>([])

  useEffect(() => {
    if (!editId) return
    fetch(`/api/yard/${editId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.title) { setMsg('불러올 수 없습니다.'); return }
        setFTitle(d.title || '')
        setFAuthor(d.author_name || '')
        if (d.event_date_iso) {
          setFStartDt(d.event_date_iso.slice(0, 16))
          setFEndDt(d.event_end_iso ? d.event_end_iso.slice(0, 16) : '')
        } else { setFStartDt(''); setFEndDt('') }
        setFPlace(d.event_place || '')
        setFApplyStart(d.apply_start_iso ? d.apply_start_iso.slice(0, 16) : '')
        setFApplyEnd(d.apply_end_iso ? d.apply_end_iso.slice(0, 16) : '')
        setFContent(d.content || '')
        setFLink(d.source_url || '')
        setFContact(d.contact || '')
        setFReserve(d.reserve_url || '')
        setSavedExtra(d.extra_schedules || [])
      })
      .catch(() => setMsg('불러오기 실패'))
      .finally(() => setLoading(false))
  }, [editId])

  // ➕ 일정 추가: 같은 형식의 입력 세트가 하나 더 생김
  const addScheduleRow = () => {
    setNewRows(prev => [...prev, { key: Date.now() + Math.random(), start: '', end: '' }])
  }

  const removeNewRow = (key: number) => {
    setNewRows(prev => prev.filter(r => r.key !== key))
  }

  const deleteSavedSchedule = async (sid: number) => {
    if (!confirm('이 추가 일정을 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/yard/schedules/${sid}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.status === 'success') {
        setSavedExtra(prev => prev.filter(s => s.id !== sid))
      } else alert(data.msg || '삭제 실패')
    } catch { alert('삭제 오류') }
  }

  const handleSave = async () => {
    if (!fTitle.trim()) { alert('제목을 입력하세요.'); return }
    setSaving(true)
    try {
      const payload: any = {
        title: fTitle.trim(), author_name: fAuthor.trim(),
        event_start: fStartDt, event_end: fEndDt, is_allday: isAlldayValue(fStartDt),
        event_place: fPlace.trim(), apply_start: fApplyStart, apply_end: fApplyEnd,
        content: fContent.trim(),
        source_url: fLink.trim(), reserve_url: fReserve.trim(), contact: fContact.trim(),
      }
      const res = await fetch(editId ? `/api/yard/${editId}` : '/api/yard', {
        method: editId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      const postId = editId ? Number(editId) : data.id

      // 새로 입력한 추가 일정들을 저장 (시간 미입력 시 종일)
      if (postId && newRows.length > 0) {
        for (const row of newRows) {
          if (!row.start) continue
          await fetch(`/api/yard/${postId}/schedules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_start: row.start, event_end: row.end, is_allday: isAlldayValue(row.start) }),
          })
        }
      }

      setMsg(data.msg || (data.status === 'success' ? '저장 완료' : '실패'))
      setMsgOk(data.status === 'success')
      if (data.status === 'success') {
        // 부모 창(관리 목록)에 갱신 알림 후 창 닫기
        try { window.opener?.postMessage('yard-updated', '*') } catch {}
        setTimeout(() => window.close(), 700)
      }
    } catch { setMsg('오류가 발생했습니다.'); setMsgOk(false) }
    setSaving(false)
  }

  return (
    <div className="container mt-4" style={{ maxWidth: 640 }}>
      <h5 className="fw-bold mb-3">{editId ? '✏️ 마당 소식 편집' : '✏️ 마당 소식 등록'}</h5>
      {loading ? (
        <div className="text-center py-5"><div className="spinner-border" /></div>
      ) : (
        <>
          <input className="form-control mb-2" placeholder="제목 (필수)"
            value={fTitle} onChange={e => setFTitle(e.target.value)} />
          <input className="form-control mb-2" placeholder="단체명/출처 (예: 두물붙농부시장, 양평군청)"
            value={fAuthor} onChange={e => setFAuthor(e.target.value)} />

          {/* 1차 일정 */}
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="small text-muted mb-1" title="시간을 입력하지 않으면 종일로 자동 표시됩니다">📅 시작년월일시</label>
              <input type="datetime-local" className="form-control" value={fStartDt}
                onChange={e => setFStartDt(e.target.value)} title="시간을 입력하지 않으면 종일로 자동 표시됩니다" />
            </div>
            <div className="col-6">
              <label className="small text-muted mb-1">📅 종료년월일시</label>
              <input type="datetime-local" className="form-control" value={fEndDt}
                onChange={e => setFEndDt(e.target.value)} />
            </div>
          </div>

          {/* 저장된 추가 일정 (편집 시) */}
          {editId && savedExtra.length > 0 && (
            <div className="mb-2">
              {savedExtra.map(s => (
                <div key={s.id} className="d-flex justify-content-between align-items-center border rounded p-1 mb-1">
                  <span className="small">📅 {s.display}</span>
                  <button className="btn btn-sm btn-outline-danger py-0" style={{ fontSize: '0.7rem' }}
                    onClick={() => deleteSavedSchedule(s.id)}>삭제</button>
                </div>
              ))}
            </div>
          )}

          {/* 새로 입력하는 추가 일정 (➕ 버튼으로 세트 추가) */}
          {newRows.map(row => (
            <div key={row.key} className="border rounded p-2 mb-2 bg-light">
              <div className="row g-2 mb-1">
                <div className="col-6">
                  <label className="small text-muted mb-1" title="시간을 입력하지 않으면 종일로 자동 표시됩니다">📅 시작년월일시</label>
                  <input type="datetime-local" className="form-control form-control-sm" value={row.start}
                    onChange={e => setNewRows(prev => prev.map(r => r.key === row.key ? { ...r, start: e.target.value } : r))}
                    title="시간을 입력하지 않으면 종일로 자동 표시됩니다" />
                </div>
                <div className="col-6">
                  <label className="small text-muted mb-1">📅 종료년월일시</label>
                  <input type="datetime-local" className="form-control form-control-sm" value={row.end}
                    onChange={e => setNewRows(prev => prev.map(r => r.key === row.key ? { ...r, end: e.target.value } : r))} />
                </div>
              </div>
              <button className="btn btn-sm btn-outline-danger py-0" style={{ fontSize: '0.7rem' }}
                onClick={() => removeNewRow(row.key)}>✕ 이 세트 삭제</button>
            </div>
          ))}

          <button className="btn btn-sm btn-outline-success mb-3" onClick={addScheduleRow}>
            ➕ 일정 추가 (같은 프로그램 다른 날)
          </button>

          <input className="form-control mb-2" placeholder="📍 장소 (예: 양수리 주차장)"
            value={fPlace} onChange={e => setFPlace(e.target.value)} />
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="small text-muted mb-1" title="시간을 입력하지 않으면 종일로 자동 표시됩니다">🗓️ 신청기간 시작</label>
              <input type="datetime-local" className="form-control" value={fApplyStart}
                onChange={e => setFApplyStart(e.target.value)} title="시간을 입력하지 않으면 종일로 자동 표시됩니다" />
            </div>
            <div className="col-6">
              <label className="small text-muted mb-1">🗓️ 신청기간 종료</label>
              <input type="datetime-local" className="form-control" value={fApplyEnd}
                onChange={e => setFApplyEnd(e.target.value)} />
            </div>
          </div>
          <textarea className="form-control mb-2" rows={5} placeholder="📝 메모 (행사 내용 등)"
            value={fContent} onChange={e => setFContent(e.target.value)} />
          <div className="d-flex gap-2 mb-2">
            <input type="url" className="form-control" placeholder="🔗 링크 (출처 주소)"
              value={fLink} onChange={e => setFLink(e.target.value)} />
            {fLink.trim() && (
              <a href={fLink} target="_blank" rel="noopener noreferrer" className="btn btn-outline-secondary text-nowrap">
                ↗ 원문
              </a>
            )}
          </div>
          <input type="url" className="form-control mb-2" placeholder="🎟️ 예약/신청 사이트 주소 (참여 신청용)"
            value={fReserve} onChange={e => setFReserve(e.target.value)} />
          <input className="form-control mb-3" placeholder="📞 연락처 (전화번호 등)"
            value={fContact} onChange={e => setFContact(e.target.value)} />
          <div className="d-flex gap-2">
            <button className="btn btn-success flex-grow-1" onClick={handleSave} disabled={saving || !fTitle.trim()}>
              {saving ? '⏳ 저장 중...' : '✅ 저장'}
            </button>
            <button className="btn btn-outline-secondary" onClick={() => window.close()}>닫기</button>
          </div>
          <span className={`small mt-2 d-block ${msgOk ? 'text-success' : 'text-danger'}`}>{msg}</span>
          <p className="text-muted small mt-3">
            💡 원문 페이지를 별도 탭/창으로 열어두고 이 창에서 내용을 입력하세요. 저장하면 관리 목록에 바로 반영됩니다.
            ➕ 일정 추가로 같은 프로그램의 다른 날짜를 여러 개 넣으면 마당 카드에 일정 수만큼 내일정 추가 버튼이 생깁니다.
          </p>
        </>
      )}
    </div>
  )
}
