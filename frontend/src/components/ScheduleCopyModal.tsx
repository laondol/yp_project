import { useState } from 'react'

export interface ParsedSchedule {
  title: string
  date: string
  time: string
  endDate: string
  endTime: string
  place: string
}

/** 편지 본문에서 날짜·시간·장소를 추출 (미확정 요소는 사용자가 확인/수정) */
export function parseScheduleFromText(subject?: string, content?: string, sender?: string): ParsedSchedule {
  const plain = (content || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ')
  const out: ParsedSchedule = {
    title: (subject || '').trim() || (sender ? `${sender} 일정` : '일정'),
    date: '', time: '', endDate: '', endTime: '', place: '',
  }

  // 날짜: 2026-10-10 / 2026.10.10 / 2026년 10월 10일 / 10월 10일 / 10/10
  const dm = plain.match(/(\d{4})\s*[-.년\/]\s*(\d{1,2})\s*[-.월\/]\s*(\d{1,2})/)
    || plain.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (dm) {
    let y: number, mo: number, d: number
    if (dm[3]) { y = Number(dm[1]); mo = Number(dm[2]); d = Number(dm[3]) }
    else { y = new Date().getFullYear(); mo = Number(dm[1]); d = Number(dm[2]) }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      out.date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
  }

  // 시간: 17:00 / 오후 5시 / 오후 5시 30분
  const hm = plain.match(/(\d{1,2}):(\d{2})/)
  const kor = plain.match(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/)
  if (hm) {
    out.time = `${hm[1].padStart(2, '0')}:${hm[2]}`
  } else if (kor) {
    let h = Number(kor[2]) % 12
    if (kor[1] === '오후') h += 12
    out.time = `${String(h).padStart(2, '0')}:${String(Number(kor[3] || 0)).padStart(2, '0')}`
  }

  // 장소: "장소:" / "위치:" 라벨
  const pm = plain.match(/(?:장소|위치)\s*[:：]\s*([^\n<]{2,40})/)
  if (pm) out.place = pm[1].trim()

  return out
}

export default function ScheduleCopyModal({ initial, onClose }: { initial: ParsedSchedule; onClose: () => void }) {
  const [title, setTitle] = useState(initial.title)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [endTime, setEndTime] = useState(initial.endTime)
  const [place, setPlace] = useState(initial.place)
  const [allday, setAllday] = useState(!initial.time)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!date) { alert('시작 날짜를 선택해 주세요.'); return }
    setSaving(true)
    try {
      const startIso = allday ? `${date}T00:00` : `${date}T${time || '00:00'}`
      const endIso = endDate ? `${endDate}T${allday ? '23:59' : (endTime || '00:00')}` : ''
      const res = await fetch('/api/bot/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          description: '[편지에서 복사한 일정]',
          event_date: startIso,
          end_date: endIso,
          location: place,
          is_allday: allday,
        }),
      })
      if (res.status === 401) { alert('로그인 후 이용하세요.'); setSaving(false); return }
      const data = await res.json()
      if (data.success || data.id) {
        alert('내 일정에 복사되었습니다.')
        window.open(`/schedule-popup?date=${date}`, 'schedulePopup', 'width=920,height=760')
        onClose()
      } else alert(data.error || data.msg || '추가 실패')
    } catch { alert('오류가 발생했습니다.') }
    setSaving(false)
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)', zIndex: 5000 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 14 }}>
          <div className="modal-header py-2">
            <h6 className="modal-title mb-0">📅 내 일정에 복사</h6>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <div className="alert alert-light py-2 small mb-2">
              편지의 내용에서 일정을 자동으로 읽어 채웠습니다. 확인 후 저장해 주세요.
            </div>
            <div className="mb-2">
              <label className="form-label small fw-bold mb-1">제목</label>
              <input className="form-control form-control-sm" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="row g-2 mb-2">
              <div className="col-6">
                <label className="form-label small fw-bold mb-1">시작 날짜</label>
                <input type="date" className="form-control form-control-sm" value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold mb-1">시작 시간</label>
                <input type="time" className="form-control form-control-sm" value={time} disabled={allday} onChange={e => setTime(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold mb-1">종료 날짜 (선택)</label>
                <input type="date" className="form-control form-control-sm" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold mb-1">종료 시간 (선택)</label>
                <input type="time" className="form-control form-control-sm" value={endTime} disabled={allday} onChange={e => setEndTime(e.target.value)} />
              </div>
            </div>
            <div className="mb-2">
              <label className="form-label small fw-bold mb-1">장소 (선택)</label>
              <input className="form-control form-control-sm" value={place} onChange={e => setPlace(e.target.value)} />
            </div>
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="alldayChk" checked={allday} onChange={e => setAllday(e.target.checked)} />
              <label className="form-check-label small" htmlFor="alldayChk">종일 일정</label>
            </div>
          </div>
          <div className="modal-footer py-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>취소</button>
            <button className="btn btn-sm btn-success" onClick={save} disabled={saving || !date}>
              {saving ? '저장 중...' : '내 일정에 추가'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
