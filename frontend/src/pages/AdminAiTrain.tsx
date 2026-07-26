import { useEffect, useState } from 'react'
import AdminNav from '../components/AdminNav'

interface AiKnowledge {
  id: number; question: string; answer: string; created_at: string
}

export default function AdminAiTrain() {
  const [items, setItems] = useState<AiKnowledge[]>([])
  const [q, setQ] = useState('')
  const [a, setA] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  useEffect(() => { fetchData() }, [])

  function fetchData() {
    fetch('/api/admin/ai-knowledge', { credentials: 'include' })
      .then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => {})
  }

  async function add() {
    if (!q.trim() || !a.trim()) return alert('질문과 답변을 모두 입력하세요')
    const r = await fetch('/admin/ai-train/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.trim(), answer: a.trim() }),
      credentials: 'include',
    })
    const d = await r.json()
    if (d.status === 'success') { setQ(''); setA(''); fetchData() }
    else alert(d.error || '오류')
  }

  async function remove(id: number) {
    if (!confirm('삭제하시겠습니까?')) return
    const r = await fetch(`/admin/ai-train/delete/${id}`, { method: 'POST', credentials: 'include' })
    const d = await r.json()
    if (d.status === 'success') fetchData()
    else alert(d.error || '오류')
  }

  function edit(item: AiKnowledge) {
    setEditingId(item.id); setQ(item.question); setA(item.answer)
  }

  async function update() {
    if (!editingId || !q.trim() || !a.trim()) return
    const r = await fetch(`/api/admin/ai-train/update/${editingId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q.trim(), answer: a.trim() }),
      credentials: 'include',
    })
    const d = await r.json()
    if (d.status === 'success') { setEditingId(null); setQ(''); setA(''); fetchData() }
    else alert(d.error || '오류')
  }

  return (
    <div className="p-3" style={{ maxWidth: 900, margin: '0 auto' }}>
      <AdminNav />
      <h5 className="fw-bold mb-3">📚 AI 지식 게시판</h5>
      <p className="text-muted small mb-3">
        AI에게 가르쳐주고 싶은 정보를 질문과 답변 형태로 등록하세요.
        AI가 채팅 중 관련 질문을 받으면 이 내용을 찾아 답변에 활용합니다.
      </p>

      {/* 입력 폼 */}
      <div className="card border-success mb-3">
        <div className="card-header bg-success text-white small fw-bold">
          {editingId ? '✏️ 지식 수정' : '✏️ 새 지식 등록'}
        </div>
        <div className="card-body">
          <div className="mb-2">
            <label className="form-label small fw-bold">질문 (제목)</label>
            <input className="form-control" value={q}
              onChange={e => setQ(e.target.value)} placeholder="예: 양평의 대표 축제는 무엇인가요?" />
          </div>
          <div className="mb-2">
            <label className="form-label small fw-bold">답변 (내용)</label>
            <textarea className="form-control" rows={4} value={a}
              onChange={e => setA(e.target.value)} placeholder="AI가 답변할 내용을 자세히 입력하세요." />
          </div>
          <div className="d-flex gap-2">
            <button className="btn btn-success btn-sm" onClick={editingId ? update : add}>
              {editingId ? '수정 완료' : '등록'}
            </button>
            {editingId && (
              <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingId(null); setQ(''); setA('') }}>취소</button>
            )}
          </div>
        </div>
      </div>

      {/* 목록 */}
      {items.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <p>등록된 지식이 없습니다. 위 폼에서 첫 번째 지식을 등록해보세요.</p>
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{ width: 50 }}>번호</th>
                <th>질문</th>
                <th>답변</th>
                <th style={{ width: 90 }}>등록일</th>
                <th style={{ width: 100 }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id}>
                  <td className="text-muted small">{items.length - idx}</td>
                  <td className="fw-medium">{item.question}</td>
                  <td className="small text-muted">
                    {item.answer.length > 150 ? item.answer.substring(0, 150) + '...' : item.answer}
                  </td>
                  <td className="small text-muted">{item.created_at?.slice(0, 10)}</td>
                  <td>
                    <div className="d-flex gap-1">
                      <button className="btn btn-outline-primary btn-sm py-0 px-1" style={{ fontSize: '0.7rem' }}
                        onClick={() => edit(item)}>수정</button>
                      <button className="btn btn-outline-danger btn-sm py-0 px-1" style={{ fontSize: '0.7rem' }}
                        onClick={() => remove(item.id)}>삭제</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
