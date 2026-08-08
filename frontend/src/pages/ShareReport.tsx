import { useRef, useState, useEffect } from 'react'

export default function ShareReport() {
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
  const [leafletReady, setLeafletReady] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const videoFileInputRef = useRef<HTMLInputElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const drawingRef = useRef(false)
  const reportIdRef = useRef<number | null>(null)
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    loadLeaflet()
    getLocation()
    checkCamera()
  }, [])

  useEffect(() => {
    if (canvasVisible) setTimeout(initCanvas, 100)
  }, [canvasVisible])

  useEffect(() => {
    if (!lat || !lon || !leafletReady) return
    const L = (window as any).L
    if (!L || !mapRef.current) return
    const lt = parseFloat(lat); const ln = parseFloat(lon)
    if (isNaN(lt) || isNaN(ln)) return
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([lt, ln], 15)
      return
    }
    mapInstanceRef.current = L.map(mapRef.current).setView([lt, ln], 15)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapInstanceRef.current)
    const marker = L.marker([lt, ln], { draggable: true }).addTo(mapInstanceRef.current)
    marker.on('dragend', (e: any) => {
      const pos = e.target.getLatLng()
      setLat(pos.lat.toFixed(7))
      setLon(pos.lng.toFixed(7))
    })
    setTimeout(() => mapInstanceRef.current?.invalidateSize(), 300)
  }, [lat, lon, leafletReady])

  function loadLeaflet() {
    if (document.getElementById('leaflet-css')) return
    const link = document.createElement('link')
    link.id = 'leaflet-css'; link.rel = 'stylesheet'
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
    script.onload = () => { setLeafletReady(true) }
    document.head.appendChild(script)
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
    setHasContent(true)
    const urls: (string | null)[] = []
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() || ''
      if (f.type.startsWith('image/') && !['heic', 'heif'].includes(ext)) {
        urls.push(URL.createObjectURL(f))
      } else if (['heic', 'heif'].includes(ext)) {
        urls.push(null)  // HEIC placeholder
      }
    }
    setPreviews(urls)
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

  async function postSubmit() {
    if (!hasContent) {
      alert('촬영 또는 파일을 먼저 선택해 주세요.')
      return
    }
    if (!reportIdRef.current) {
      alert('자동보관이 되지 않아 접수할 수 없습니다. 다시 시도해 주세요.')
      return
    }
    setSubmitting(true)

    const fd = new FormData()
    fd.append('title', title)
    fd.append('description', description)
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
      const res = await fetch(`/share-report/confirm-auto/${reportIdRef.current}`, { method: 'POST', body: fd })
      const data = await res.json()
      if (data.status === 'success') {
        alert(data.msg)
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
      <h4 className="fw-bold mb-3 text-center">공유하기</h4>
      <div className="alert alert-info py-2 small" style={{ borderRadius: 10 }}>
        사진을 촬영하면 즉시 서버에 자동보관됩니다. 내용 확인 후 <b>공유 접수하기</b> 버튼을 누르면 심사가 시작됩니다.
      </div>
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
                    onClick={() => videoInputRef.current?.click()} disabled={!cameraReady}>
                    동영상
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
              <span className="fw-bold small d-block mb-1">동영상 파일 업로드</span>
              <input type="file" ref={videoFileInputRef} className="form-control" accept="video/mp4,video/avi,video/mov,video/mkv,video/webm" onChange={onVideoFileUpload} />
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
              <div ref={mapRef} style={{ height: 200, borderRadius: 12, display: lat && lon ? 'block' : 'none' }} className="mb-2" />
              <div className="small text-muted text-center">
                {lat && lon ? `${lat}, ${lon}` : ''}
              </div>
            </div>
            <button type="submit" className="btn btn-success w-100 py-3 fw-bold" style={{ borderRadius: 12, fontSize: '1.1rem' }}
              disabled={submitting}>
              {submitting ? '접수 중...' : '공유 접수하기'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}