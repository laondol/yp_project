import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { legalApi } from '../lib/api'

export default function LegalAppointmentEditPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [locationDetail, setLocationDetail] = useState('')
  const [date, setDate] = useState('')
  const [timeSlot, setTimeSlot] = useState('')
  const [content, setContent] = useState('')
  const [status, setStatus] = useState('')
  const [schedules, setSchedules] = useState<{ available_dates: string[]; time_slots: { start: string; end: string }[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true); setError('')
    try {
      const [appt, s] = await Promise.all([
        legalApi.getAppointmentEdit(Number(id)) as Promise<any>,
        legalApi.schedules().catch(() => null),
      ])
      setName(appt.name || '')
      setEmail(appt.email || '')
      setPhone(appt.phone || '')
      setLocation(appt.location || '')
      setDate(appt.date || '')
      setTimeSlot(appt.time_slot || '')
      setContent(appt.content || '')
      setStatus(appt.status || 'pending')
      setSchedules(s)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const locked = status === 'approved'

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (locked) return
    if (!name || !email || !date || !timeSlot) return
    setSending(true)
    try {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('email', email)
      fd.append('phone', phone)
      fd.append('location', location)
      fd.append('location_detail', locationDetail)
      fd.append('date', date)
      fd.append('time_slot', timeSlot)
      fd.append('content', content)
      const res: any = await legalApi.editAppointment(Number(id), fd)
      if (res.status === 'success') navigate('/legal/schedule')
      else alert(res.msg || res.error || '수정 실패')
    } catch (err: any) { alert(err?.message || '수정 중 오류') }
    finally { setSending(false) }
  }

  if (loading) return <div className="text-center py-5 text-muted">불러오는 중...</div>
  if (error) return <div className="text-center py-5 text-muted">{error}</div>

  return (
    <div style={{ maxWidth: 700, margin: '0 auto' }}>
      <h4 className="fw-bold mb-3">법률상담 예약 수정</h4>
      {locked && <div className="alert alert-warning">확정된 예약은 수정할 수 없습니다.</div>}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-4">
          <form onSubmit={handleSubmit}>
            <div className="row g-2 mb-3">
              <div className="col-6">
                <label className="form-label small fw-bold">이름</label>
                <input type="text" className="form-control" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold">이메일</label>
                <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} required />
                <label className="form-label small fw-bold mt-1">연락처</label>
                <input type="tel" className="form-control" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-1234-5678" />
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label small fw-bold">상담 장소</label>
              <div className="row g-2">
                <div className="col-6">
                  <select className="form-select" value={location} onChange={e => setLocation(e.target.value)} required>
                    <option value="">장소 선택</option>
                    <option value="법률사무소">법률사무소 방문</option>
                    <option value="출장">출장 상담 (별도 출장비)</option>
                    <option value="온라인">온라인 화상상담</option>
                  </select>
                </div>
                <div className="col-6">
                  <input type="text" className="form-control" value={locationDetail} onChange={e => setLocationDetail(e.target.value)} placeholder="상세 주소 (출장 시)" />
                </div>
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label small fw-bold">예약 희망일</label>
              <input type="date" className="form-control" value={date} onChange={e => setDate(e.target.value)} required />
            </div>
            <div className="mb-3">
              <label className="form-label small fw-bold">희망 시간대</label>
              <select className="form-select" value={timeSlot} onChange={e => setTimeSlot(e.target.value)} required>
                <option value="">시간 선택</option>
                {(schedules?.time_slots || []).map(s => (
                  <option key={s.start} value={`${s.start}-${s.end}`}>{s.start}~{s.end}</option>
                ))}
              </select>
            </div>
            <div className="mb-3">
              <label className="form-label small fw-bold">상담 내용</label>
              <textarea className="form-control" rows={4} value={content} onChange={e => setContent(e.target.value)} placeholder="간단한 상담 내용을 적어주세요." />
            </div>
            <button type="submit" className="btn btn-success w-100 py-2 fw-bold" disabled={sending || locked}>
              {sending ? '저장 중...' : '저장'}
            </button>
            <button type="button" className="btn btn-sm btn-outline-secondary w-100 mt-2" onClick={() => navigate('/legal/schedule')}>취소</button>
          </form>
        </div>
      </div>
    </div>
  )
}
