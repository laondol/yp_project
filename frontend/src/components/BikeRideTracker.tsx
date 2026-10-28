import { useEffect, useRef, useState } from 'react'

interface TrackerPlace {
  name: string
  lat: number
  lng: number
}

interface GpsPoint {
  lat: number
  lng: number
  t: number
}

interface Props {
  place: TrackerPlace
  onClose: () => void
  onSaved?: () => void
}

const distanceM = (a: GpsPoint, b: GpsPoint) => {
  const r = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const fmtDuration = (sec: number) => {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export default function BikeRideTracker({ place, onClose, onSaved }: Props) {
  const [distance, setDistance] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [memo, setMemo] = useState('')
  const [status, setStatus] = useState<'recording' | 'saving' | 'saved'>('recording')
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')

  const pointsRef = useRef<GpsPoint[]>([])
  const watchRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const startRef = useRef(Date.now())
  const distanceRef = useRef(0)
  const lastPointRef = useRef<GpsPoint | null>(null)
  const lastSeenRef = useRef(0)

  useEffect(() => {
    if (status !== 'recording') return
    if (!navigator.geolocation) {
      setError('이 브라우저에서는 GPS를 사용할 수 없습니다.')
      return
    }
    const stopWatch = () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current)
        watchRef.current = null
      }
      if (timerRef.current != null) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
    }

    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        if (status !== 'recording') return
        const now = Date.now()
        if (pos.coords.accuracy && pos.coords.accuracy > 100) return
        const next: GpsPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, t: now }
        const prev = lastPointRef.current
        if (!prev) startRef.current = now
        if (prev) {
          const moved = distanceM(prev, next)
          if (now - lastSeenRef.current < 3000 && moved < 5) return
          distanceRef.current += moved
          setDistance(distanceRef.current)
        }
        lastPointRef.current = next
        lastSeenRef.current = now
        pointsRef.current.push(next)
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) setError('위치 권한이 거부되었습니다. 브라우저 설정을 확인해주세요.')
        else if (err.code === err.POSITION_UNAVAILABLE) setError('GPS 위치를 확인할 수 없습니다.')
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    )
    timerRef.current = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)

    return stopWatch
  }, [status])

  const finish = async () => {
    if (pointsRef.current.length < 2) {
      setError('저장할 GPS 좌표가 부족합니다. 조금 더 이동한 뒤 다시 시도해주세요.')
      return
    }
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current)
      watchRef.current = null
    }
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    setStatus('saving')
    setError('')
    const endedAt = Date.now()
    const duration = Math.max(1, Math.floor((endedAt - startRef.current) / 1000))
    try {
      const res = await fetch('/construction/bike-rides/gps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          place_name: place.name,
          points: pointsRef.current,
          started_at_ms: startRef.current,
          ended_at_ms: endedAt,
          duration_sec: duration,
          memo,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '기록 저장에 실패했습니다.')
        setStatus('recording')
        return
      }
      setSavedMessage(`${(Number(data?.ride?.distance_m || 0) / 1000).toFixed(1)}km · ${fmtDuration(Number(data?.ride?.duration_sec || duration))} 기록 저장 완료`)
      setStatus('saved')
      onSaved?.()
    } catch {
      setError('기록 저장에 실패했습니다.')
      setStatus('recording')
    }
  }

  const cancel = () => {
    if (pointsRef.current.length > 1 && !window.confirm('저장하지 않고 주행 기록을 취소할까요?')) return
    onClose()
  }

  const avg = elapsed > 0 ? (distance / 1000) / (elapsed / 3600) : 0

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 6000, maxWidth: 520, margin: '0 auto' }}>
      <div className="card border-0 shadow-lg" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="fw-bold small">🚴 실제 주행 기록</div>
            <span className={`badge ${status === 'saved' ? 'bg-success' : status === 'saving' ? 'bg-secondary' : 'bg-danger'}`}>
              {status === 'saved' ? '저장 완료' : status === 'saving' ? '저장 중' : '기록 중'}
            </span>
          </div>
          <div className="small text-muted mb-2">{place.name}</div>
          <div className="d-flex justify-content-around text-center mb-2">
            <div><div className="text-muted" style={{ fontSize: '0.72rem' }}>거리</div><div className="fw-bold">{(distance / 1000).toFixed(2)}km</div></div>
            <div><div className="text-muted" style={{ fontSize: '0.72rem' }}>시간</div><div className="fw-bold">{fmtDuration(elapsed)}</div></div>
            <div><div className="text-muted" style={{ fontSize: '0.72rem' }}>평균</div><div className="fw-bold">{avg.toFixed(1)}km/h</div></div>
          </div>
          {error && <div className="alert alert-warning py-1 px-2 small mb-2">{error}</div>}
          {status === 'saved' ? (
            <>
              <div className="small text-success mb-2">{savedMessage}</div>
              <button className="btn btn-sm btn-success w-100" onClick={onClose}>닫기</button>
            </>
          ) : (
            <>
              <div className="small text-muted mb-2" style={{ fontSize: '0.72rem' }}>화면을 켜 둔 상태에서 기록됩니다. 앱을 닫거나 화면을 끄면 기록이 중단될 수 있어요.</div>
              <input
                className="form-control form-control-sm mb-2"
                placeholder="주행 메모 (선택)"
                value={memo}
                onChange={e => setMemo(e.target.value)}
                maxLength={200}
                disabled={status === 'saving'}
              />
              <div className="d-flex gap-2">
                <button className="btn btn-sm btn-outline-secondary flex-fill" onClick={cancel} disabled={status === 'saving'}>취소</button>
                <button className="btn btn-sm btn-success flex-fill" onClick={finish} disabled={status === 'saving'}>
                  {status === 'saving' ? '저장 중...' : '기록 저장'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
