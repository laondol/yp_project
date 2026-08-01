import { useState, useEffect, useRef, useCallback } from 'react'

interface Waypoint {
  lat: number; lng: number; name: string; mode?: string; detail?: string
}

interface Props {
  destLat: number
  destLng: number
  destName: string
  waypoints?: Waypoint[]
  onClose?: () => void
}

const METERS_PER_RING = 10
const MIN_RINGS = 3
const ARRIVAL_THRESHOLD = 3
const LS_KEY = 'compass_dest'

export default function CompassNav({ destLat, destLng, destName, waypoints, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [distance, setDistance] = useState(0)
  const [bearing, setBearing] = useState(0)
  const [heading, setHeading] = useState(0)
  const [hasCompass, setHasCompass] = useState(false)
  const [arrived, setArrived] = useState(false)
  const [posError, setPosError] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [stepIndex, setStepIndex] = useState(0)
  const watchId = useRef<number | null>(null)
  const animFrame = useRef<number>(0)
  const seekDoneRef = useRef(false)

  const wp: Waypoint[] = waypoints && waypoints.length > 0
    ? waypoints
    : [{ lat: destLat, lng: destLng, name: destName }]
  const current = wp[Math.min(stepIndex, wp.length - 1)]
  const isLastStep = stepIndex >= wp.length - 1
  const totalSteps = wp.length

  const toRad = (d: number) => d * Math.PI / 180
  const toDeg = (r: number) => r * 180 / Math.PI

  const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }

  const calcBearing = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const dLng = toRad(lng2 - lng1)
    const y = Math.sin(dLng) * Math.cos(toRad(lat2))
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng)
    return (toDeg(Math.atan2(y, x)) + 360) % 360
  }

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      lat: destLat, lng: destLng, name: destName,
      waypoints, stepIndex,
    }))
  }, [destLat, destLng, destName, waypoints, stepIndex])

  useEffect(() => {
    const onLine = () => setIsOnline(true)
    const offLine = () => setIsOnline(false)
    window.addEventListener('online', onLine)
    window.addEventListener('offline', offLine)
    return () => {
      window.removeEventListener('online', onLine)
      window.removeEventListener('offline', offLine)
    }
  }, [])

  useEffect(() => {
    const handleOrientation = (e: DeviceOrientationEvent) => {
      let h = 0
      if (e.alpha !== null) {
        h = (360 - e.alpha) % 360
        setHasCompass(true)
      } else if ((e as any).webkitCompassHeading !== undefined) {
        h = (e as any).webkitCompassHeading
        setHasCompass(true)
      }
      setHeading(h)
    }
    window.addEventListener('deviceorientation', handleOrientation, true)
    return () => window.removeEventListener('deviceorientation', handleOrientation, true)
  }, [])

  const updatePosition = useCallback(() => {
    if (!navigator.geolocation) {
      setPosError('GPS를 사용할 수 없습니다.')
      return
    }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        let target = current

        if (!seekDoneRef.current && wp.length > 1) {
          seekDoneRef.current = true
          let best = 0
          let bestD = Infinity
          wp.forEach((w, i) => {
            const d = haversineDistance(lat, lng, w.lat, w.lng)
            if (d < bestD) { bestD = d; best = i }
          })
          if (best > 0) setStepIndex(best)
          target = wp[best]
        }

        const d = haversineDistance(lat, lng, target.lat, target.lng)
        const b = calcBearing(lat, lng, target.lat, target.lng)
        setDistance(d)
        setBearing(b)
        setPosError('')

        if (d < ARRIVAL_THRESHOLD) {
          if (isLastStep) {
            setArrived(true)
          } else {
            setStepIndex(prev => Math.min(prev + 1, wp.length - 1))
          }
        }
      },
      () => {
        setPosError('GPS를 켜주세요.')
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    )
  }, [current.lat, current.lng, isLastStep, wp.length])

  useEffect(() => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    updatePosition()
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current)
    }
  }, [updatePosition])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = () => {
      const displayW = canvas.offsetWidth
      const displayH = canvas.offsetHeight
      const side = Math.min(displayW, displayH)
      canvas.width = side * 2
      canvas.height = side * 2
      ctx.scale(2, 2)
      const cw = side / 2
      const ch = side / 2
      const maxRadius = Math.min(cw, ch) - 20

      ctx.clearRect(0, 0, side, side)

      const rings = Math.max(MIN_RINGS, Math.ceil(distance / METERS_PER_RING))
      const ringSpacing = maxRadius / rings

      ctx.save()
      ctx.translate(cw, ch)
      ctx.rotate(toRad(-heading))

      for (let i = 1; i <= rings; i++) {
        const r = i * ringSpacing
        const alpha = 0.15 + 0.05 * (i / rings)
        ctx.beginPath()
        ctx.arc(0, 0, r, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0, 123, 255, ${alpha})`
        ctx.lineWidth = 1
        ctx.stroke()
        if (i === 1) {
          ctx.beginPath()
          ctx.arc(0, 0, r, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(0, 123, 255, 0.7)'
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.fillStyle = 'rgba(0, 123, 255, 0.08)'
          ctx.fill()
        }
        if (i % 5 === 0) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
          ctx.font = '10px sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText(`${i * METERS_PER_RING}m`, 0, -r + 12)
        }
      }

      ctx.fillStyle = 'rgba(0, 123, 255, 0.25)'
      ctx.beginPath()
      ctx.arc(0, 0, ringSpacing, 0, Math.PI * 2)
      ctx.fill()

      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.font = '9px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`${METERS_PER_RING}m`, 0, -ringSpacing - 2)

      const destAngle = toRad(bearing - heading)
      const dx = Math.sin(destAngle) * maxRadius
      const dy = -Math.cos(destAngle) * maxRadius

      const markerColor = isLastStep ? '#dc3545' : '#ffc107'
      ctx.beginPath()
      ctx.arc(dx, dy, 10, 0, Math.PI * 2)
      ctx.fillStyle = markerColor
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(isLastStep ? '★' : `${stepIndex + 1}`, dx, dy)

      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(formatDistance(distance), dx, dy + 14)

      ctx.restore()

      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      ctx.font = 'bold 11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('N', cw, ch - maxRadius - 6)

      ctx.strokeStyle = 'rgba(0, 123, 255, 0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(cw, ch - 18)
      ctx.lineTo(cw, ch - 6)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cw, ch - 18)
      ctx.lineTo(cw - 4, ch - 10)
      ctx.moveTo(cw, ch - 18)
      ctx.lineTo(cw + 4, ch - 10)
      ctx.stroke()

      ctx.beginPath()
      ctx.arc(cw, ch, 8, 0, Math.PI * 2)
      ctx.fillStyle = '#007bff'
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.stroke()

      if (!hasCompass) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.font = '12px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('나침반을 활성화해주세요', cw, ch + 30)
      }

      animFrame.current = requestAnimationFrame(draw)
    }

    draw()
    return () => cancelAnimationFrame(animFrame.current)
  }, [distance, bearing, heading, hasCompass, isLastStep, stepIndex])

  const formatDistance = (m: number) => {
    if (m < 1000) return `${Math.round(m)}m`
    return `${(m / 1000).toFixed(1)}km`
  }

  const directionLabel = () => {
    const diff = ((bearing - heading) + 360) % 360
    if (diff < 22.5 || diff >= 337.5) return '직진 ↑'
    if (diff < 67.5) return '우측대각선 ↗'
    if (diff < 112.5) return '우측 →'
    if (diff < 157.5) return '우측후방 ↘'
    if (diff < 202.5) return '후방 ↓'
    if (diff < 247.5) return '좌측후방 ↙'
    if (diff < 292.5) return '좌측 ←'
    return '좌측대각선 ↖'
  }

  if (arrived) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center" style={{ height: '100vh', background: '#e8f5e9' }}>
        <div style={{ fontSize: 64 }}>🎉</div>
        <h3 className="fw-bold mt-3">도착했습니다!</h3>
        <p className="text-muted">{current.name}</p>
        {onClose && <button className="btn btn-sm btn-primary mt-3" onClick={onClose}>닫기</button>}
      </div>
    )
  }

  return (
    <div className="d-flex flex-column" style={{ height: '100vh', background: '#f8f9fa', overflow: 'hidden' }}>
      <div className="d-flex align-items-center justify-content-between p-2 bg-white border-bottom">
        <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>✕</button>
        <div className="text-center">
          {totalSteps > 1 && (
            <div style={{ fontSize: 11, color: '#007bff' }}>
              {stepIndex + 1}/{totalSteps}단계
            </div>
          )}
          <div className="fw-bold" style={{ fontSize: 14 }}>{current.name}</div>
          <div style={{ fontSize: 12, color: '#666' }}>{directionLabel()}</div>
        </div>
        <div className="text-end" style={{ fontSize: 12, color: '#666' }}>
          {formatDistance(distance)}
        </div>
      </div>

      {!isOnline && (
        <div className="text-center py-1" style={{ background: '#fff3cd', fontSize: 12, color: '#856404' }}>
          📡 오프라인 — GPS 나침반은 계속 작동합니다
        </div>
      )}

      {current.detail && (
        <div className="text-center py-1" style={{ background: '#e8f4fd', fontSize: 12, color: '#0c5460' }}>
          {current.mode && <span className="fw-bold me-1">{current.mode}</span>}
          {current.detail}
        </div>
      )}

      <div className="flex-grow-1 d-flex align-items-center justify-content-center position-relative" style={{ aspectRatio: '1 / 1', maxHeight: 'calc(100vh - 180px)' }}>
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {totalSteps > 1 && (
        <div className="bg-white border-top p-2" style={{ fontSize: 11 }}>
          {wp.map((w, i) => (
            <div key={i} className={`d-flex align-items-center gap-1 py-1 ${i === stepIndex ? 'fw-bold text-primary' : i < stepIndex ? 'text-success' : 'text-muted'}`}>
              <span>{i < stepIndex ? '✅' : i === stepIndex ? '🔵' : '⚪'}</span>
              <span>{w.name}</span>
              {w.mode && <span className="ms-auto" style={{ fontSize: 10 }}>{w.mode}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border-top p-2 text-center" style={{ fontSize: 12, color: '#666' }}>
        {posError ? (
          <span className="text-danger">{posError}</span>
        ) : (
          <span>{current.name}까지 {formatDistance(distance)} | 나침반: {hasCompass ? '✓' : '✗'}</span>
        )}
      </div>
    </div>
  )
}
