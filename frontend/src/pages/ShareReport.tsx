import { useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import LeafletMap from '../components/LeafletMap'
import ContentEditor, { type ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import { offlineQueue, MAX_OFFLINE_FILES, MAX_QUEUE_FILES, type OfflineFile, type OfflineItem } from '../utils/offlineQueue'
import { shareCompose } from '../utils/shareCompose'
import { useAuth } from '../contexts/AuthContext'

export default function ShareReport({ yardEventId: propEventId, yardEventTitle: propEventTitle, yardEventCategory: propEventCategory, onBack }: { yardEventId?: string | null; yardEventTitle?: string; yardEventCategory?: string; onBack?: () => void } = {}) {
  const { user } = useAuth()
  const isGuest = !user || !user.id
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [mealNote, setMealNote] = useState('')
  const [storeName, setStoreName] = useState('')
  const [nearbyPlaces, setNearbyPlaces] = useState<any[]>([])
  const [ssid, setSsid] = useState('')
  const [locationStatus, setLocationStatus] = useState('위치 수집 중... (브라우저 권한 허용 필요)')
  const [addressDetail, setAddressDetail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [cameraReady, setCameraReady] = useState(true)
  const [previews, setPreviews] = useState<(string | null)[]>([])
  // 카메라로 찍은 사진 여러 장 누적 (연속 촬영 지원)
  const [cameraFiles, setCameraFiles] = useState<File[]>([])
  const [cameraPreviews, setCameraPreviews] = useState<string[]>([])
  // 직접 그리기 결과 (캔버스를 닫아도 유지)
  const [drawingData, setDrawingData] = useState<string | null>(null)
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
  const editorRef = useRef<ContentEditorHandle>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoFileInputRef = useRef<HTMLInputElement>(null)
  const drawingRef = useRef(false)
  const drawingDataRef = useRef<string | null>(null)
  const composeReadyRef = useRef(false)
  const restoredPosRef = useRef<{ lat: string; lon: string } | null>(null)

  const [searchParams] = useSearchParams()
  const yardEventId = propEventId != null ? propEventId : searchParams.get('yard_event')
  const yardEventTitle = propEventTitle != null ? propEventTitle : (searchParams.get('title') || '')
  const [editorKey, setEditorKey] = useState('share-report')

  useEffect(() => {
    if (yardEventId && yardEventTitle) {
      const cat = propEventCategory === 'village' ? '마을후기' : '행사후기'
      setTitle(`[${cat}] ${decodeURIComponent(yardEventTitle)} 후기`)
      setDescription(`${decodeURIComponent(yardEventTitle)}에 다녀오신 후기를 남겨주세요.`)
      setEditorKey(`yard-${yardEventId}`)
    }
  }, [yardEventId, yardEventTitle, propEventCategory])

  useEffect(() => {
    getLocation()
    checkCamera()
  }, [])

  // ── 작성 중 내용 브라우저 임시저장 복원 (새로고침/이탈 대비) ──
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const saved = await shareCompose.load()
      if (cancelled || !saved) { composeReadyRef.current = true; return }
      const f = saved.fields
      if (f) {
        setTitle(f.title || '')
        if (f.description) setDescription(f.description)
        setMealNote(f.mealNote || '')
        setStoreName(f.storeName || '')
        setSsid(f.ssid || '')
        if (f.lat && f.lon) {
          setLat(f.lat); setLon(f.lon)
          restoredPosRef.current = { lat: f.lat, lon: f.lon }
        }
      }
      const fl = saved.files
      if (fl) {
        if (fl.drawing) { setDrawingData(fl.drawing); drawingDataRef.current = fl.drawing }
        if (fl.images?.length) {
          setCameraFiles(fl.images)
          setCameraPreviews(fl.images.map(file => URL.createObjectURL(file)))
        }
        if (fl.video) {
          setVideoFile(fl.video)
          setVideoPreview(URL.createObjectURL(fl.video))
        }
      }
      if ((f && (f.title || f.description)) || fl?.images?.length || fl?.video || fl?.drawing) setHasContent(true)
      composeReadyRef.current = true
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => { drawingDataRef.current = drawingData }, [drawingData])

  useEffect(() => {
    if (!composeReadyRef.current) return
    const t = setTimeout(() => {
      shareCompose.saveFields({
        title, description: editorRef.current?.getContent() || description,
        mealNote, storeName, ssid, lat, lon,
      })
    }, 600)
    return () => clearTimeout(t)
  }, [title, description, mealNote, storeName, ssid, lat, lon])

  useEffect(() => {
    if (!composeReadyRef.current) return
    shareCompose.saveFiles({ images: cameraFiles, video: videoFile || videoFileUpload, drawing: drawingData })
  }, [cameraFiles, videoFile, videoFileUpload, drawingData])

  useEffect(() => {
    const save = () => {
      if (!composeReadyRef.current) return
      shareCompose.saveFields({
        title, description: editorRef.current?.getContent() || description,
        mealNote, storeName, ssid, lat, lon,
      })
      shareCompose.saveFiles({ images: cameraFiles, video: videoFile || videoFileUpload, drawing: drawingDataRef.current })
    }
    const onHide = () => { if (document.visibilityState === 'hidden') save() }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [title, description, mealNote, storeName, ssid, lat, lon, cameraFiles, videoFile, videoFileUpload])

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
          const fd = new FormData()
          fd.append('title', it.title)
          fd.append('description', it.description)
          if (it.yardEventId) fd.append('yard_event_id', it.yardEventId)
          if (it.yardEventCategory) fd.append('yard_event_category', it.yardEventCategory)
          if (it.lat && it.lon) { fd.append('latitude', it.lat); fd.append('longitude', it.lon) }
          if (it.drawing && it.drawing.length > 2000) fd.append('drawing_data', it.drawing)
          for (const f of it.files) {
            const bf = new File([f.blob], f.name || `offline_${Date.now()}`, { type: f.blob.type || 'application/octet-stream' })
            fd.append(f.kind === 'video' ? 'video' : 'image', bf)
          }
          const res = await fetch('/share-report', { method: 'POST', body: fd })
          const data = await res.json()
          if (data.status !== 'success') throw new Error(data.msg || '접수 실패')
          await offlineQueue.remove(it.key)
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

  function loadPlaceInfo(lt: string, ln: string) {
    setLocationStatus('주소 변환 중...')
    // 근처 장소 로드 (자동 매칭 참고용)
    fetch(`/share/nearby-places?lat=${lt}&lon=${ln}&max_km=1`)
      .then(r => r.json()).then(d => setNearbyPlaces(d.places || [])).catch(() => {})
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
  }

  function getLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('이 브라우저는 위치정보를 지원하지 않아 접수할 수 없습니다.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lt = pos.coords.latitude.toFixed(7)
        const ln = pos.coords.longitude.toFixed(7)
        if (restoredPosRef.current) {
          loadPlaceInfo(restoredPosRef.current.lat, restoredPosRef.current.lon)
          return
        }
        setLat(lt)
        setLon(ln)
        loadPlaceInfo(lt, ln)
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

  function onCameraCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files?.length) return
    const arr = Array.from(files)
    setCameraFiles(prev => [...prev, ...arr])
    setCameraPreviews(prev => [...prev, ...arr.map(f => URL.createObjectURL(f))])
    setHasContent(true)
    e.target.value = ''
  }

  function removeCameraPhoto(i: number) {
    setCameraFiles(prev => prev.filter((_, idx) => idx !== i))
    setCameraPreviews(prev => prev.filter((_, idx) => idx !== i))
    const remaining = cameraFiles.filter((_, idx) => idx !== i)
    setHasContent(remaining.length > 0 || videoFile !== null || videoFileUpload !== null || previews.length > 0 || drawingDataRef.current !== null)
  }

  function onVideoCapture(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!navigator.onLine) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 인터넷 연결 후 이용해 주세요.'); e.target.value = ''; return }
    setVideoFile(file)
    setVideoPreview(URL.createObjectURL(file))
    setHasContent(true)
    e.target.value = ''
  }

  function onVideoFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!navigator.onLine) { alert('오프라인 상태에서는 동영상 저장이 제한됩니다. 인터넷 연결 후 이용해 주세요.'); e.target.value = ''; return }
    setVideoFileUpload(file)
    setVideoUploadPreview(URL.createObjectURL(file))
    setHasContent(true)
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
    if (drawingDataRef.current) {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height) }
      img.src = drawingDataRef.current
    }

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
      setDrawingData(dataUrl)
      drawingDataRef.current = dataUrl
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
    setDrawingData(null)
    drawingDataRef.current = null
  }

  function resetForm() {
    setTitle(''); setDescription('')
    setCameraFiles([]); setCameraPreviews([])
    setPreviews([])
    setVideoFile(null); setVideoPreview(null); setVideoFileUpload(null); setVideoUploadPreview(null)
    setHasContent(false); setSubmitting(false)
    setDrawingData(null); drawingDataRef.current = null
    clearCanvas()
  }

  async function postSubmit() {
    const descHtml = editorRef.current?.getContent() || description
    if (!hasContent && !title.trim() && !descHtml.trim()) {
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
      const drawing = drawingDataRef.current || (c0 ? c0.toDataURL('image/png') : null)
      const item: OfflineItem = {
        key: offlineQueue.newKey(),
        reportId: null,
        files,
        drawing: drawing && drawing.length > 2000 ? drawing : null,
        title, description: descHtml, lat, lon,
        yardEventId: yardEventId || null,
        yardEventCategory: propEventCategory || null,
        createdAt: new Date().toISOString(),
        attempts: 0,
      }
      try { await offlineQueue.put(item) } catch { alert('기기 저장에 실패했습니다. 저장 공간을 확인해 주세요.'); return }
      composeReadyRef.current = false
      await shareCompose.clear()
      await refreshQueueCount()
      registerSync() // 연결 복구 시 SW가 자동 전송 (앱 종료 상태 포함, Android)
      const waiting = await offlineQueue.count()
      alert(`오프라인 상태여서 이 기기에 저장했습니다 (대기 ${waiting}건).\n인터넷에 연결되면 자동으로 전송되어 심사가 시작됩니다.`)
      if (onBack) { onBack(); return }
      resetForm()
      composeReadyRef.current = true
      return
    }
    if (!lat || !lon) {
      alert('위치 정보가 없습니다. 위치 허용 후 새로고침해 주세요.')
      return
    }
    const video = videoFile || videoFileUpload
    const totalBytes = cameraFiles.reduce((n, f) => n + f.size, 0) + (video?.size || 0)
    if (totalBytes > 45 * 1024 * 1024) {
      alert('첨부 용량이 45MB를 넘습니다. 사진/동영상 수를 줄여 주세요. (원본 그대로 전송)')
      return
    }
    setSubmitting(true)

    const fd = new FormData()
    fd.append('title', title)
    fd.append('description', descHtml)
    if (yardEventId) fd.append('yard_event_id', yardEventId)
    if (propEventCategory) fd.append('yard_event_category', propEventCategory)
    fd.append('latitude', lat)
    fd.append('longitude', lon)
    if (mealNote.trim()) fd.append('meal_note', mealNote.trim())
    if (ssid) fd.append('store_suggestion_id', ssid)
    if (storeName.trim()) fd.append('store_name', storeName.trim())
    const drawData = drawingDataRef.current || (canvasRef.current ? canvasRef.current.toDataURL('image/png') : null)
    if (drawData && drawData.length > 2000) fd.append('drawing_data', drawData)
    for (const f of cameraFiles) fd.append('image', f)
    if (video) fd.append('video', video)

    try {
      const res = await fetch('/share-report', { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        composeReadyRef.current = false
        await shareCompose.clear()
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
        촬영·선택한 사진과 내용은 아래 버튼을 누르면 바로 AI 심사가 시작됩니다. (얼굴·번호판 등 개인정보가 포함되면 관리자 확인 후 게시됩니다.)
      </div>
      {!online && (
        <div className="alert alert-warning py-2 small mb-2" style={{ borderRadius: 10 }}>
          📴 <b>오프라인</b> — 작성 내용은 이 기기에 저장되며, 인터넷에 연결되면 자동 전송됩니다.<br />
          (동영상 저장 제한 · 사진 1회 최대 {MAX_OFFLINE_FILES}장 / 대기 총 {MAX_QUEUE_FILES}장)
        </div>
      )}
      {isGuest && (
        <div className="alert alert-secondary py-2 small mb-2" style={{ borderRadius: 10 }}>
          ⚠️ 비회원이 공유하기로 함께사는양평에 보내는 콘텐츠는 그 저작권은 함께사는양평으로 이양한 것입니다.
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
                  <button type="button" className="btn btn-sm btn-outline-danger mt-1" onClick={() => { setVideoPreview(null); setVideoFile(null); setHasContent(cameraFiles.length > 0 || videoFileUpload !== null || previews.length > 0 || drawingDataRef.current !== null) }}>삭제</button>
                </div>
              )}
            </div>
            <div className="mb-3">
              <span className="fw-bold small d-block mb-1">동영상 파일 업로드{!online && <span className="text-danger"> (오프라인 제한)</span>}</span>
              <input type="file" ref={videoFileInputRef} className="form-control" accept="video/mp4,video/avi,video/mov,video/mkv,video/webm" onChange={onVideoFileUpload} disabled={!online} />
              {videoUploadPreview && (
                <div className="mt-2 text-center">
                  <video src={videoUploadPreview} controls className="w-100 rounded" style={{ maxHeight: 300 }} />
                  <button type="button" className="btn btn-sm btn-outline-danger mt-1" onClick={() => { setVideoUploadPreview(null); setVideoFileUpload(null); setHasContent(cameraFiles.length > 0 || videoFile !== null || previews.length > 0 || drawingDataRef.current !== null) }}>삭제</button>
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
              <ContentEditor
                key={editorKey}
                ref={editorRef}
                initialContent={description}
                showLocation={false}
                placeholder="자세한 내용이 있으면 적어주세요. (사진은 Ctrl+V로 붙여넣기 가능)"
              />
            </div>
            {nearbyPlaces.length > 0 && (
              <div className="mb-3">
                <label className="form-label fw-bold small">📍 근처 장소 (선택하면 자동 연결)</label>
                <div className="d-flex flex-wrap gap-1">
                  {nearbyPlaces.map((p: any) => (
                    <button key={p.source + '-' + (p.id ?? p.name)} type="button"
                      className={`btn btn-sm ${ssid === String(p.id || '') && p.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                      style={{ borderRadius: 20, fontSize: 12 }}
                      onClick={() => { if (p.id) { setSsid(String(p.id)); } }}>
                      {p.name} <span className="text-muted">({p.distance_m}m {p.direction})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-3">
              <label className="form-label fw-bold small">가게/시설 이름 <span className="text-muted fw-normal">(선택 — 입력하면 시설 정보가 자동 구성됩니다)</span></label>
              <input type="text" className="form-control" value={storeName} onChange={e => setStoreName(e.target.value)}
                placeholder="예: 라온, 멸치국수, 양근리 카페" maxLength={50} />
            </div>
            <div className="mb-3">
              <label className="form-label fw-bold small">경험 기록 (선택)</label>
              <input type="text" className="form-control" value={mealNote} onChange={e => setMealNote(e.target.value)}
                placeholder="여기서 무엇을 했나요? 예: 라떼 한 잔, 산책, 된장찌개" />
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