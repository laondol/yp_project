import { useEffect, useState } from 'react'
import { jget, jpost, jput } from '../lib/joguk'

export default function JogukCandidatesPage() {
  const [me, setMe] = useState<any>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [err, setErr] = useState('')
  const [comment, setComment] = useState('')
  const [msg, setMsg] = useState('')
  const [days, setDays] = useState('3')

  const load = async () => {
    const [m, d] = await Promise.all([jget('/api/rebuild/me'), jget('/api/rebuild/candidates')])
    setMe(m.account)
    setIsAdmin(!!m.is_admin)
    setLoading(false)
    if (d.status === 'error') { setErr(d.msg); setItems([]); return }
    setErr('')
    setItems(d.items || [])
  }

  useEffect(() => { load() }, [])

  const open = async (pid: number) => {
    const d = await jget(`/api/rebuild/candidates/${pid}`)
    if (d.status === 'error') { setMsg(d.msg); return }
    setDetail(d); setComment(''); setMsg('')
    if (d.expires_at) setDays('')
  }

  const vote = async (stance: 'yes' | 'no') => {
    if (!detail) return
    const d = await jpost(`/api/rebuild/candidates/${detail.post_id}/vote`, { stance })
    if (d.status !== 'ok') { setMsg(d.msg || '실패'); return }
    open(detail.post_id)
  }

  const sendComment = async () => {
    if (!detail) return
    const d = await jpost(`/api/rebuild/candidates/${detail.post_id}/comment`, { content: comment })
    if (d.status !== 'ok') { setMsg(d.msg || '실패'); return }
    setComment(''); open(detail.post_id)
  }

  const saveExpiry = async () => {
    if (!detail) return
    const d = await jput(`/api/rebuild/candidates/${detail.post_id}/expiry`, { days: Number(days) })
    if (d.status !== 'ok') { setMsg(d.msg || '실패'); return }
    setMsg('만료일을 변경했습니다.')
    open(detail.post_id); load()
  }

  if (loading) return <div className="container py-5 text-center"><div className="spinner-border text-success" /></div>

  if (err) {
    return (
      <div className="container py-4" style={{ maxWidth: 640 }}>
        <div className="alert alert-warning">{err}</div>
        <a className="btn btn-outline-success" href="/rebuild/member">당원게시판 로그인</a>
      </div>
    )
  }

  return (
    <div className="container py-3" style={{ maxWidth: 900 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="fw-bold mb-0">현안 후보 게시판</h5>
        <div className="small text-muted">{me?.email || (isAdmin ? '책임자' : '')}{me?.committee ? ' · 운영위원' : ''}</div>
      </div>
      <p className="small text-muted">찬성 기준을 넘어 현안 후보가 된 제안글입니다. 운영위원만 열람·투표·의견 작성이 가능합니다.</p>

      {msg && <div className="alert alert-success py-2 small">{msg}</div>}

      {!detail && items.map(it => (
        <div key={it.post_id} className="border rounded-3 bg-white p-3 mb-2 d-flex justify-content-between align-items-start">
          <div>
            <button className="btn btn-link p-0 text-decoration-none fw-bold text-dark text-start" onClick={() => open(it.post_id)}>{it.title}</button>
            <div className="small text-muted">
              {it.author} · 찬성 {it.like_count}/{it.threshold} · 위원 찬성 {it.vote_yes} / 반대 {it.vote_no} · 의견 {it.comment_count}
              {it.adopted && <span className="badge bg-secondary ms-2">채택됨</span>}
            </div>
          </div>
          <div className="text-end small text-nowrap">
            {it.expires_at && <span className={`badge ${it.days_left <= 1 ? 'bg-danger' : 'bg-warning text-dark'}`}>만료 D-{it.days_left}</span>}
            <div className="text-muted mt-1">{it.expires_at ? new Date(it.expires_at).toLocaleDateString('ko-KR') : ''}</div>
          </div>
        </div>
      ))}
      {!detail && !items.length && <div className="text-muted small">후보가 없습니다.</div>}

      {detail && (
        <div className="border rounded-3 bg-white p-3">
          <div className="d-flex justify-content-between align-items-start">
            <div>
              <h6 className="fw-bold mb-1">{detail.title}</h6>
              <div className="small text-muted">
                {detail.author} · 찬성 {detail.like_count}/{detail.threshold} · 등록 {new Date(detail.created_at).toLocaleDateString('ko-KR')}
              </div>
              <div className="small text-muted">
                후보 만료: {detail.expires_at ? new Date(detail.expires_at).toLocaleDateString('ko-KR') : '-'}
                {detail.days_left !== null && <> (D-{detail.days_left})</>}
              </div>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { setDetail(null); setMsg('') }}>목록</button>
          </div>

          <div className="mt-3" dangerouslySetInnerHTML={{ __html: detail.content || '' }} />

          <div className="mt-3">
            <div className="small text-muted mb-1">위원 투표</div>
            <button className={`btn btn-sm me-2 ${detail.my_vote === 'yes' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => vote('yes')} disabled={!me && !isAdmin}>찬성 {detail.vote_yes}</button>
            <button className={`btn btn-sm ${detail.my_vote === 'no' ? 'btn-danger' : 'btn-outline-danger'}`}
              onClick={() => vote('no')} disabled={!me && !isAdmin}>반대 {detail.vote_no}</button>
            {!me && !isAdmin && <span className="small text-muted ms-2">(투표는 운영위원 로그인 후 가능)</span>}
          </div>

          {detail.can_edit_expiry && (
            <div className="alert alert-light border mt-3 small">
              <b>책임자: 후보 만료일 변경</b> (기본 3일)
              <div className="d-flex gap-2 mt-2 align-items-center">
                <input className="form-control form-control-sm" style={{ maxWidth: 90 }} value={days}
                  onChange={e => setDays(e.target.value)} placeholder="일" />
                <span>일 후 만료</span>
                <button className="btn btn-sm btn-success" onClick={saveExpiry}>변경</button>
              </div>
            </div>
          )}

          <div className="border-top mt-3 pt-2">
            <div className="small text-muted mb-1">위원 의견 {detail.comments?.length || 0}</div>
            {(detail.comments || []).map((c: any) => (
              <div key={c.id} className="border-top py-1 small">
                <b>{c.author}</b> <span className="text-muted">{new Date(c.created_at).toLocaleString('ko-KR')}</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
              </div>
            ))}
            {(me || isAdmin) ? (
              <div className="d-flex gap-2 mt-2">
                <input className="form-control form-control-sm" placeholder="의견" value={comment} onChange={e => setComment(e.target.value)} />
                <button className="btn btn-sm btn-success" onClick={sendComment}>등록</button>
              </div>
            ) : <div className="small text-muted mt-2">의견 작성은 운영위원 로그인 후 가능합니다.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
