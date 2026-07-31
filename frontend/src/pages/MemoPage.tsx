import { useState, useEffect, useCallback, useRef } from 'react'

interface Memo {
  id: number; content: string; author: string
  is_shared: boolean; done: boolean
  end_date?: string; created_at: string; updated_at: string
}

const POSTIT_COLORS = ['#fff9c4', '#f8bbd0', '#c8e6c9', '#bbdefb', '#ffe0b2', '#e1bee7', '#b2ebf2', '#dcedc8']
const POP_SECONDS = 10

export default function MemoPage() {
  const [memos, setMemos] = useState<Memo[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  const [hoveredDone, setHoveredDone] = useState<number | null>(null)
  const [popping, setPopping] = useState<Set<number>>(new Set())
  const doneTimeRef = useRef<Map<number, number>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch('/api/bot/memos', { credentials: 'include' }).then(r => r.json())
      setMemos(d.memos || [])
    } catch {} finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  // 완료 메모 자동 터짐 타이머
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now()
      setMemos(prev => {
        const updated = [...prev]
        let changed = false
        for (const m of updated) {
          if (!m.done) continue
          const doneAt = doneTimeRef.current.get(m.id)
          if (!doneAt) {
            doneTimeRef.current.set(m.id, now)
            continue
          }
          const elapsed = (now - doneAt) / 1000
          if (elapsed >= POP_SECONDS && !popping.has(m.id)) {
            setPopping(p => new Set(p).add(m.id))
            setTimeout(() => {
              fetch(`/api/bot/memos/${m.id}`, { method: 'DELETE', credentials: 'include' })
              setMemos(prev2 => prev2.filter(x => x.id !== m.id))
              doneTimeRef.current.delete(m.id)
              setPopping(p2 => { const s = new Set(p2); s.delete(m.id); return s })
            }, 500)
            changed = true
          }
        }
        return changed ? updated : prev
      })
    }, 500)
    return () => clearInterval(timer)
  }, [popping])

  const handleSubmit = async () => {
    const text = input.trim()
    if (!text) return
    setSending(true)
    try {
      await fetch('/api/bot/memos', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text, author: 'user' })
      })
      setInput('')
      await load()
    } catch {} finally { setSending(false) }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('메모를 삭제하시겠습니까?')) return
    await fetch(`/api/bot/memos/${id}`, { method: 'DELETE', credentials: 'include' })
    setMemos(prev => prev.filter(m => m.id !== id))
    doneTimeRef.current.delete(id)
  }

  const handleToggleDone = async (id: number) => {
    const memo = memos.find(m => m.id === id)
    if (!memo) return
    const newDone = !memo.done
    if (newDone) {
      doneTimeRef.current.set(id, Date.now())
    } else {
      doneTimeRef.current.delete(id)
    }
    setMemos(prev => prev.map(m => m.id === id ? { ...m, done: newDone, updated_at: new Date().toISOString() } : m))
    await fetch(`/api/bot/memos/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: newDone })
    })
  }

  const getRemaining = (id: number) => {
    const doneAt = doneTimeRef.current.get(id)
    if (!doneAt) return POP_SECONDS
    return Math.max(0, POP_SECONDS - (Date.now() - doneAt) / 1000)
  }

  const now = new Date()
  const recentActive = memos.filter(m => {
    if (m.done) return false
    const d = new Date(m.created_at)
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 7
  })
  const recentDone = memos.filter(m => {
    if (!m.done) return false
    const d = new Date(m.created_at)
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) <= 7
  })
  const olderActive = memos.filter(m => {
    if (m.done) return false
    const d = new Date(m.created_at)
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) > 7
  })
  const olderDone = memos.filter(m => {
    if (!m.done) return false
    const d = new Date(m.created_at)
    return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24) > 7
  })

  const allDone = [...recentDone, ...olderDone]

  return (
    <div className="py-3" style={{ maxWidth: 800, margin: '0 auto' }}>
      <h5 className="fw-bold mb-3">📝 메모</h5>

      {/* 입력 */}
      <div className="card border-0 shadow-sm mb-4" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <textarea
            className="form-control border-0"
            style={{ resize: 'none', minHeight: 60, background: '#fff9c4', borderRadius: 12 }}
            placeholder="메모를 입력하세요..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() } }}
            disabled={sending}
          />
          <div className="d-flex justify-content-end mt-2">
            <button className="btn btn-sm btn-warning fw-bold" style={{ borderRadius: 20 }}
              onClick={handleSubmit} disabled={sending || !input.trim()}>
              {sending ? '전송 중...' : '📝 메모 남기기'}
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-muted py-5">불러오는 중...</div>
      ) : memos.length === 0 ? (
        <div className="text-center text-muted py-5">메모가 없습니다</div>
      ) : (
        <div style={{ display: 'flex', gap: 16 }}>
          {/* 왼쪽: 메모 영역 */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* 최근 메모 */}
            {recentActive.length > 0 && (
              <>
                <h6 className="text-muted mb-3">📌 최근 메모</h6>
                <div className="row g-3 mb-4">
                  {recentActive.map((m, i) => (
                    <div key={m.id} className="col-12 col-sm-6">
                      <div
                        className="card border-0 shadow-sm h-100 position-relative"
                        style={{
                          background: POSTIT_COLORS[i % POSTIT_COLORS.length],
                          borderRadius: 4,
                          transform: `rotate(${(i % 3 - 1) * 1.5}deg)`,
                          boxShadow: '2px 3px 8px rgba(0,0,0,0.12)',
                          minHeight: 120,
                        }}
                      >
                        <div className="card-body p-3 d-flex flex-column">
                          <div className="flex-grow-1" style={{ fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.content}
                          </div>
                          <div className="d-flex justify-content-between align-items-center mt-2 pt-2 border-top" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                            <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                              {m.author === 'bot' ? '🤖' : '👤'} {m.created_at?.slice(5, 16).replace('T', ' ')}
                              {m.end_date ? ` · ⏰ ${m.end_date.slice(5, 16).replace('T', ' ')}` : ''}
                            </small>
                            <div className="d-flex align-items-center gap-1">
                              <button
                                className="btn btn-sm p-0 border-0 bg-transparent"
                                style={{ fontSize: '0.8rem', color: '#198754' }}
                                title="완료로 표시"
                                onClick={() => handleToggleDone(m.id)}
                              >☑</button>
                              <button className="btn btn-sm p-0 border-0 bg-transparent text-muted" style={{ fontSize: '0.7rem' }}
                                onClick={() => handleDelete(m.id)}>✕</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 지난 메모 */}
            {olderActive.length > 0 && (
              <>
                <button
                  className="btn btn-outline-secondary btn-sm mb-3 w-100"
                  style={{ borderRadius: 12 }}
                  onClick={() => setShowOlder(!showOlder)}
                >
                  {showOlder ? '📁 지난 메모 접기' : `📁 지난 메모 보기 (${olderActive.length}개)`}
                </button>
                {showOlder && (
                  <div className="row g-3">
                    {olderActive.map((m, i) => (
                      <div key={m.id} className="col-12 col-sm-6">
                        <div
                          className="card border-0 shadow-sm h-100 position-relative"
                          style={{
                            background: POSTIT_COLORS[(i + 3) % POSTIT_COLORS.length],
                            borderRadius: 4,
                            transform: `rotate(${(i % 3 - 1) * 1.2}deg)`,
                            boxShadow: '2px 3px 8px rgba(0,0,0,0.10)',
                            minHeight: 100,
                            opacity: 0.85,
                          }}
                        >
                          <div className="card-body p-3 d-flex flex-column">
                            <div className="flex-grow-1" style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {m.content}
                            </div>
                            <div className="d-flex justify-content-between align-items-center mt-2 pt-2 border-top" style={{ borderColor: 'rgba(0,0,0,0.08)' }}>
                              <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                                {m.author === 'bot' ? '🤖' : '👤'} {m.created_at?.slice(0, 10)}
                                {m.end_date ? ` · ⏰ ${m.end_date.slice(5, 10)}` : ''}
                              </small>
                              <div className="d-flex align-items-center gap-1">
                                <button
                                  className="btn btn-sm p-0 border-0 bg-transparent"
                                  style={{ fontSize: '0.8rem', color: '#198754' }}
                                  title="완료로 표시"
                                  onClick={() => handleToggleDone(m.id)}
                                >☑</button>
                                <button className="btn btn-sm p-0 border-0 bg-transparent text-muted" style={{ fontSize: '0.7rem' }}
                                  onClick={() => handleDelete(m.id)}>✕</button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {recentActive.length === 0 && olderActive.length === 0 && (
              <div className="text-muted text-center py-4">활성 메모가 없습니다</div>
            )}
          </div>

          {/* 오른쪽: 완료된 메모 원형 버튼 - 스크롤 고정 + 자동 터짐 */}
          {allDone.length > 0 && (
            <div style={{
              position: 'sticky', top: 70, alignSelf: 'flex-start',
              width: 48, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            }}>
              {allDone.map((m, i) => {
                const remaining = getRemaining(m.id)
                const isPopping = popping.has(m.id)
                const opacity = Math.max(0.3, remaining / POP_SECONDS)
                return (
                  <div
                    key={m.id}
                    style={{ position: 'relative' }}
                    onMouseEnter={() => setHoveredDone(m.id)}
                    onMouseLeave={() => setHoveredDone(null)}
                  >
                    <div
                      style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: POSTIT_COLORS[i % POSTIT_COLORS.length],
                        border: '2px solid rgba(0,0,0,0.15)',
                        cursor: 'pointer',
                        boxShadow: '1px 2px 4px rgba(0,0,0,0.15)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.65rem', color: '#666',
                        transition: 'transform 0.3s, opacity 0.3s',
                        transform: isPopping
                          ? 'scale(0) rotate(180deg)'
                          : hoveredDone === m.id ? 'scale(1.3)' : 'scale(1)',
                        opacity: isPopping ? 0 : opacity,
                      }}
                      onClick={() => handleToggleDone(m.id)}
                      title={`${Math.ceil(remaining)}초 후 사라짐 (클릭하면 복원)`}
                    >
                      {Math.ceil(remaining)}
                    </div>
                    {/* 툴팁 */}
                    {hoveredDone === m.id && !isPopping && (
                      <div
                        style={{
                          position: 'absolute', right: 44, top: '50%', transform: 'translateY(-50%)',
                          background: '#fff', border: '1px solid #ddd', borderRadius: 8,
                          padding: '8px 12px', fontSize: '0.8rem', whiteSpace: 'pre-wrap',
                          boxShadow: '2px 4px 12px rgba(0,0,0,0.15)',
                          maxWidth: 260, zIndex: 10, wordBreak: 'break-word',
                        }}
                      >
                        <div style={{ marginBottom: 4 }}>{m.content}</div>
                        <div className="text-muted" style={{ fontSize: '0.6rem' }}>
                          {m.created_at?.slice(0, 10)} · {Math.ceil(remaining)}초 후 사라짐
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
