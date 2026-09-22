/* 함께사는양평 — 공유마당 오프라인 대기열 백그라운드 전송 (2단계)
 * - fetch 핸들러 없음: 캐싱/프록시 간섭 없이 Background Sync 전용
 * - Android Chrome: 앱이 닫혀 있어도 연결 복구 시 sync 이벤트로 자동 전송
 * - 미지원 브라우저(iOS 등): 페이지의 syncQueue()가 폴백 처리
 */
const DB_NAME = 'yp-offline-share'
const STORE = 'queue'
const SYNC_TAG = 'yp-share-sync'

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function dbAll(db) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

function dbPut(db, item) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).put(item)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

function dbDelete(db, key) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).delete(key)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

async function notifyClients(payload) {
  try {
    const cs = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
    for (const c of cs) c.postMessage(payload)
  } catch (e) { /* 무시 */ }
}

async function syncQueue() {
  const db = await openDb()
  let items = await dbAll(db)
  items.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
  for (const it of items) {
    try {
      let rid = it.reportId || null
      if (it.files && it.files.length > 0) {
        const fd = new FormData()
        if (rid) fd.append('report_id', String(rid))
        for (const f of it.files) {
          const bf = new File([f.blob], f.name || `offline_${Date.now()}`, { type: f.blob && f.blob.type || 'application/octet-stream' })
          fd.append(f.kind === 'video' ? 'video' : 'image', bf)
        }
        const res = await fetch('/share-report/auto-save', { method: 'POST', body: fd, credentials: 'include' })
        const data = await res.json()
        if (data.status !== 'success') throw new Error(data.msg || '자동보관 실패')
        rid = data.report_id
        it.reportId = rid
        it.files = []
        await dbPut(db, it)
      }
      if (rid) {
        const fd = new FormData()
        fd.append('title', it.title || '')
        fd.append('description', it.description || '')
        if (it.yardEventId) fd.append('yard_event_id', it.yardEventId)
        if (it.yardEventCategory) fd.append('yard_event_category', it.yardEventCategory)
        if (it.lat && it.lon) { fd.append('latitude', it.lat); fd.append('longitude', it.lon) }
        if (it.drawing && it.drawing.length > 2000) fd.append('drawing_data', it.drawing)
        const res2 = await fetch(`/share-report/confirm-auto/${rid}`, { method: 'POST', body: fd, credentials: 'include' })
        const d2 = await res2.json()
        if (d2.status !== 'success') throw new Error(d2.msg || '접수 실패')
        await dbDelete(db, it.key)
      } else {
        const fd = new FormData()
        fd.append('title', it.title || '')
        fd.append('description', it.description || '')
        if (it.yardEventId) fd.append('yard_event_id', it.yardEventId)
        if (it.yardEventCategory) fd.append('yard_event_category', it.yardEventCategory)
        if (it.lat && it.lon) { fd.append('latitude', it.lat); fd.append('longitude', it.lon) }
        const res3 = await fetch('/share-report', { method: 'POST', body: fd, credentials: 'include' })
        const d3 = await res3.json()
        if (d3.status !== 'success') throw new Error(d3.msg || '접수 실패')
        await dbDelete(db, it.key)
      }
    } catch (e) {
      const msg = String((e && e.message) || e || '')
      it.attempts = (it.attempts || 0) + 1
      it.lastError = msg
      try { await dbPut(db, it) } catch (e2) { /* 무시 */ }
      if (msg.includes('로그인')) break // 재로그인 필요 — 나머지 보존
    }
  }
  const remain = (await dbAll(db)).length
  await notifyClients({ type: 'yp-sync-done', remaining: remain })
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(syncQueue())
  }
})

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
