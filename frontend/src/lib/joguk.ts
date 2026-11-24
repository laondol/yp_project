export async function jget<T = any>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include', cache: 'no-store' })
  return r.json()
}

export async function jpost<T = any>(path: string, data?: any): Promise<T> {
  const r = await fetch(path, {
    method: 'POST', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  })
  return r.json()
}

export async function jput<T = any>(path: string, data?: any): Promise<T> {
  const r = await fetch(path, {
    method: 'PUT', credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data || {}),
  })
  return r.json()
}

export async function jdel<T = any>(path: string): Promise<T> {
  const r = await fetch(path, { method: 'DELETE', credentials: 'include', cache: 'no-store' })
  return r.json()
}

export async function jform<T = any>(path: string, fd: FormData): Promise<T> {
  const r = await fetch(path, { method: 'POST', credentials: 'include', body: fd })
  return r.json()
}
