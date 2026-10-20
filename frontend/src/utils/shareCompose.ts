const DB_NAME = 'yp-share-compose'
const STORE = 'compose'
const KEY = 'current'

export interface ComposeFiles {
  images: File[]
  video: File | null
  drawing: string | null
}

export interface ComposeFields {
  title: string
  description: string
  mealNote: string
  storeName: string
  ssid: string
  lat: string
  lon: string
}

interface ComposeData {
  files?: ComposeFiles
  fields?: ComposeFields
}

function openDb(): Promise<IDBDatabase> {
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

async function read(): Promise<ComposeData | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve(req.result?.value as ComposeData | undefined)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

async function write(fn: (cur: ComposeData) => void): Promise<void> {
  const db = await openDb()
  const t = db.transaction(STORE, 'readwrite')
  const store = t.objectStore(STORE)
  const req = store.get(KEY)
  req.onsuccess = () => {
    const cur: ComposeData = req.result?.value || {}
    fn(cur)
    store.put({ key: KEY, value: cur })
  }
  return new Promise((resolve, reject) => {
    t.oncomplete = () => { db.close(); resolve() }
    t.onerror = () => { db.close(); reject(t.error) }
  })
}

export const shareCompose = {
  async load(): Promise<ComposeData | undefined> {
    try { return await read() } catch { return undefined }
  },
  async saveFiles(files: ComposeFiles): Promise<void> {
    try { await write(cur => { cur.files = files }) } catch { /* 저장 공간 부족 등 무시 */ }
  },
  async saveFields(fields: ComposeFields): Promise<void> {
    try { await write(cur => { cur.fields = fields }) } catch { /* 무시 */ }
  },
  async clear(): Promise<void> {
    try {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite')
        t.objectStore(STORE).delete(KEY)
        t.oncomplete = () => { db.close(); resolve() }
        t.onerror = () => { db.close(); reject(t.error) }
      })
    } catch { /* 무시 */ }
  },
}
