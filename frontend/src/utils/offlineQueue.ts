const DB_NAME = 'yp-offline-share'
const STORE = 'queue'

export interface OfflineFile { kind: 'image' | 'video'; blob: Blob; name: string }

export interface OfflineItem {
  key: string
  reportId: number | null
  files: OfflineFile[]
  drawing: string | null
  title: string
  description: string
  lat: string
  lon: string
  yardEventId: string | null
  yardEventCategory: string | null
  createdAt: string
  attempts: number
  lastError?: string
}

export const MAX_OFFLINE_FILES = 10
export const MAX_QUEUE_FILES = 30

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

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

function newKey(): string {
  try { return crypto.randomUUID() } catch { return `k${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

export const offlineQueue = {
  newKey,
  async put(item: OfflineItem): Promise<void> { await tx('readwrite', s => s.put(item)) },
  async all(): Promise<OfflineItem[]> {
    const items = await tx<OfflineItem[]>('readonly', s => s.getAll())
    return (items || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  },
  async remove(key: string): Promise<void> { await tx('readwrite', s => s.delete(key)) },
  async count(): Promise<number> {
    const all = await this.all()
    return all.length
  },
  async totalFiles(): Promise<number> {
    const all = await this.all()
    return all.reduce((n, it) => n + (it.files?.length || 0), 0)
  },
}
