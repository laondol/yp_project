import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import EmptyState from '../components/common/EmptyState'

interface ScheduleItem {
  id: number | string; title: string; description?: string; memo?: string; location?: string
  event_date: string; end_date?: string; color?: string; is_allday?: boolean
  is_recurring?: boolean; repeat_type?: string; repeat_interval?: number
  repeat_infinite?: boolean; repeat_weekdays?: number; repeat_week_of_month?: number
  repeat_month_of_year?: number; reminder_minutes?: number; exceptions?: string
  content?: string; departure_location?: string; return_location?: string
}

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const COLOR_MAP: Record<string, string> = { red: '#dc3545', blue: '#0d6efd', green: '#198754', gray: '#adb5bd', info: '#0dcaf0' }

export default function SchedulePage() {
  const navigate = useNavigate()
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [selectedDay, setSelectedDay] = useState<number | null>(new Date().getDate())
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | string | null>(null)
  const [showDelModal, setShowDelModal] = useState<number | string | null>(null)
  const [expandedRoute, setExpandedRoute] = useState<number | string | null>(null)
  const [liveDetail, setLiveDetail] = useState<Record<string, any>>({})
  const [editRoute, setEditRoute] = useState<any>(null)
  const [savingRoute, setSavingRoute] = useState(false)
  const [saving, setSaving] = useState(false)
  const formRef = useRef<HTMLDivElement>(null)

  const [formTitle, setFormTitle] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formEndDate, setFormEndDate] = useState('')
  const [formStartTime, setFormStartTime] = useState('')
  const [formEndTime, setFormEndTime] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formMemo, setFormMemo] = useState('')
  const [formAccommodation, setFormAccommodation] = useState('')
  const [showAccommodation, setShowAccommodation] = useState(false)
  const [formAllDay, setFormAllDay] = useState(false)
  const [formRecurring, setFormRecurring] = useState(false)
  const [formRepeatType, setFormRepeatType] = useState('')
  const [formReminder, setFormReminder] = useState(0)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const d = await fetch('/api/bot/schedule').then(r => r.json())
      setSchedules(Array.isArray(d.schedules) ? d.schedules : [])
      const scheds: ScheduleItem[] = Array.isArray(d.schedules) ? d.schedules : []
      scheds.forEach((s: ScheduleItem) => {
        try {
          const rc = JSON.parse(s.content || '{}')
          const hasRail = Array.isArray(rc.steps) && rc.steps.some((st: any) => /지하철|전철|기차|열차/.test(st.mode || ''))
          if (hasRail) {
            fetch(`/api/bot/route/${s.id}`).then(r => r.json()).then(dd => {
              setLiveDetail(prev => ({ ...prev, [String(s.id)]: dd }))
            }).catch(() => {})
          }
        } catch {}
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleLiveDetail = async (sid: number | string) => {
    const nid = expandedRoute === sid ? null : sid
    setExpandedRoute(nid)
    if (nid !== null) {
      try {
        const d = await fetch(`/api/bot/route/${typeof sid === 'string' ? parseInt(sid.split('_')[0]) : sid}`).then(r => r.json())
        setLiveDetail(prev => ({ ...prev, [String(sid)]: d }))
      } catch {}
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate()
  const firstDay = new Date(year, month - 1, 1).getDay()

  const eventsForDay = (day: number) => {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    return schedules.filter(s => {
      const sd = (s.event_date || '').slice(0, 10)
      if ((s.event_date || '').startsWith(dateStr)) return true
      if (s.is_recurring) return false
      const ed = (s.end_date || '').slice(0, 10)
      if (ed > sd) return sd <= dateStr && dateStr <= ed
      return false
    })
  }

  const changeMonth = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) { m = 12; y-- }
    if (m > 12) { m = 1; y++ }
    setYear(y); setMonth(m)
  }

  const openAdd = (day?: number) => {
    setEditingId(null)
    setFormTitle(''); setFormLocation(''); setFormMemo(''); setFormAccommodation(''); setShowAccommodation(false)
    setFormAllDay(false)
    setFormRecurring(false); setFormRepeatType(''); setFormReminder(0)
    setFormStartTime(''); setFormEndTime('')
    const d = day || selectedDay || 1
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    setFormDate(ds)
    setFormEndDate(ds)
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const openEdit = (s: ScheduleItem) => {
    setEditingId(s.id)
    setFormTitle(s.title)
    const dt = s.event_date || ''
    const edStr = s.end_date ? s.end_date.slice(0, 10) : dt.slice(0, 10)
    setFormDate(dt.slice(0, 10))
    setFormStartTime(dt.length > 10 ? dt.slice(11, 16) : '')
    if (s.end_date) {
      setFormEndDate(edStr)
      setFormEndTime(s.end_date.length > 10 ? s.end_date.slice(11, 16) : '')
    } else {
      setFormEndDate(edStr); setFormEndTime('')
    }
    setFormLocation(s.location || '')
    const am = (s.memo || '').match(/\[숙소:([^\]]+)\]/)
    setFormAccommodation(am ? am[1] : '')
    setFormMemo((s.memo || '').replace(/\[숙소:[^\]]+\]/g, '').replace(/^\s*<br>\s*/i, '').trim())
    setShowAccommodation(!!am || (!!edStr && edStr !== dt.slice(0, 10)))
    setFormAllDay(s.is_allday || false)
    setFormRecurring(s.is_recurring || false)
    setFormRepeatType(s.repeat_type || '')
    setFormReminder(s.reminder_minutes || 0)
    setShowForm(true)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }

  const handleSave = async () => {
    if (!formTitle.trim()) return alert('제목을 입력하세요')
    setSaving(true)
    try {
      let memo = formMemo.trim()
      const accommodation = formAccommodation.trim()
      if (accommodation) memo = (memo ? memo + '<br>' : '') + '[숙소:' + accommodation + ']'
      const body: Record<string, unknown> = {
        title: formTitle.trim(),
        location: formLocation,
        memo,
        is_allday: formAllDay,
        is_recurring: formRecurring,
        repeat_type: formRepeatType,
        reminder_minutes: formReminder,
      }
      const eventDate = formDate + (formStartTime && !formAllDay ? `T${formStartTime}:00` : 'T00:00:00')
      body.event_date = eventDate
      if (formEndDate && (formEndDate !== formDate || (formEndTime && !formAllDay))) {
        body.end_date = formEndDate + (formEndTime && !formAllDay ? `T${formEndTime}:00` : 'T23:59:00')
      }
      if (editingId) {
        body.id = typeof editingId === 'string' ? parseInt(editingId.split('_')[0]) : editingId
        const r = await fetch('/api/bot/schedule/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
        if (r && r.route_parsed) alert('✅ 메모를 바탕으로 이동 경로를 만들었습니다.')
      } else {
        await fetch('/api/bot/schedule', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
      }
      setShowForm(false); setEditingId(null); load()
    } catch { alert('저장 실패') }
    finally { setSaving(false) }
  }

  const handleDelete = async (mode?: string) => {
    const id = showDelModal
    if (!id) return
    try {
      const body: Record<string, unknown> = { id: typeof id === 'string' ? parseInt(id.split('_')[0]) : id }
      const isRecurring = schedules.find(s => s.id === id)?.is_recurring
      if (isRecurring && mode) body.mode = mode
      if (!isRecurring || mode) {
        await fetch('/api/bot/schedule/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
        setShowDelModal(null); load()
      }
    } catch { alert('삭제 실패') }
  }

  const deleteClick = (id: number | string) => {
    const s = schedules.find(s => s.id === id)
    if (s?.is_recurring) { setShowDelModal(id) }
    else if (confirm('삭제하시겠습니까?')) {
      fetch('/api/bot/schedule/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
        .then(r => r.json()).then(() => load())
    }
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="d-flex gap-2 mb-3">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowForm(false)}>달력</button>
        <button className="btn btn-sm btn-success" onClick={() => openAdd()}>+ 일정등록</button>
        <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => navigate('/user/' + (window as unknown as Record<string, unknown>).userId || '')}>내 프로필</button>
      </div>

      {!showForm ? (
        <>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => changeMonth(-1)}>◀</button>
            <span className="fw-bold">{year}년 {month}월</span>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => changeMonth(1)}>▶</button>
          </div>

          <div className="d-grid mb-2" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, position: 'relative' }}>
            {DAYS.map(d => <div key={d} className="text-center small fw-bold text-muted py-1">{d}</div>)}
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1
              const today = new Date()
              const isToday = year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()
              const isSelected = selectedDay === day
              return (
                <div key={day}
                  onClick={() => setSelectedDay(day)}
                  style={{
                    textAlign: 'center', padding: '6px 2px', borderRadius: 8, cursor: 'pointer',
                    background: isSelected ? '#0d6efd' : isToday ? '#d4f4ec' : undefined,
                    color: isSelected ? '#fff' : undefined,
                    fontWeight: isToday ? 700 : undefined,
                  }}>
                  {day}
                  {(() => {
                    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
                    const covering = eventsForDay(day)
                    if (!covering.length) return null
                    const specs = covering.slice(0, 4).map((e, ei) => {
                      const sd = (e.event_date || '').slice(0, 10)
                      const ed = (e.end_date || sd).slice(0, 10)
                      const st = parseInt((e.event_date || '').slice(11, 13)) || 0
                      const et = parseInt((e.end_date || '').slice(11, 13)) || 0
                      const color = COLOR_MAP[e.color || 'gray'] || '#adb5bd'
                      const isAllDay = !!e.is_allday
                      const multiDay = ed > sd
                      const isStart = sd === dateStr
                      const isEnd = ed === dateStr
                      if (!multiDay && !isAllDay && !e.is_recurring) {
                        return { key: ei, z: 3, kind: 'dot' as const, color }
                      }
                      let width = 1, align: 'left' | 'right' | 'center' = 'center', z = 2
                      if (isAllDay) { width = 1; align = 'center'; z = 1 }
                      else if (e.is_recurring) { width = 0.5; align = 'center'; z = 2 }
                      else if (multiDay) {
                        if (isStart) { width = st > 0 ? (24 - st) / 24 : 1; align = 'right' }
                        else if (isEnd) { width = et > 0 ? et / 24 : 1; align = 'left' }
                        else { width = 1; align = 'center' }
                      }
                      return { key: ei, z, kind: 'bar' as const, width, align, color }
                    })
                    const sorted = [...specs].sort((a, b) => a.z - b.z)
                    return (
                      <div style={{ position: 'relative', height: 6, marginTop: 2 }}>
                        {sorted.map(s =>
                          s.kind === 'dot' ? (
                            <div key={s.key} style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: 999, background: s.color, zIndex: 3 }} />
                          ) : (
                            <div key={s.key} style={{
                              position: 'absolute', top: 0, height: 4, zIndex: s.z,
                              width: `${s.width * 100}%`,
                              left: s.align === 'right' ? `${(1 - s.width) * 100}%` : s.align === 'center' ? `${(1 - s.width) * 50}%` : 0,
                              background: s.color, borderRadius: 999, opacity: 0.9,
                            }} />
                          )
                        )}
                      </div>
                    )
                  })()}
                </div>
              )
            })}
          </div>

          <div className="d-flex justify-content-between align-items-center mb-2">
            <strong>{selectedDay ? `${year}년 ${month}월 ${selectedDay}일` : ''}</strong>
            <button className="btn btn-sm btn-outline-success" onClick={() => openAdd()}>+ 추가</button>
          </div>

          <div>
            {selectedDay && eventsForDay(selectedDay).length === 0 && (
              <EmptyState icon="📅" title="등록된 일정이 없습니다." />
            )}
            {selectedDay && (() => {
              const dayScheds = eventsForDay(selectedDay).sort((a, b) => (a.event_date || '').localeCompare(b.event_date || ''))
              return dayScheds.length === 0 ? (
                <EmptyState icon="📅" title="등록된 일정이 없습니다." />
              ) : dayScheds.map((s) => {
                let transitBtns: React.ReactNode = null
                let routeDetail: React.ReactNode = null
                let summaryEl: React.ReactNode = null
                let route = JSON.parse(s.content || 'null')
                const isTransit = (s.title && (s.title.includes('이동') || s.title.includes('집으로'))) && route && Array.isArray(route.steps) && route.steps.length > 0
                if (isTransit) {
                  try {
                    const r = route
                    const dl = encodeURIComponent(s.departure_location || '출발')
                    const al = encodeURIComponent(s.return_location || s.location || '도착')
                    const hasCoords = !!(r.from_lat && r.to_lat && r.from_lng && r.to_lng)
                    const fromLat = hasCoords ? parseFloat(r.from_lat).toFixed(7) : ''
                    const fromLng = hasCoords ? parseFloat(r.from_lng).toFixed(7) : ''
                    const toLat = hasCoords ? parseFloat(r.to_lat).toFixed(7) : ''
                    const toLng = hasCoords ? parseFloat(r.to_lng).toFixed(7) : ''
                    const ts = s.end_date || s.event_date
                    let arrTs = ''
                    if (ts) {
                      try {
                        const parts = ts.split(' ')
                        const dp = parts[0].split('-')
                        const tp = parts[1].split(':')
                        const d = new Date(Date.UTC(parseInt(dp[0]), parseInt(dp[1]) - 1, parseInt(dp[2]), parseInt(tp[0]), parseInt(tp[1])))
                        if (!isNaN(d.getTime())) arrTs = Math.floor(d.getTime() / 1000).toString()
                      } catch {}
                    }
                    const isHome = s.title.includes('집으로')
                    const dataParam = isHome
                      ? '!3m1!4b1!4m4!4m3!2m1!6e2!3e3'
                      : '!3m1!4b1!4m6!4m5!2m3!6e1!7e2!8j' + (arrTs || '') + '!3e3'
                    // 도보 단계가 있으면 해당 단계 도착 좌표를 나침반 목적지/경유점으로 자동 입력
                    const steps = r.steps || []
                    const walkSteps = steps.filter((st: any) => (st.mode || '').includes('도보'))
                    const compassWaypoints: any[] = []
                    walkSteps.forEach((st: any, wi: number) => {
                      const wlat = (st.to_lat != null && !isNaN(parseFloat(st.to_lat))) ? parseFloat(st.to_lat) : parseFloat(r.to_lat)
                      const wlng = (st.to_lng != null && !isNaN(parseFloat(st.to_lng))) ? parseFloat(st.to_lng) : parseFloat(r.to_lng)
                      compassWaypoints.push({ lat: wlat, lng: wlng, name: st.to || st.from || `도보 ${wi + 1}`, mode: st.mode, detail: st.detail })
                    })
                    const hasWalk = walkSteps.length > 0
                    if (!hasWalk && steps.length > 0) {
                      const st = steps[steps.length - 1]
                      compassWaypoints.push({
                        lat: (st.to_lat != null && !isNaN(parseFloat(st.to_lat))) ? parseFloat(st.to_lat) : parseFloat(r.to_lat),
                        lng: (st.to_lng != null && !isNaN(parseFloat(st.to_lng))) ? parseFloat(st.to_lng) : parseFloat(r.to_lng),
                        name: st.to || st.from || '목적지', mode: st.mode, detail: st.detail,
                      })
                    }
                    const wpParam = encodeURIComponent(JSON.stringify(compassWaypoints))
                    transitBtns = (
                      <div className="d-flex gap-1 mt-1 flex-wrap">
                        {hasCoords && <>
                        <a className="btn btn-sm btn-outline-danger py-0" target="_blank" rel="noopener noreferrer"
                          href={`https://www.google.co.kr/maps/dir/${fromLat},${fromLng}/${toLat},${toLng}/data=${dataParam}`}>🌐Google</a>
                        <a className="btn btn-sm btn-outline-info py-0" target="_blank" rel="noopener noreferrer"
                          href={`https://map.naver.com/p/directions/${r.from_lng},${r.from_lat},${dl}/${r.to_lng},${r.to_lat},${al}/-/transit`}>🗺️네이버</a>
                        <a className="btn btn-sm btn-outline-success py-0" target="_blank" rel="noopener noreferrer"
                          href={`https://map.kakao.com/link/by/traffic/${dl},${r.from_lat},${r.from_lng}/${al},${r.to_lat},${r.to_lng}`}>📱카카오</a>
                        <a className={`btn btn-sm py-0 ${hasWalk ? 'btn-primary' : 'btn-outline-primary'}`} target="_blank" rel="noopener noreferrer"
                          href={`/compass?popup=1&lat=${r.to_lat}&lng=${r.to_lng}&name=${encodeURIComponent(s.title || '목적지')}&waypoints=${wpParam}`}>
                          {hasWalk ? '🧭 도보 나침반' : '🧭나침반'}
                        </a>
                        </>}
                      </div>
                    )
                    // 접이식 상세 도식 카드
                    const stripRegion = (name: string) => (name || '').replace(/^(서울|수도권|부산|대구|대전|광주|인천|경기|세종|울산)\s*/i, '')
                    const isTrain = (t: string) => /기차|열차|KTX|ITX|SRT|무궁화|새마을|누리로|NURIR|RAIL|TRAIN|특급|고속철/i.test(t)
                    const LINE_COLORS: Record<string, string> = {
                      '1호선': '#0052A4', '2호선': '#00A84D', '3호선': '#EF7C1C', '4호선': '#00A5DE',
                      '5호선': '#996CAC', '6호선': '#CD7C2F', '7호선': '#747F00', '8호선': '#E6186C', '9호선': '#BB8336',
                      '경의중앙선': '#77C4A3', '수인분당선': '#FABE00', '신분당선': '#D4003B', '공항철도': '#0090D2',
                      '서해선': '#8FC31F', '경강선': '#003DA5', '경춘선': '#178C72',
                    }
                    const lineColorOf = (name: string) => {
                      const n = stripRegion(name)
                      const m = n.match(/(\d+)\s*호선/)
                      if (m) return LINE_COLORS[`${m[1]}호선`] || '#525252'
                      return LINE_COLORS[n.trim()] || '#3b6ea5'
                    }
                    const railBadge = (name: string) => {
                      const n = stripRegion(name)
                      const m = n.match(/(\d+)\s*호선/)
                      const color = lineColorOf(name)
                      if (m) {
                        return (
                          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 26, height: 26, borderRadius: '50%', background: color, color: '#fff',
                            fontSize: 14, fontWeight: 800, lineHeight: 1 }}>{m[1]}</span>
                        )
                      }
                      return (
                        <span style={{ display: 'inline-block', background: color, color: '#fff', borderRadius: 999,
                          padding: '3px 14px', fontSize: 12, fontWeight: 700 }}>{n}</span>
                      )
                    }
                    const busBadge = (no: string) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: '#3b7cdd',
                        color: '#fff', borderRadius: 8, padding: '2px 9px', fontSize: 12, fontWeight: 700 }}>
                        <span style={{ fontSize: 13 }}>🚌</span>
                        {(no || '').replace(/[^0-9\-]/g, '')}
                      </span>
                    )
                    const trainBadge = (name: string) => (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#2C3E50',
                        color: '#fff', borderRadius: 999, padding: '2px 12px', fontSize: 12, fontWeight: 700 }}>
                        <span style={{ fontSize: 14 }}>🚄</span>
                        {stripRegion(name)}
                      </span>
                    )
                    const modeBadge = (st: any) => {
                      const mode = st.mode || ''
                      const nm = st.subway_name || ''
                      if (mode.includes('자전거')) return <span style={{ fontSize: 20 }}>🚲</span>
                      if (mode.includes('택시')) return <span style={{ fontSize: 20 }}>🚕</span>
                      if (mode.includes('도보')) return <span style={{ fontSize: 20, color: '#6c757d' }}>🚶</span>
                      if (mode.includes('버스')) return busBadge(st.bus_no)
                      if (isTrain(mode) || isTrain(nm)) return trainBadge(nm || (st.detail || '').split(' ')[0] || '기차')
                      if (mode.includes('지하철') || mode.includes('전철')) return railBadge(nm || (st.detail || '').split(' ')[0] || '전철')
                      return railBadge(nm || st.mode || '')
                    }
                    const startName = s.departure_location || '출발'
                    const destName = s.return_location || s.location || '도착'
                    const nodes: any[] = []
                    let lastPlace = ''
                    steps.forEach((st: any, i: number) => {
                      const fromName = st.from || (i > 0 ? steps[i - 1].to : startName)
                      if (fromName && fromName !== lastPlace) { nodes.push({ kind: 'place', name: fromName }); lastPlace = fromName }
                      nodes.push({ kind: 'badge', st })
                      const toName = st.to || (i === steps.length - 1 ? destName : '')
                      if (toName) { nodes.push({ kind: 'place', name: toName }); lastPlace = toName }
                    })
                    const lastNode = nodes[nodes.length - 1]
                    const ld = liveDetail[String(s.id)] || {}
                    const stationTimes: Record<string, any[]> = {}
                    Object.values(ld.train_times || {}).forEach((t: any) => {
                      if (t && t.station && Array.isArray(t.trains)) {
                        stationTimes[t.station] = t.trains
                      }
                    })
                    const busStops: Record<string, any> = {}
                    Object.values(ld.bus_stops || {}).forEach((b: any) => {
                      if (b && b.stop) busStops[b.stop] = b
                    })
                    const stopInfoEl = (nm: string) => {
                      const b = busStops[nm]
                      if (!b) return null
                      const info = b.info || {}
                      const rt = info.realtime || []
                      if (rt.length) {
                        const reco = [...rt].sort((a: any, b: any) => ((b.recommended ? 1 : 0) - (a.recommended ? 1 : 0)))
                        return (
                          <div className="mt-1 small" style={{ fontSize: 10, color: '#495057', maxWidth: 280 }}>
                            {reco.slice(0, 4).map((r: any, i: number) => (
                              <span key={i} className="me-2" style={r.recommended ? { fontWeight: 700, color: '#c0392b' } : undefined}>
                                🚌{r.route} {r.min}분 후{r.dest ? `(${r.dest})` : ''}{r.end ? '·막차' : ''}{r.recommended ? '·추천' : ''}
                              </span>
                            ))}
                          </div>
                        )
                      }
                      const lanes = info.lanes || []
                      if (!lanes.length) return null
                      const shown = lanes.slice(0, 4)
                      return (
                        <div className="mt-1 small" style={{ fontSize: 10, color: '#495057', maxWidth: 280 }}>
                          {shown.map((l: any, i: number) => (
                            <div key={i}>🚌 {l.busNo} {l.first}~{l.last}{l.interval && ` · ${l.interval}간격`}</div>
                          ))}
                        </div>
                      )
                    }
                    const rows = nodes.map((nd: any, idx: number) => {
                      if (nd.kind === 'badge') {
                        const isRail = (nd.st.mode || '').match(/지하철|전철|기차|열차/)
                        return (
                          <div key={idx} className="d-flex flex-column align-items-center py-1">
                            {modeBadge(nd.st)}
                            {isRail && nd.st.car_advice && (
                              <small style={{ fontSize: 10, color: '#7d5b0f', marginTop: 2, maxWidth: 260, textAlign: 'center' }}>
                                🚃 {nd.st.car_advice}
                              </small>
                            )}
                          </div>
                        )
                      }
                      const isDest = lastNode && lastNode.kind === 'place' && idx === nodes.length - 1
                      const tms = stationTimes[nd.name] || []
                      return (
                        <div key={idx} className="d-flex flex-column align-items-center py-1">
                          <span style={{
                            background: isDest ? '#d9f2e3' : '#fff',
                            border: isDest ? '2px solid #28a745' : '1px solid #d7dde3',
                            borderRadius: isDest ? 8 : 999,
                            padding: isDest ? '4px 14px' : '2px 12px',
                            fontSize: isDest ? 13 : 12, fontWeight: isDest ? 700 : 500,
                            color: isDest ? '#155724' : '#3c4146',
                          }}>{nd.name}{isDest && ' 📍'}{tms.map((t: any, ti: number) => (
                            <span key={ti} className="ms-1" style={{ fontWeight: 700, fontSize: 11, color: t.express ? '#c0392b' : '#1f4e8c' }}>
                              {t.time}{t.express ? '급' : ''}
                            </span>
                          ))}</span>
                          {stopInfoEl(nd.name)}
                        </div>
                      )
                    })
                    const totalH = Math.floor(r.total_min / 60)
                    const totalM = r.total_min % 60
                    const summaryRow = (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, overflowX: 'auto', whiteSpace: 'nowrap', paddingBottom: 2, fontSize: 0 }}>
                        {nodes.map((nd: any, idx: number) => {
                          if (nd.kind === 'badge') {
                            return <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                              {modeBadge(nd.st)}
                              {nd.st.time_min > 0 && <small style={{ fontSize: 10, color: '#868e96' }}>{nd.st.time_min}분</small>}
                            </span>
                          }
                          const isDest = lastNode && lastNode.kind === 'place' && idx === nodes.length - 1
                          const tms = stationTimes[nd.name] || []
                          const bstop = busStops[nd.name]
                          const brt = bstop && bstop.info && (bstop.info.realtime || []).length
                            ? [...(bstop.info.realtime || [])].sort((x: any, y: any) => ((y.recommended ? 1 : 0) - (x.recommended ? 1 : 0))).slice(0, 2)
                            : []
                          return (
                            <span key={idx} style={{
                              flexShrink: 0,
                              background: isDest ? '#d9f2e3' : '#f1f3f5',
                              border: isDest ? '1px solid #28a745' : '1px solid #dee2e6',
                              borderRadius: 999,
                              padding: '1px 7px',
                              fontSize: 11, fontWeight: isDest ? 700 : 500,
                              color: isDest ? '#155724' : '#495057',
                            }}>{nd.name}{isDest && ' 📍'}{tms.map((t: any, ti: number) => (
                              <span key={ti} className="ms-1" style={{ fontWeight: 700, color: t.express ? '#c0392b' : '#1f4e8c' }}>
                                {t.time}{t.express ? '급' : ''}
                              </span>
                            ))}
                            {brt.length > 0 && <span className="ms-1" style={{ fontWeight: 700, color: '#0a7d32' }}>🚌{brt[0].min}분 후</span>}
                            </span>
                          )
                        })}
                      </div>
                    )
                    routeDetail = (
                      <div className="mt-2 pt-2 border-top" style={{ background: '#f8f9fa', borderRadius: 10, padding: '0.5rem 0.75rem' }}>
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <small className="fw-bold">🕐 {r.departure || ''} 출발 → {r.arrival || ''} 도착</small>
                          <small className="text-muted" style={{ fontSize: 11 }}>총 {totalH > 0 ? `${totalH}시간${totalM}분` : `${totalM}분`} · {r.distance_km}km</small>
                        </div>
                        {r.estimate && (
                          <div className="badge bg-warning text-dark mb-1" style={{ fontSize: 10 }}>⚠ 정확 경로 미제공 (추정)</div>
                        )}
                        {rows.length > 0 ? rows : (
                          <div className="text-muted" style={{ fontSize: 11 }}>{r.narrative || '경로 정보가 없습니다.'}</div>
                        )}
                        <div className="d-flex gap-1 mt-2">
                          <button className="btn btn-sm btn-outline-secondary flex-fill" onClick={() => setEditRoute({ id: s.id, item: s, steps: steps.map((st: any) => ({ ...st })) })}>✏️ 경로 수정</button>
                        </div>
                      </div>
                    )
                    summaryEl = (
                      <div className="small mt-1">
                        <div className="d-flex align-items-center gap-1 mb-1" style={{ justifyContent: 'space-between' }}>
                          <span className="fw-bold" style={{ fontSize: 11 }}>🚏 이동 경로</span>
                          <span className="text-muted" style={{ fontSize: 10 }}>총 {totalH > 0 ? `${totalH}시간${totalM}분` : `${totalM}분`}</span>
                        </div>
                        {summaryRow}
                      </div>
                    )
                  } catch {}
                }
                return (
                  <div key={s.id}>
                    <div className="card border-0 shadow-sm mb-1" style={{
                      borderRadius: 12,
                      borderLeft: `3px solid ${COLOR_MAP[s.color || 'gray'] || '#adb5bd'}`,
                    }}>
                      <div className="card-body p-3">
                        <div className="d-flex justify-content-between align-items-start">
                          <div>
                            <strong>{s.title}</strong>
                            {s.is_recurring && <span className="badge bg-light text-dark ms-1" style={{ fontSize: '0.65rem' }}>🔄</span>}
                          </div>
                          <div className="d-flex gap-1">
                            {isTransit && (
                              <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => toggleLiveDetail(s.id)}>
                                {expandedRoute === s.id ? '▴ 접기' : '▾ 상세'}
                              </button>
                            )}
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => openEdit(s)}>✏️</button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => deleteClick(s.id)}>🗑️</button>
                          </div>
                        </div>
                        <div className="small text-muted mt-1">
                          {s.event_date && (
                            <span>{new Date(s.event_date).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                          {s.location && <span> · 📍 {s.location}</span>}
                        </div>
                        {summaryEl}
                        {expandedRoute === s.id && routeDetail}
                        {(s.description || s.memo) && (
                          <div className="small text-muted mt-1" style={{ whiteSpace: 'pre-wrap' }} dangerouslySetInnerHTML={{ __html: (s.description || s.memo || '').replace(/\[숙소:[^\]]+\]/g, '').replace(/^\s*<br>\s*/i, '').replace(/\n/g, '<br>') }} />
                        )}
                        {s.memo && s.memo.includes('[숙소:') && (
                          <div className="small mt-1">🏠 숙소: {(s.memo.match(/\[숙소:([^\]]+)\]/) || [])[1]}</div>
                        )}
                        {transitBtns}
                      </div>
                    </div>

                  </div>
                )
              })
            })()}
          </div>
        </>
      ) : (
        <div ref={formRef} className="card p-3" style={{ borderRadius: 16 }}>
          <h6 className="mb-3">{editingId ? '일정 수정' : '새 일정'}</h6>
          <input className="form-control form-control-sm mb-2" placeholder="제목" value={formTitle} onChange={e => setFormTitle(e.target.value)} />
          <div className="row g-2 mb-2">
            <div className="col-5">
              <label className="small d-block">날짜</label>
              <input type="date" className="form-control form-control-sm" value={formDate} onChange={e => { setFormDate(e.target.value); setShowAccommodation(!!e.target.value && !!formEndDate && e.target.value !== formEndDate) }} />
            </div>
            <div className="col-4">
              <label className="small d-block">시간</label>
              <input type="time" className="form-control form-control-sm" value={formStartTime} onChange={e => setFormStartTime(e.target.value)} disabled={formAllDay} />
            </div>
            <div className="col-3 d-flex align-items-end">
              <label className="small"><input type="checkbox" checked={formAllDay} onChange={e => setFormAllDay(e.target.checked)} /> 종일</label>
            </div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-5">
              <label className="small d-block">종료일</label>
              <input type="date" className="form-control form-control-sm" value={formEndDate} onChange={e => { setFormEndDate(e.target.value); setShowAccommodation(!!formDate && !!e.target.value && formDate !== e.target.value) }} />
            </div>
            <div className="col-4">
              <label className="small d-block">종료시간</label>
              <input type="time" className="form-control form-control-sm" value={formEndTime} onChange={e => setFormEndTime(e.target.value)} disabled={formAllDay} />
            </div>
          </div>
          <input className="form-control form-control-sm mb-2" placeholder="장소" list="scheduleLocations" value={formLocation} onChange={e => setFormLocation(e.target.value)} />
          <datalist id="scheduleLocations">
            {[...new Set(schedules.map(s => s.location).filter(Boolean))].map(loc => (
              <option key={loc} value={loc as string} />
            ))}
          </datalist>
          {showAccommodation && (
            <input className="form-control form-control-sm mb-2" placeholder="숙소" value={formAccommodation} onChange={e => setFormAccommodation(e.target.value)} />
          )}
          <div className="mb-2">
            <label className="small d-block">메모</label>
            <textarea className="form-control form-control-sm" rows={3} value={formMemo} onChange={e => setFormMemo(e.target.value)} />
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6">
              <label className="small d-block">알림</label>
              <select className="form-control form-control-sm" value={formReminder} onChange={e => setFormReminder(Number(e.target.value))}>
                <option value={0}>알림 안 함</option>
                <option value={-1}>정각</option>
                <option value={10}>10분 전</option>
                <option value={30}>30분 전</option>
                <option value={60}>1시간 전</option>
                <option value={1440}>1일 전</option>
              </select>
            </div>
            <div className="col-6 d-flex align-items-end gap-2">
              <label className="small"><input type="checkbox" checked={formRecurring} onChange={e => setFormRecurring(e.target.checked)} /> 반복</label>
              {formRecurring && (
                <select className="form-control form-control-sm" style={{ width: 'auto' }} value={formRepeatType} onChange={e => setFormRepeatType(e.target.value)}>
                  <option value="">선택</option>
                  <option value="daily">매일</option>
                  <option value="weekly">매주</option>
                  <option value="monthly">매월</option>
                  <option value="yearly">매년</option>
                </select>
              )}
            </div>
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-sm btn-success" onClick={handleSave} disabled={saving}>{saving ? '저장 중...' : '저장'}</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { setShowForm(false); setEditingId(null) }}>취소</button>
          </div>
        </div>
      )}

      {showDelModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 16, width: 280, maxWidth: '90%', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
            <div className="fw-bold mb-1">반복 일정 삭제</div>
            <div className="small text-muted mb-3">어떤 범위를 삭제할까요?</div>
            <button className="btn btn-sm btn-danger w-100 mb-2" onClick={() => handleDelete('all')}>전체 삭제</button>
            <button className="btn btn-sm btn-outline-danger w-100 mb-2" onClick={() => handleDelete('this_after')}>이 일정 포함 이후</button>
            <button className="btn btn-sm btn-outline-secondary w-100 mb-2" onClick={() => handleDelete('this_only')}>이 일정만</button>
            <button className="btn btn-sm btn-light w-100" onClick={() => setShowDelModal(null)}>취소</button>
          </div>
        </div>
      )}

      {editRoute && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 16, width: 480, maxWidth: '100%', maxHeight: '86vh', overflow: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.2)' }}>
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h6 className="fw-bold mb-0">✏️ 이동 경로 수정</h6>
              <button className="btn btn-sm btn-light" onClick={() => setEditRoute(null)}>✕</button>
            </div>
            <p className="small text-muted mb-2">각 구간의 이동수단과 소요시간, 출발/도착 장소를 수정할 수 있습니다.</p>
            {editRoute.steps.map((st: any, idx: number) => (
              <div key={idx} className="border rounded p-2 mb-2" style={{ background: '#fafafa' }}>
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small fw-bold text-muted">구간 {idx + 1}</span>
                  <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => setEditRoute((er: any) => ({ ...er, steps: er.steps.filter((_: any, i: number) => i !== idx) }))}>🗑️</button>
                </div>
                <div className="row g-1 mb-1">
                  <div className="col-5">
                    <label className="small d-block text-muted">이동수단</label>
                    <select className="form-select form-select-sm" value={st.mode || ''}
                      onChange={e => {
                        const v = e.target.value
                        setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => {
                          if (i !== idx) return x
                          const nx = { ...x, mode: v }
                          if (v.includes('도보')) { nx.bus_no = ''; nx.subway_name = ''; nx.detail = `도보 ${x.time_min || 0}분` }
                          else if (v.includes('버스')) { nx.subway_name = ''; nx.bus_no = nx.bus_no || ''; nx.detail = `${nx.bus_no || ''} ${x.from || ''}→${x.to || ''} (${x.time_min || 0}분)` }
                          else if (v.includes('지하철') || v.includes('전철') || v.includes('기차')) { nx.bus_no = ''; nx.subway_name = nx.subway_name || '지하철'; nx.detail = `${nx.subway_name || ''} ${x.from || ''}→${x.to || ''} (${x.time_min || 0}분)` }
                        return nx
                      }) }))}
                      }>

                      <option value="🚶 도보">🚶 도보</option>
                      <option value="🚌 버스">🚌 버스</option>
                      <option value="🚄 지하철">🚄 지하철</option>
                      <option value="🚄 기차">🚄 기차</option>
                      <option value="🚕 택시">🚕 택시</option>
                      <option value="🚲 자전거">🚲 자전거</option>
                    </select>
                  </div>
                  <div className="col-4">
                    <label className="small d-block text-muted">소요시간(분)</label>
                    <input type="number" min={0} className="form-control form-control-sm" value={st.time_min || 0}
                      onChange={e => setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => i !== idx ? x : { ...x, time_min: Number(e.target.value) || 0 }) }))} />
                  </div>
                  <div className="col-3">
                    <label className="small d-block text-muted">호선/노선</label>
                    <input className="form-control form-control-sm" placeholder="경의중앙선" value={st.subway_name || st.bus_no || ''}
                      onChange={e => setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => i !== idx ? x : { ...x, subway_name: e.target.value, bus_no: (x.mode || '').includes('버스') ? e.target.value : x.bus_no }) }))} />
                  </div>
                </div>
                {(st.mode || '').match(/지하철|전철|기차|열차/) && (
                  <div className="mb-1">
                    <input className="form-control form-control-sm" placeholder="🚃 탈 칸/문 (예: 3번째 칸, 환승 통로와 가까움)" value={st.car_advice || ''}
                      onChange={e => setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => i !== idx ? x : { ...x, car_advice: e.target.value }) }))} />
                  </div>
                )}
                <div className="row g-1">
                  <div className="col-6">
                    <input className="form-control form-control-sm" placeholder="출발 장소" value={st.from || ''}
                      onChange={e => setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => i !== idx ? x : { ...x, from: e.target.value }) }))} />
                  </div>
                  <div className="col-6">
                    <input className="form-control form-control-sm" placeholder="도착 장소" value={st.to || ''}
                      onChange={e => setEditRoute((er: any) => ({ ...er, steps: er.steps.map((x: any, i: number) => i !== idx ? x : { ...x, to: e.target.value }) }))} />
                  </div>
                </div>
              </div>
            ))}
            <div className="d-flex gap-1 mb-3">
              <button className="btn btn-sm btn-outline-secondary flex-fill" onClick={() => setEditRoute((er: any) => ({ ...er, steps: [...er.steps, { mode: '🚶 도보', from: '', to: '', detail: '도보 0분', time_min: 0 }] }))}>+ 구간 추가</button>
            </div>
            <div className="d-flex gap-2">
              <button className="btn btn-sm btn-success flex-fill" disabled={savingRoute} onClick={async () => {
                setSavingRoute(true)
                try {
                  const steps2 = editRoute.steps
                  const total = steps2.reduce((a: number, s: any) => a + (s.time_min || 0), 0)
                  const narrParts: string[] = []
                  const prevRoute = (() => { try { const sv = JSON.parse((editRoute.item?.content) || 'null'); return sv } catch { return null } })()
                  const prevFrom = prevRoute && prevRoute.from_lat ? prevRoute.from_lat : null
                  const prevTo = prevRoute && prevRoute.to_lat ? prevRoute.to_lat : null
                  let curName = editRoute.item?.departure_location || '출발'
                  steps2.forEach((st: any, i: number) => {
                    const nm = st.mode || ''
                    const dur = st.time_min || 0
                    const from = st.from || curName
                    const to = st.to || (i === steps2.length - 1 ? (editRoute.item?.return_location || editRoute.item?.location || '목적지') : (steps2[i + 1] && steps2[i + 1].from) || '')
                    curName = to
                    if (nm.includes('도보')) narrParts.push(`${from}에서 ${dur}분 걸어서`)
                    else if (nm.includes('버스')) narrParts.push(`${from}에서 ${st.bus_no || '버스'}를 타고 ${dur}분 가서 ${to}에서 내려서`)
                    else if (nm.includes('기차')) narrParts.push(`${from}에서 ${st.subway_name || '기차'}를 타고 ${dur}분 가서 ${to}역에서 내려서`)
                    else if (nm.includes('지하철') || nm.includes('전철')) narrParts.push(`${from}에서 ${st.subway_name || '지하철'}으로 지하철을 타고 ${dur}분 가서 ${to}역에서 내려서`)
                    else if (nm.includes('택시')) narrParts.push(`${from}에서 택시를 타고 ${dur}분 가서 ${to}에 도착해서`)
                    else if (nm.includes('자전거')) narrParts.push(`${from}에서 자전거를 타고 ${dur}분 가서 ${to}에 도착해서`)
                    else narrParts.push(`${from}에서 ${dur}분 이동해서 ${to}에 도착해서`)
                  })
                  const destName = editRoute.item?.return_location || editRoute.item?.location || '목적지'
                  const narrative = `${narrParts.join(' ')} ${destName}입니다.`
                  const res = await fetch(`/api/bot/route/${editRoute.id}/save`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      steps: steps2, total_min: total, distance_km: 0,
                      departure: prevRoute && prevRoute.departure || '', arrival: prevRoute && prevRoute.arrival || '',
                      from_lat: prevFrom, to_lat: prevTo, narrative,
                    }),
                  })
                  const data = await res.json()
                  if (!data.success) { alert('저장 실패'); return }
                  setEditRoute(null)
                  setExpandedRoute(null)
                  load()
                } catch { alert('서버 연결 실패') }
                finally { setSavingRoute(false) }
              }}>{savingRoute ? '저장 중...' : '저장'}</button>
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditRoute(null)}>취소</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
