import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardAdminItem {
  id: string; db_id: number
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; author_name?: string
  is_approved: boolean; is_active: boolean
  created_at: string
}

interface YardOrgItem {
  id: number; name: string; url: string
  platform: string; is_active: boolean; created_at: string
}

const platformLabel: Record<string, string> = {
  facebook: '📘 페이스북', kakao: '💛 카카오', naverblog: '📝 블로그',
  navercafe: '💬 카페', instagram: '📸 인스타그램', web: '🌐 웹', '': '📢 직접 등록',
}

export default function AdminYard() {
  const [items, setItems] = useState<YardAdminItem[]>([])
  const [orgs, setOrgs] = useState<YardOrgItem[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState(false)

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [authorName, setAuthorName] = useState('')
  const [saving, setSaving] = useState(false)

  const [orgName, setOrgName] = useState('')
  const [orgUrl, setOrgUrl] = useState('')
  const [orgMsg, setOrgMsg] = useState('')
  const [orgMsgOk, setOrgMsgOk] = useState(false)

  const load = () => {
    setLoading(true)
    Promise.all([
      fetch('/api/yard/admin').then(r => r.json()).catch(() => ({})),
      fetch('/api/yard/orgs').then(r => r.json()).catch(() => ({})),
    ])
      .then(([yardData, orgData]) => {
        setItems(yardData.items || [])
        setOrgs(orgData.orgs || [])
      })
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const handleOrgCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const res = await fetch('/api/yard/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: orgName.trim(), url: orgUrl.trim() }),
      })
      const data = await res.json()
      setOrgMsg(data.msg || '등록'); setOrgMsgOk(data.status === 'success')
      if (data.status === 'success') { setOrgName(''); setOrgUrl(''); load() }
    } catch { setOrgMsg('오류'); setOrgMsgOk(false) }
  }

  const handleOrgDelete = async (orgId: number) => {
    if (!confirm('단체 등록을 삭제하시겠습니까? (자동수집이 중단됩니다)')) return
    const res = await fetch(`/api/yard/orgs/${orgId}`, { method: 'DELETE' })
    const data = await res.json()
    setOrgMsg(data.msg || ''); setOrgMsgOk(data.status === 'success')
    if (data.status === 'success') load()
  }

  const handleCreate = async () => {
    if (!title.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/yard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), content: content.trim(), source_url: sourceUrl.trim(), author_name: authorName.trim() }),
      })
      const data = await res.json()
      setMsg(data.msg || (data.status === 'success' ? '등록 완료' : '실패'))
      setMsgOk(data.status === 'success')
      if (data.status === 'success') { setTitle(''); setContent(''); setSourceUrl(''); setAuthorName(''); load() }
    } catch { setMsg('오류가 발생했습니다.'); setMsgOk(false) }
    setSaving(false)
  }

  const handleApprove = async (fid: string) => {
    try {
      const res = await fetch(`/api/yard/${fid}/approve`, { method: 'POST' })
      const data = await res.json()
      setMsg(data.msg || ''); setMsgOk(data.status === 'success')
      if (data.status === 'success') load()
    } catch { setMsg('승인 오류'); setMsgOk(false) }
  }

  const handleDelete = async (fid: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    try {
      const res = await fetch(`/api/yard/${fid}`, { method: 'DELETE' })
      const data = await res.json()
      setMsg(data.msg || '삭제'); setMsgOk(data.status === 'success')
      if (data.status === 'success') load()
    } catch { setMsg('삭제 오류'); setMsgOk(false) }
  }

  const pending = items.filter(i => !i.is_approved)
  const approved = items.filter(i => i.is_approved)

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">🌾 마당 관리</h3>

      {/* 단체 등록 (자동수집) */}
      <div className="card border-0 shadow-sm mb-4 p-4" style={{ borderRadius: 16, borderLeft: '4px solid #20c997' }}>
        <h6 className="fw-bold mb-2">🏢 자동수집 단체 등록</h6>
        <p className="small text-muted mb-2">
          네이버 블로그 주소를 등록하면 <strong>최신 글을 매일 자동으로 수집</strong>합니다 (승인 후 공개).
          페이스북·카카오·밴드는 자동수집이 불가하여 게시물 URL을 "직접 등록"으로 올려 주세요.
        </p>
        <form onSubmit={handleOrgCreate}>
          <div className="d-flex gap-2 mb-2 flex-wrap">
            <input className="form-control" style={{ maxWidth: 220 }} placeholder="단체명 (예: 두물붙농부시장)"
              value={orgName} onChange={e => setOrgName(e.target.value)} required />
            <input className="form-control" style={{ maxWidth: 320 }} placeholder="블로그 주소 (예: https://blog.naver.com/fromnature2019)"
              value={orgUrl} onChange={e => setOrgUrl(e.target.value)} required />
            <button type="submit" className="btn btn-success">➕ 단체 등록</button>
          </div>
          <span className={`small ${orgMsgOk ? 'text-success' : 'text-danger'}`}>{orgMsg}</span>
        </form>
        {orgs.length > 0 && (
          <div className="mt-2">
            {orgs.map(o => (
              <div key={o.id} className="d-flex justify-content-between align-items-center border rounded p-2 mb-1">
                <div className="small">
                  <strong>{o.name}</strong>
                  <span className={`badge ms-2 ${o.platform === 'naverblog' ? 'bg-success' : 'bg-secondary'}`}>
                    {o.platform === 'naverblog' ? '자동수집 ON' : '참고용 (자동수집 불가)'}
                  </span>
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>{o.url}</div>
                </div>
                <button className="btn btn-sm btn-outline-danger" onClick={() => handleOrgDelete(o.id)}>삭제</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 등록 폼 */}
      <div className="card border-0 shadow-sm mb-4 p-4" style={{ borderRadius: 16 }}>
        <h6 className="fw-bold mb-3">✏️ 직접 등록 <small className="text-muted fw-normal">(등록 즉시 공개)</small></h6>
        <form onSubmit={e => { e.preventDefault(); handleCreate() }}>
          <input className="form-control mb-2" placeholder="제목 (필수)"
            value={title} onChange={e => setTitle(e.target.value)} required />
          <input className="form-control mb-2" placeholder="단체명/출처 (예: 양평군청, ○○마을회)"
            value={authorName} onChange={e => setAuthorName(e.target.value)} />
          <textarea className="form-control mb-2" rows={3} placeholder="내용"
            value={content} onChange={e => setContent(e.target.value)} />
          <input className="form-control mb-2" placeholder="SNS 공지 URL (선택 — 페이스북 공개 게시물은 상세페이지에 원문 표시)"
            value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} />
          <button type="submit" className="btn btn-success" disabled={saving || !title.trim()}>
            {saving ? '⏳ 등록 중...' : '✅ 마당에 등록'}
          </button>
          <span className={`ms-2 small ${msgOk ? 'text-success' : 'text-danger'}`}>{msg}</span>
        </form>
      </div>

      {/* 승인 대기 */}
      <div className="card border-0 shadow-sm mb-4 p-3" style={{ borderRadius: 16, borderLeft: '4px solid #f0ad4e' }}>
        <h6 className="fw-bold mb-3">⏳ 승인 대기 (자동수집) <span className="badge bg-warning text-dark">{pending.length}</span></h6>
        {loading ? (
          <div className="text-center py-3 text-muted"><div className="spinner-border spinner-border-sm" /></div>
        ) : pending.length === 0 ? (
          <div className="text-center text-muted small py-2">승인 대기 중인 소식이 없습니다.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>제목</th><th>출처</th><th>플랫폼</th><th>수집일</th><th></th></tr></thead>
              <tbody>
                {pending.map(p => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}>
                      <strong>{p.title}</strong>
                      {p.source_url && <div className="small text-muted" style={{ fontSize: '0.75rem' }}>{p.source_url}</div>}
                    </td>
                    <td className="small">{p.author_name || '-'}</td>
                    <td className="small">{platformLabel[p.platform || ''] || p.platform}</td>
                    <td className="small">{formatKST(p.created_at, { month: '2-digit', day: '2-digit' })}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-success me-1" onClick={() => handleApprove(p.id)}>✅ 승인</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p.id)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 공개중 */}
      <div className="card border-0 shadow-sm mb-4 p-3" style={{ borderRadius: 16, borderLeft: '4px solid #27ae60' }}>
        <h6 className="fw-bold mb-3">✅ 마당에 공개 중 <span className="badge bg-success">{approved.length}</span></h6>
        {loading ? (
          <div className="text-center py-3 text-muted"><div className="spinner-border spinner-border-sm" /></div>
        ) : approved.length === 0 ? (
          <div className="text-center text-muted small py-2">공개 중인 소식이 없습니다.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead><tr><th>제목</th><th>출처</th><th>플랫폼</th><th>등록일</th><th></th></tr></thead>
              <tbody>
                {approved.map(p => (
                  <tr key={p.id}>
                    <td style={{ maxWidth: 280 }}>
                      <strong>{p.title}</strong>
                      {p.source_url && <div className="small text-muted" style={{ fontSize: '0.75rem' }}>{p.source_url}</div>}
                    </td>
                    <td className="small">{p.author_name || '-'}</td>
                    <td className="small">{platformLabel[p.platform || ''] || p.platform}</td>
                    <td className="small">{formatKST(p.created_at, { month: '2-digit', day: '2-digit' })}</td>
                    <td className="text-end text-nowrap">
                      <button className="btn btn-sm btn-outline-secondary me-1" title="비공개로 전환" onClick={() => handleApprove(p.id)}>숨기기</button>
                      <button className="btn btn-sm btn-outline-danger" onClick={() => handleDelete(p.id)}>삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
