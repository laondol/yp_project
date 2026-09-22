import { useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import LeafletMap from '../components/LeafletMap'
import { offlineQueue, MAX_OFFLINE_FILES, MAX_QUEUE_FILES, type OfflineFile, type OfflineItem } from '../utils/offlineQueue'

export default function ShareReport({ yardEventId: propEventId, yardEventTitle: propEventTitle, yardEventCategory: propEventCategory, onBack }: { yardEventId?: string | null; yardEventTitle?: string; yardEventCategory?: string; onBack?: () => void } = {}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [locationStatus, setLocationStatus] = useState('위치 수집 중... (브라우저 권한 허용 필요)')
  const [addressDetail, setAddressDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cameraReady, setCameraReady] = useState(true)
  const [previews, setPreviews] = useState<(string | null)[]>([])
  // 카메라로 찍은 사진 여러 장 누적 (연속 촬영 지원)
  const [cameraFiles, setCameraFiles] = useState<File[]>([])
  const [cameraPreviews, setCameraPreviews] = useState<string[]>([])
  // 카메라 사진별 서버 저장 경로 (auto-save 성공 시 채워짐)
  const [cameraPaths, setCameraPaths] = useState<string[]>([])
  const [videoPreview, setVideoPreview] = useState<string | null>(null)
  const [canvasVisible, setCanvasVisible] = useState(false)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoFileUpload, setVideoFileUpload] = useState<File | null>(null)
  const [videoUploadPreview, setVideoUploadPreview] = useState<string | null>(null)
  const [hasContent, setHasContent] = useState(false)
  // 오프라인 큐
  const [online, setOnline] = useState<boolean>(navigator.onLine)
  const [queueCount, setQueueCount] = useState(0)
  const syncingRef = useRef(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoFileInputRef = useRef<HTMLInputElement>(null)
  const drawingRef = useRef(false)
  const reportIdRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  const [searchParams] = useSearchParams()
  const yardEventId = propEventId != null ? propEventId : searchParams.get('yard_event')
  const yardEventTitle = propEventTitle != null ? propEventTitle : (searchParams.get('title') || '')

  useEffect(() => {
    if (yardEventId && yardEventTitle) {
      const cat = propEventCategory === 'village' ? '마을후기' : '행사후기'
      setTitle(`[${cat}] ${decodeURIComponent(yardEventTitle)} 후기`)
      setDescription(`${decodeURIComponent(yardEventTitle)}에 다녀오신 후기를 남겨주세요.`)
    }
  }, [yardEventId, yardEventTitle, propEventCategory])

  useEffect(() => {
    getLocation()
    checkCamera()
  }, [])

  // ── 오프라인 큐: 대기 건수 갱신 + 재연결 시 자동 전송 ──
  async function refreshQueueCount() {
    try { setQueueCount(await offlineQueue.count()) } catch { /* 무시 */ }
  }

  // Background Sync 등록 (Android: 앱이 닫혀 있어도 SW가 전송 / 미지원 브라우저는 페이지 폴백)
  async function registerSync() {
    try {
      const reg: any = await navigator.serviceWorker.ready
      if (reg.sync && typeof reg.sync.register === 'function') await reg.sync.register('yp-share-sync')
    } catch { /* 미지원 무시 */ }
  }

  async function syncQueue() {
    if (!navigator.onLine || syncingRef.current) return
    syncingRef.current = true
    try {
      const items = await offlineQueue.all()
      for (const it of items) {
        try {
          let rid = it.reportId
          if (it.files.length > 0) {
            const fd = new FormData()
            if (rid) fd.append('report_id', String(rid))
            for (const f of it.files) {
              const bf = new File([f.blob], f.name || `offline_${Date.now()}`, { type: f.blob.type || 'application/octet-stream' })
              if (f.kind === 'video') fd.append('video', bf)
              else fd.append('image', bf)
            }
            const res = await fetch('/share-report/auto-save', { method: 'POST', body: fd })
            const data = await res.json()
            if (data.status !== 'success') throw new Error(data.msg || '자동보관 실패')
            rid = data.report_id
            it.reportId = rid
            it.files = []
            await offlineQueue.put(it)
          }
          if (rid) {
            const fd = new FormData()
            fd.append('title', it.title)
            fd.append('description', it.description)
            if (it.yardEventId) fd.append('yard_event_id', it.yardEventId)
            if (it.yardEventCategory) fd.append('yard_event_category', it.yardEventCategory)
            if (it.lat && it.lon) { fd.append('latitude', it.lat); fd.append('longitude', it.lon) }
            if (it.drawing && it.drawing.length > 2000) fd.append('drawing_data', it.drawing)
            const res2 = await fetch(`/share-report/confirm-auto/${rid}`, { method: 'POST', body: fd })
            const d2 = await res2.json()
            if (d2.status !== 'success') throw new Error(d2.msg || '접수 실패')
            await offlineQueue.remove(it.key)
          } else {
            // 파일도 draft도 없는 텍스트 전용 건
            const fd = new FormData()
            fd.append('title', it.title)
            fd.append('description', it.description)
            if (it.yardEventId) fd.append('yard_event_id', it.yardEventId)
            if (it.yardEventCategory) fd.append('yard_event_category', it.yardEventCategory)
            if (it.lat && it.lon) { fd.append('latitude', it.lat); fd.append('longitude', it.lon) }
            const res3 = await fetch('/share-report', { method: 'POST', body: fd })
            const d3 = await res3.json()
            if (d3.status !== 'success') throw new Error(d3.msg || '접수 실패')
            await offlineQueue.remove(it.key)
          }
        } catch (e: any) {
          const msg = String(e?.message || e || '')
          it.attempts = (it.attempts || 0) + 1
          it.lastError = msg
          try { await offlineQueue.put(it) } catch { /* 무시 */ }
          if (msg.includes('로그인')) break
        }
      }
    } catch { /* 무시 */ }
    syncingRef.current = false
    refreshQueueCount()
  }

  useEffect(() => {
    refreshQueueCount()
    if (navigator.onLine) { syncQueue(); registerSync() }
    const onOn = () => { setOnline(true); syncQueue(); registerSync() }
    const onOff = () => setOnline(false)
    window.addEventListener('online', onOn)
    window.addEventListener('offline', onOff)
    // SW 백그라운드 전송 완료 알림 수신
    navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
      if ((e.data as any)?.type === 'yp-sync-done') refreshQueueCount()
    })
    return () => { window.removeEventListener('online', onOn); window.removeEventListener('offline', onOff) }
  }, [])

  useEffect(() => {
    if (canvasVisible) setTimeout(initCanvas, 100)
  }, [canvasVisible])

  function getLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('이 브라우저는 위치정보를 지원하지 않아 접수할 수 없습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lt = pos.coords.latitude.toFixed(7)
        const ln = pos.coords.longitude.toFixed(7)
        setLat(lt)
        setLon(ln)
        setLocationStatus('주소 변환 중...')
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lt}&lon=${ln}&accept-language=ko`)
          .then(r => r.json())
          .then(data => {
            const addr = data.display_name || ''
            const parts = addr.split(',').map((s: string) => s.trim())
            const short = parts.slice(0, 5).join(', ')
            setAddressDetail(short || addr)
          })
          .catch(() => {
            setAddressDetail('위치 수집 완료')
          })
      },
      err => {
        setLocationStatus('위치 수집 실패로 접수할 수 없습니다. 위치 권한을 허용한 뒤 새로고침해 주세요. (' + err.message + ')')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  function checkCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraReady(false)
      return
    }
    navigator.mediaDevices.getUserMedia({ video: true })
      .then(stream => stream.getTracks().forEach(t => t.stop()))
      .catch(() => setCameraReady(false))
  }

  // 자동보관: 촬영된 파일을 즉시 서버(draft)로 전송
  // 연속 촬영 시에도 같은 report_id로 누적되도록 순차(직렬) 실행한다.
  async function autoSave(files: File[]) {
    const task = saveQueueRef.current.then(async () => {
      const fd = new FormData()
      if (reportIdRef.current) fd.append('report_id', String(reportIdRef.current))
      for (const f of files) fd.append('image', f)
      const res = await fetch('/share-report/auto-save', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        reportIdRef.current = data.report_id
        return data.added_paths as string[]
      }
      return null
    }).catch(() => null)
    saveQueueRef.current = task.catch(() => undefined)
    return task
  }

  function onCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    const arr = Array.from(files)
    setCameraFiles(prev => [...prev, ...arr])
    setCameraPreviews(prev => [...prev, ...arr.map(f => URL.createObjectURL(f))])
    setHasContent(true)
    e.target.value = ''
    if (!navigator.onLine) return // 오프라인: 기기에만 보관, 연결 시 자동 전송
    // 즉시 자동보관. 실패 시 해당 사진은 제거 안내
    autoSave(arr).then(paths => {
      if (!paths || paths.length === 0) {
        alert('자동보관에 실패했습니다. 네트워크 확인 후 다시 촬영해 주세요.')
        setCameraFiles(prev => prev.slice(0, prev.length - arr.length))
        setCameraPreviews(prev => prev.slice(0, prev.length - arr.length))
      } else {
        setCameraPaths(prev => [...prev, ...paths])
      }
    })
  }

  async function removeCameraPhoto(i: number) {
    const path = cameraPaths[i]
    if (path && reportIdRef.current) {
      try {
        await fetch(`/share-report/auto-save/remove/${reportIdRef.current}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path })
        })
      } catch { /* 무시 */ }
    }
    setCameraFiles(prev => prev.filter((_, idx) => idx !== i))
    setCameraPreviews(prev => prev.filter((_, idx) => idx !== i))
    setCameraPaths(prev => prev.filter((_, idx) => idx !== i))
    const remaining = cameraFiles
      .filter((_, idx) => idx !== i)
    setHasContent(remaining.length > 0 || videoFile !== null || videoFileUpload !== null || previews.length > 0)
  }

  function onVideoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!navigator.onLine) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 인터넷 연결 후 이용해 주세요.'); e.target.value = ''; return }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
    setHasContent(true)
    e.target.value = ''
    // 동영상 즉시 자동보관
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      const fd = new FormData()
      if (reportIdRef.current) fd.append('report_id', String(reportIdRef.current))
      fd.append('video', file)
      const res = await fetch('/share-report/auto-save', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') reportIdRef.current = data.report_id
    }).catch(() => {})
  }

  function onVideoFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!navigator.onLine) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 인터넷 연결 후 이용해 주세요.'); e.target.value = ''; return }
    setVideoFileUpload(file)
    setVideoUploadPreview(URL.createObjectURL(file))
    setHasContent(true)
    const fd = new FormData()
    if (reportIdRef.current) fd.append('report_id', String(reportIdRef.current))
    fd.append('video', file)
    fetch('/share-report/auto-save', { method: 'POST', body: fd })
      .then(r => r.json())
      .then(data => { if (data.status === 'success') reportIdRef.current = data.report_id })
      .catch(() => {})
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    const arr = Array.from(files)
    setHasContent(true)
    const urls: (string | null)[] = []
    for (const f of arr) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      if (f.type.startsWith('image/') && !['heic', 'heif'].includes(ext)) {
        urls.push(URL.createObjectURL(f))
      } else if (['heic', 'heif'].includes(ext)) {
        urls.push(null)
      }
    }
    setPreviews(urls)
    setCameraFiles(prev => [...prev, ...arr])
    if (!navigator.onLine) { e.target.value = ''; return } // 오프라인: 기기에만 보관
    autoSave(arr).then(paths => {
      if (!paths || paths.length === 0) {
        alert('자동보관에 실패했습니다. 네트워크 확인 후 다시 시도해 주세요.')
        setCameraFiles(prev => prev.slice(0, prev.length - arr.length))
        setPreviews([])
      } else {
        setCameraPaths(prev => [...prev, ...paths])
      }
    })
    e.target.value = ''
  }

  function initCanvas() {
    const c = canvasRef.current
    if (!c) return
    const rect = c.parentElement?.getBoundingClientRect()
    c.width = rect ? rect.width : 400
    c.height = 300
    const ctx = c.getContext('2d')
    if (!ctx) return

    function getPos(e: any) { const r = c!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

    const onStart = (e: any) => {
      drawingRef.current = true
      const p = getPos(e.touches ? e.touches[0] : e)
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
      setHasContent(true)
    }
    const onMove = (e: any) => {
      if (!drawingRef.current) return
      const p = getPos(e.touches ? e.touches[0] : e)
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#333'
      ctx.lineTo(p.x, p.y); ctx.stroke(); ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }
    const onEnd = () => { drawingRef.current = false; ctx.beginPath(); saveDrawing() }
    function saveDrawing() {
      const c2 = canvasRef.current
      if (!c2) return
      const dataUrl = c2.toDataURL('image/png')
      if (dataUrl.length <= 2000) return
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        const fd = new FormData()
        if (reportIdRef.current) fd.append('report_id', String(reportIdRef.current))
        fd.append('drawing_data', dataUrl)
const res = await fetch('/share-report/auto-save', { method: 'POST', body: fd, credentials: 'include' })
        const data = await res.json()
        if (data.status === 'success') reportIdRef.current = data.report_id
      }).catch(() => {})
    }

    c.addEventListener('mousedown', onStart)
    c.addEventListener('mousemove', onMove)
    c.addEventListener('mouseup', onEnd)
    c.addEventListener('mouseleave', onEnd)
    c.addEventListener('touchstart', onStart, { passive: false })
    c.addEventListener('touchmove', onMove, { passive: false })
    c.addEventListener('touchend', onEnd)
  }

  function clearCanvas() {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d')?.clearRect(0, 0, c.width, c.height)
  }

  function resetForm() {
    setTitle(''); setDescription('')
    setCameraFiles([]); setCameraPreviews([]); setCameraPaths([])
    setPreviews([])
    setVideoFile(null); setVideoPreview(null); setVideoFileUpload(null); setVideoUploadPreview(null)
    setHasContent(false); setSubmitting(false)
    reportIdRef.current = null
    clearCanvas()
  }

  async function postSubmit() {
    if (!hasContent && !title.trim() && !description.trim()) {
      alert('내용을 입력하거나 사진/파일을 선택해 주세요.')
      return
    }
    // ── 오프라인: 기기(IndexedDB)에 저장 후 연결 시 자동 전송 ──
    if (!navigator.onLine) {
      const files: OfflineFile[] = cameraFiles.map(f => ({ kind: 'image' as const, blob: f, name: f.name || `offline_${Date.now()}.jpg` }))
      if (videoFile) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 동영상을 삭제해 주세요.'); return }
      if (videoFileUpload) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 동영상을 삭제해 주세요.'); return }
      if (files.length > MAX_OFFLINE_FILES) {
        alert(`오프라인 저장은 한 번에 최대 ${MAX_OFFLINE_FILES}장까지 가능합니다. (현재 ${files.length}장)`)
        return
      }
      const queuedFiles = await offlineQueue.totalFiles()
      if (queuedFiles + files.length > MAX_QUEUE_FILES) {
        alert(`오프라인 대기 사진은 총 ${MAX_QUEUE_FILES}장까지 저장됩니다. 인터넷 연결 후 전송을 완료해 주세요.`)
        return
      }
      const c0 = canvasRef.current
      const drawing = c0 ? c0.toDataURL('image/png') : null
      const item: OfflineItem = {
        key: offlineQueue.newKey(),
        reportId: reportIdRef.current,
        files,
        drawing: drawing && drawing.length > 2000 ? drawing : null,
        title, description, lat, lon,
        yardEventId: yardEventId || null,
        yardEventCategory: propEventCategory || null,
        createdAt: new Date().toISOString(),
        attempts: 0,
      }
      try { await offlineQueue.put(item) } catch { alert('기기 저장에 실패했습니다. 저장 공간을 확인해 주세요.'); return }
      await refreshQueueCount()
      registerSync() // 연결 복구 시 SW가 자동 전송 (앱 종료 상태 포함, Android)
      const waiting = await offlineQueue.count()
      alert(`오프라인 상태여서 이 기기에 저장했습니다 (대기 ${waiting}건).\n인터넷에 연결되면 자동으로 전송되어 심사가 시작됩니다.`)
      if (onBack) { onBack(); return }
      resetForm()
      return
    }
    // 사진 촬영 중(서버 저장 미완료)이면 대기 안내
    if (cameraFiles.length > 0 && !reportIdRef.current) {
      alert('사진이 서버에 저장 중입니다. 잠시 후 다시 시도해 주세요.')
      return
    }
    setSubmitting(true)

    const fd = new FormData()
    fd.append('title', title)
    fd.append('description', description)
    if (yardEventId) fd.append('yard_event_id', yardEventId)
    if (propEventCategory) fd.append('yard_event_category', propEventCategory)
    if (lat && lon) {
      fd.append('latitude', lat)
      fd.append('longitude', lon)
    }
    const c = canvasRef.current
    if (c) {
      const dataUrl = c.toDataURL('image/png')
      if (dataUrl.length > 2000) fd.append('drawing_data', dataUrl)
    }

    try {
      let res
      if (reportIdRef.current) {
        res = await fetch(`/share-report/confirm-auto/${reportIdRef.current}`, { method: 'POST', body: fd })
      } else {
        if (!lat || !lon) {
          alert('위치 정보가 없습니다. 위치 허용 후 새로고침해 주세요.')
          setSubmitting(false); return
        }
        res = await fetch('/share-report', { method: 'POST', body: fd })
      }
      const data = await res.json()
      if (data.status === 'success') {
        alert(data.msg)
        if (onBack) { onBack(); return }
        window.location.href = '/share'
      } else {
        alert(data.msg || '오류 발생')
        setSubmitting(false)
      }
    } catch {
      alert('서버 연결 실패: 서버가 응답하지 않습니다.')
      setSubmitting(false)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    postSubmit()
  }

  return (
    <div className="container-fluid px-3 py-3" style={{ maxWidth: '100%' }}>
      {!onBack && <h4 className="fw-bold mb-3 text-center">공유하기</h4>}
      <div className="alert alert-info py-2 small" style={{ borderRadius: 10 }}>
        사진을 촬영하면 즉시 서버에 자동보관됩니다. 내용 확인 후 <b>공유 접수하기</b> 버튼을 누르면 심사가 시작됩니다.
      </div>
      {!online && (
        <div className="alert alert-warning py-2 small mb-2" style={{ borderRadius: 10 }}>
          📴 <b>오프라인</b> — 작성 내용은 이 기기에 저장되며, 인터넷에 연결되면 자동 전송됩니다.<br />
          (동영상 저장 제한 · 사진 1회 최대 {MAX_OFFLINE_FILES}장 / 대기 총 {MAX_QUEUE_FILES}장)
        </div>
      )}
      {queueCount > 0 && (
        <div className="alert alert-secondary py-2 small mb-2" style={{ borderRadius: 10 }}>
          ⏳ 자동전송 대기 <b>{queueCount}</b>건 {online ? '· 전송 준비 중' : '· 오프라인 대기 중'}
        </div>
      )}
      <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <form onSubmit={handleSubmit}>
            <div className="mb-3">
              <div className="row g-2">
                <div className="col-6">
                  <input type="file" ref={cameraInputRef} accept="image/*" capture="environment" onChange={onCameraCapture} style={{ display: 'none' }} />
                  <button type="button" className="btn btn-success w-100 py-3 fw-bold" style={{ borderRadius: 12, fontSize: '1.1rem' }}
                    onClick={() => cameraInputRef.current?.click()} disabled={!cameraReady}>
                    사진촬영
                  </button>
                </div>
                <div className="col-6">
                  <input type="file" ref={videoInputRef} accept="video/*" capture="environment" onChange={onVideoCapture} style={{ display: 'none' }} />
                  <button type="button" className="btn btn-danger w-100 py-3 fw-bold" style={{ borderRadius: 12, fontSize: '1.1rem' }}
                    onClick={() => { if (!online) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다.'); return } videoInputRef.current?.click() }} disabled={!cameraReady}>
                    동영상{!online ? ' (제한)' : ''}
                  </button>
                </div>
              </div>
              {cameraPreviews.length > 0 && (
                <div className="mt-2 d-flex flex-wrap gap-2">
                  {cameraPreviews.map((pv, i) => (
                    <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={pv} style={{ width: 90, height: 90, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                      <button type="button" className="btn btn-sm btn-danger"
                        style={{ position: 'absolute', top: -8, right: -8, borderRadius: '50%', width: 22, height: 22, padding: 0, fontSize: 12, lineHeight: '20px' }}
                        onClick={() => removeCameraPhoto(i)}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {videoPreview && (
                <div className="mt-2 text-center">
                  <video src={videoPreview} controls className="w-100 rounded" style={{ maxHeight: 300 }} />
                  <button type="button" className="btn btn-sm btn-outline-danger mt-1" onClick={() => { setVideoPreview(null); setVideoFile(null); setHasContent(cameraFiles.length > 0 || videoFileUpload !== null || previews.length > 0) }}>삭제</button>
                </div>
              )}
            </div>
            <div className="mb-3">
              <span className="fw-bold small d-block mb-1">동영상 파일 업로드{!online && <span className="text-danger"> (오프라인 제한)</span>}</span>
              <input type="file" ref={videoFileInputRef} className="form-control" accept="video/mp4,video/avi,video/mov,video/mkv,video/webm" onChange={onVideoFileUpload} disabled={!online} />
              {videoUploadPreview && (
                <div className="mt-2 text-center">
                  <video src={videoUploadPreview} controls className="w-100 rounded" style={{ maxHeight: 300 }} />
                  <button type="button" className="btn btn-sm btn-outline-danger mt-1" onClick={() => { setVideoUploadPreview(null); setVideoFileUpload(null); setHasContent(cameraFiles.length > 0 || videoFile !== null || previews.length > 0) }}>삭제</button>
                </div>
              )}
            </div>
            <div className="mb-3">
              <span className="fw-bold small d-block mb-1">파일 업로드</span>
              <input type="file" ref={fileInputRef} className="form-control" accept="image/*,.heic,.heif" multiple onChange={onFileChange} />
              {previews.length > 0 && (
                <div className="mt-2 d-flex flex-wrap gap-1">
                  {previews.map((u, i) => (
                    u ? (
                      <img key={i} src={u} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee' }} />
                    ) : (
                      <div key={i} style={{ width: 80, height: 80, borderRadius: 8, border: '1px solid #eee', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#999' }}>HEIC</div>
                    )
                  ))}
                </div>
              )}
            </div>
            <div className="mb-3">
              <label className="form-label fw-bold small">직접 그리기</label>
              <button type="button" className="btn btn-sm btn-outline-secondary mb-2" onClick={() => setCanvasVisible(!canvasVisible)}>
                그리기 열기/닫기
              </button>
              {canvasVisible && (
                <div>
                  <canvas ref={canvasRef} style={{ border: '1px solid #ccc', background: 'white', cursor: 'crosshair', borderRadius: 12, width: '100%', height: 300 }} />
                  <div className="mt-1">
                    <button type="button" className="btn btn-sm btn-light" onClick={clearCanvas}>지우기</button>
                  </div>
                </div>
              )}
            </div>
            <div className="mb-3">
              <label className="form-label fw-bold small">제목 (선택)</label>
              <input type="text" className="form-control" placeholder="예: 양근리 벚꽃길, 용문산 등산로 풍경" value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-bold small">설명 (선택)</label>
              <textarea className="form-control" rows={3} placeholder="자세한 내용이 있으면 적어주세요." value={description} onChange={e => setDescription(e.target.value)} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-bold small">현재 위치 <span className="text-muted fw-normal">(핀을 드래그하여 보정)</span></label>
              <div className={`mb-2 text-center small ${lat && lon ? 'text-success' : 'text-muted'}`}>{addressDetail || locationStatus}</div>
              {lat && lon && (
                <LeafletMap
                  center={[parseFloat(lat), parseFloat(lon)]}
                  zoom={15}
                  markers={[{ position: [parseFloat(lat), parseFloat(lon)], draggable: true, id: 'main' }]}
                  onMarkerDragEnd={(info) => { setLat(info.lat.toFixed(7)); setLon(info.lng.toFixed(7)) }}
                  style={{ height: 200, borderRadius: 12 }}
                  className="mb-2"
                />
              )}
              <div className="small text-muted text-center">
                {lat && lon ? `${lat}, ${lon}` : ''}
              </div>
            </div>
            <button type="submit" className="btn btn-success w-100 py-3 fw-bold" style={{ borderRadius: 12, fontSize: '1.1rem' }}
              disabled={submitting}>
              {submitting ? '접수 중...' : online ? '공유 접수하기' : '📴 오프라인 저장'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}