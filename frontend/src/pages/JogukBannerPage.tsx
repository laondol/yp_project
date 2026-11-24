import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { jget, jpost, jput, jform } from '../lib/joguk'

interface Stat { key: string; label: string; value: string }
interface Card { id: number; side: string; title: string; subtitle: string; body: string; link_url: string }
interface Comment {
  id: number; masked_email: string; is_anonymous: boolean; created_at: string
  like_count: number; has_files: boolean; has_drawing: boolean; link_url: string
  status: string; content?: string; drawing_path?: string; files?: string[]
}
interface Banner {
  id: number; token: string; title: string; summary: string; body: string
  image_path: string; like_count: number; view_count: number; created_at: string
  comments: Comment[]; comment_count: number
}

function CardList({ cards, label }: { cards: Card[]; label: string }) {
  const PER = 3
  const CARD_H = 108
  const GAP = 8
  const [start, setStart] = useState(0)
  const [paused, setPaused] = useState(false)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    if (cards.length <= PER) return
    const t = setInterval(() => {
      if (paused) return
      setStart(s => (s + 1 > cards.length - PER ? 0 : s + 1))
    }, 4000)
    return () => clearInterval(t)
  }, [cards.length, paused])

  useEffect(() => {
    if (!animate) {
      const t = setTimeout(() => setAnimate(true), 50)
      return () => clearTimeout(t)
    }
  }, [animate])

  if (!cards.length) return null
  const pages = Math.max(1, cards.length - PER + 1)

  const move = (d: number) => {
    setStart(s => {
      const next = s + d
      if (next < 0) return cards.length - PER
      if (next > cards.length - PER) return 0
      return next
    })
  }

  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="d-flex justify-content-between align-items-center mb-1">
        <div className="text-muted small">{label} 카드 ({start + 1}-{Math.min(start + PER, cards.length)} / {cards.length})</div>
        {cards.length > PER && (
          <div className="d-flex gap-1">
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => move(-1)} aria-label="이전">▲</button>
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => move(1)} aria-label="다음">▼</button>
          </div>
        )}
      </div>

      <div style={{ height: PER * (CARD_H + GAP), overflow: 'hidden' }}>
        <div style={{ transform: `translateY(${-start * (CARD_H + GAP)}px)`, transition: 'transform .5s ease' }}>
          {cards.map(c => (
            <div key={c.id} className="border rounded-3 shadow-sm p-3 bg-white"
              style={{ height: CARD_H, marginBottom: GAP, overflow: 'hidden' }}>
              <div className="fw-bold mb-1" style={{ fontSize: '0.95rem' }}>{c.title}</div>
              {c.subtitle && <div className="text-success small mb-1">{c.subtitle}</div>}
              {c.body && <div className="small text-muted" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</div>}
              {c.link_url && <a className="small" href={c.link_url} target="_blank" rel="noreferrer">자세히 보기</a>}
            </div>
          ))}
        </div>
      </div>

      {pages > 1 && (
        <div className="d-flex gap-1 mt-1 flex-wrap">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className={`btn btn-sm ${i === start ? 'btn-success' : 'btn-outline-secondary'}`}
              style={{ width: 12, height: 12, padding: 0, borderRadius: 6 }} onClick={() => setStart(i)}
              aria-label={`카드 페이지 ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  )
}

function DrawPad({ onChange }: { onChange: (f: File | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const [open, setOpen] = useState(false)

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current; if (!c) return
    drawing.current = true
    const ctx = c.getContext('2d')!
    const p = pos(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
    c.setPointerCapture(e.pointerId)
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !ref.current) return
    const ctx = ref.current.getContext('2d')!
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke()
  }
  const end = () => { drawing.current = false }

  const clear = () => {
    const c = ref.current; if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    onChange(null)
  }
  const save = () => {
    const c = ref.current; if (!c) return
    c.toBlob(b => { if (b) onChange(new File([b], 'drawing.png', { type: 'image/png' })) }, 'image/png')
  }

  return (
    <div className="mb-2">
      <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setOpen(o => !o)}>
        ✏️ 그리기 {open ? '닫기' : '열기'}
      </button>
      {open && (
        <div className="mt-2">
          <canvas ref={ref} width={600} height={220} className="border rounded w-100"
            style={{ touchAction: 'none', background: '#fff' }}
            onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerLeave={end} />
          <div className="d-flex gap-2 mt-1">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clear}>지우기</button>
            <button type="button" className="btn btn-sm btn-success" onClick={save}>그림 첨부</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function JogukBannerPage() {
  const { token } = useParams<{ token: string }>()
  const [banner, setBanner] = useState<Banner | null>(null)
  const [stats, setStats] = useState<Stat[]>([])
  const [central, setCentral] = useState<Card[]>([])
  const [local, setLocal] = useState<Card[]>([])
  const [err, setErr] = useState('')
  const [likeMsg, setLikeMsg] = useState('')
  const [panel, setPanel] = useState<'bills' | 'rate' | 'issues' | 'results' | null>(null)

  const [me, setMe] = useState<any>(null)
  const [mode, setMode] = useState<'account' | 'email' | 'anon'>('email')
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [content, setContent] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [drawing, setDrawing] = useState<File | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [sendMsg, setSendMsg] = useState('')
  const [agreeP, setAgreeP] = useState(false)

  const [openId, setOpenId] = useState<number | null>(null)
  const [openPw, setOpenPw] = useState('')
  const [openBody, setOpenBody] = useState<any>(null)
  const [editBody, setEditBody] = useState('')
  const [openErr, setOpenErr] = useState('')

  const load = () => {
    if (!token) return
    jget(`/api/rebuild/banner/${token}`).then(d => {
      if (d.status === 'error') { setErr(d.msg); return }
      setBanner(d)
    })
    jget('/api/rebuild/stats').then(d => setStats(d.items || []))
    jget('/api/rebuild/cards?side=central').then(d => setCentral(d.items || []))
    jget('/api/rebuild/cards?side=local').then(d => setLocal(d.items || []))
    jget('/api/rebuild/me').then(d => {
      setMe(d.account || null)
      if (d.account) setMode('account')
    })
  }
  useEffect(load, [token])

  useEffect(() => {
    document.body.classList.add('joguk-clean')
    return () => { document.body.classList.remove('joguk-clean') }
  }, [])

  const submitComment = async () => {
    if (!token) return
    setSendMsg('')
    const fd = new FormData()
    fd.append('mode', mode)
    fd.append('content', content)
    if (linkUrl) fd.append('link_url', linkUrl)
    if (mode === 'email') {
      if (!agreeP) { setSendMsg('개인정보 수집·이용에 동의해 주세요.'); return }
      fd.append('email', email); fd.append('password', pw); fd.append('agree_privacy', '1')
    }
    if (drawing) fd.append('drawing', drawing)
    files.forEach(f => fd.append('files', f))
    const d = await jform(`/api/rebuild/banner/${token}/comments`, fd)
    if (d.status !== 'ok') { setSendMsg(d.msg || '등록 실패'); return }
    setSendMsg(d.msg || '등록되었습니다.')
    setContent(''); setLinkUrl(''); setDrawing(null); setFiles([])
    load()
  }

  const tryOpen = async (id: number) => {
    setOpenErr(''); setOpenBody(null); setEditBody('')
    const d = await jpost(`/api/rebuild/comment/${id}/view`, { password: openPw })
    if (d.status === 'error') { setOpenErr(d.msg); return }
    setOpenBody(d)
    setEditBody(d.content || '')
  }

  const saveEdit = async () => {
    if (!openId) return
    const d = await jput(`/api/rebuild/comment/${openId}`, { password: openPw, content: editBody })
    if (d.status !== 'ok') { setOpenErr(d.msg || '수정 실패'); return }
    setOpenErr('')
    setOpenBody({ ...openBody, content: editBody })
    load()
  }

  const likeArticle = async () => {
    if (!token) return
    const d = await jpost(`/api/rebuild/banner/${token}/like`)
    if (d.status === 'ok') {
      setLikeMsg(d.already ? '이미 공감하셨습니다.' : '공감했습니다.')
      if (banner) setBanner({ ...banner, like_count: d.like_count })
    }
  }

  if (err) {
    return <div className="container py-5"><div className="alert alert-warning">{err}</div></div>
  }
  if (!banner) {
    return <div className="container py-5 text-center"><div className="spinner-border text-success" /></div>
  }

  const statMap: Record<string, string> = {}
  stats.forEach(s => { statMap[s.key] = s.value })

  return (
    <div className="container py-3" style={{ maxWidth: 1200 }}>
      {/* 상단 통계 (모바일: 버튼 → 목록 펼침) */}
      <div className="d-lg-none mb-3">
        <div className="d-flex gap-2">
          {[
            ['bills', `추진법안 ${statMap['bills'] || 0}`],
            ['rate', `전국당원비율 ${statMap['national_rate'] || '-'}`],
            ['issues', `당 추진현안 ${central.length}`],
          ].map(([k, label]) => (
            <button key={k} className={`btn btn-sm flex-fill ${panel === k ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => setPanel(panel === k ? null : (k as any))}>{label}</button>
          ))}
        </div>
        {panel && (
          <div className="border rounded-3 bg-white p-2 mt-2">
            {(panel === 'bills' || panel === 'issues' ? central : []).map(c => (
              <div key={c.id} className="border-top py-1 small">
                <b>{c.title}</b>{c.subtitle && <span className="text-muted"> · {c.subtitle}</span>}
              </div>
            ))}
            {panel === 'rate' && stats.map(st => (
              <div key={st.key} className="border-top py-1 small d-flex justify-content-between">
                <span>{st.label}</span><b className="text-success">{st.value}</b>
              </div>
            ))}
            {panel === 'bills' && !central.length && <div className="small text-muted">내용이 없습니다.</div>}
          </div>
        )}
      </div>

      <div className="row g-3">
        <div className="col-lg-3 d-none d-lg-block">
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="d-flex justify-content-between small py-1">
              <span className="text-muted">당원비율</span><b className="text-success">{statMap['national_rate'] || '-'}</b>
            </div>
            <div className="d-flex justify-content-between small py-1 border-top">
              <span className="text-muted">제안법안</span><b>{statMap['proposed_bills'] || 0}</b>
            </div>
            <div className="d-flex justify-content-between small py-1 border-top">
              <span className="text-muted">채택법안</span><b className="text-success">{statMap['adopted_bills'] || 0}</b>
            </div>
            <a className="btn btn-sm btn-success w-100 mt-2" href="/rebuild/member">당원가입</a>
          </div>
          <CardList cards={central} label="중앙당 추진" />
        </div>

        <div className="col-lg-6">
          <div className="border rounded-3 bg-white p-3 p-lg-4 shadow-sm">
            <h4 className="fw-bold mb-2">{banner.title}</h4>
            {banner.summary && <div className="text-muted mb-3">{banner.summary}</div>}
            {banner.image_path && <img src={banner.image_path} alt="" className="img-fluid rounded mb-3" />}
            {/<[a-z][\s\S]*>/i.test(banner.body || '') ? (
              <div style={{ lineHeight: 1.8 }} dangerouslySetInnerHTML={{ __html: banner.body }} />
            ) : (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{banner.body}</div>
            )}

            {(banner as any).posts?.length > 0 && (
              <div className="mt-3 border-top pt-3">
                <div className="fw-bold small mb-2">게시 현황</div>
                {(banner as any).posts.map((a: any, i: number) => (
                  <div key={i} className="border rounded p-2 mb-2">
                    <img src={a.photo_path} alt="게시 사진" className="img-fluid rounded" style={{ maxHeight: 320 }} />
                    <div className="small mt-1">
                      {a.email}
                      {a.lat && a.lng && (
                        <> · <a href={`https://map.kakao.com/link/map/${a.lat},${a.lng}`} target="_blank" rel="noreferrer">📍 위치</a></>
                      )}
                    </div>
                    {a.memo && <div className="small text-muted">{a.memo}</div>}
                  </div>
                ))}
              </div>
            )}

            <div className="d-flex gap-2 mt-4">
              <button className="btn btn-success" onClick={likeArticle}>👍 공감 {banner.like_count}</button>
              <a className="btn btn-outline-success" href="#comments">💬 댓글 {banner.comment_count}</a>
            </div>
            {likeMsg && <div className="small text-success mt-1">{likeMsg}</div>}
          </div>

          {/* 댓글 */}
          <div id="comments" className="border rounded-3 bg-white p-3 mt-3">
            <div className="fw-bold mb-2">댓글 {banner.comment_count} <span className="text-muted small">(비밀댓글 · 이메일은 50%만 표시)</span></div>

            {banner.comments.length === 0 && <div className="text-muted small">아직 댓글이 없습니다.</div>}
            {banner.comments.map(c => (
              <div key={c.id} className="border-top py-2">
                <div className="d-flex align-items-center gap-2">
                  <button className="btn btn-link p-0 text-decoration-none" onClick={() => { setOpenId(c.id); setOpenPw(''); setOpenBody(null); setOpenErr('') }}>
                    {c.masked_email}
                  </button>
                  <span className="text-muted small">{new Date(c.created_at).toLocaleString('ko-KR')}</span>
                  <span className="badge bg-light text-dark">비밀</span>
                  {c.has_files && <span className="small text-muted">📎</span>}
                  {c.has_drawing && <span className="small text-muted">🖼</span>}
                </div>
                <div className="text-muted small">🔒 내용은 작성자만 확인할 수 있습니다.</div>

                {openId === c.id && (
                  <div className="mt-2 p-2 bg-light rounded">
                    {!openBody && (
                      <div className="d-flex gap-2">
                        <input type="password" className="form-control form-control-sm" placeholder="비밀번호"
                          value={openPw} onChange={e => setOpenPw(e.target.value)} style={{ maxWidth: 200 }} />
                        <button className="btn btn-sm btn-success" onClick={() => tryOpen(c.id)}>열람</button>
                        {openErr && <span className="text-danger small align-self-center">{openErr}</span>}
                      </div>
                    )}
                    {openBody && (
                      <div>
                        <textarea className="form-control form-control-sm mb-2" rows={3}
                          value={editBody} onChange={e => setEditBody(e.target.value)} />
                        <div className="d-flex gap-2">
                          <button className="btn btn-sm btn-success" onClick={saveEdit}>수정 저장</button>
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => { setOpenId(null); setOpenBody(null) }}>닫기</button>
                          {openErr && <span className="text-danger small align-self-center">{openErr}</span>}
                        </div>
                        {openBody.drawing_path && <img src={openBody.drawing_path} alt="첨부 그림" className="img-fluid border rounded mt-2" />}
                        {(openBody.files || []).map((f: string) => (
                          <div key={f}><a href={f} target="_blank" rel="noreferrer">첨부파일</a></div>
                        ))}
                        {openBody.link_url && <div><a href={openBody.link_url} target="_blank" rel="noreferrer">링크</a></div>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* 작성 */}
            <div className="border-top pt-3 mt-3">
              <div className="fw-bold mb-2">
                댓글 쓰기
                {me && <span className="small text-muted ms-2">({me.email} 계정으로 작성)</span>}
              </div>
              <div className="d-flex flex-wrap gap-3 mb-2 small">
                <label className="d-flex align-items-center gap-1">
                  <input type="radio" checked={mode === 'email'} onChange={() => setMode('email')} /> 이메일+비밀번호
                </label>
                <label className="d-flex align-items-center gap-1">
                  <input type="radio" checked={mode === 'account'} onChange={() => setMode('account')} /> 로그인 계정
                </label>
                <label className="d-flex align-items-center gap-1">
                  <input type="radio" checked={mode === 'anon'} onChange={() => setMode('anon')} /> 익명(목록 미노출)
                </label>
              </div>

              {mode === 'email' && (
                <>
                  <div className="row g-2 mb-1">
                    <div className="col-7"><input className="form-control form-control-sm" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} /></div>
                    <div className="col-5"><input type="password" className="form-control form-control-sm" placeholder="비밀번호(4자 이상)" value={pw} onChange={e => setPw(e.target.value)} /></div>
                  </div>
                  <label className="d-flex gap-2 align-items-start small mb-2">
                    <input type="checkbox" className="mt-1" checked={agreeP} onChange={e => setAgreeP(e.target.checked)} />
                    <span>
                      개인정보 수집·이용에 동의합니다. (이메일·비밀번호 / 목적: 비밀댓글 작성자 확인·수정 /
                      보유: 댓글 삭제 시까지) <b>동의를 거부하면 비회원 댓글을 쓸 수 없습니다.</b>
                    </span>
                  </label>
                </>
              )}
              {mode === 'anon' && (
                <div className="alert alert-warning py-2 small">
                  인증 없이 남기면 <b>목록에 표시되지 않고</b>, 나중에 수정하거나 답변을 받을 수 없습니다. 저장한 글은 관리자만 확인합니다.
                </div>
              )}

              <textarea className="form-control mb-2" rows={3} placeholder="의견을 남겨주세요"
                value={content} onChange={e => setContent(e.target.value)} />
              <input className="form-control form-control-sm mb-2" placeholder="링크 (선택, https://...)"
                value={linkUrl} onChange={e => setLinkUrl(e.target.value)} />
              <DrawPad onChange={setDrawing} />
              <input type="file" className="form-control form-control-sm mb-2" multiple
                accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                onChange={e => setFiles(Array.from(e.target.files || []))} />
              <button className="btn btn-success" onClick={submitComment}>댓글 등록</button>
              {sendMsg && <span className="ms-2 small text-success">{sendMsg}</span>}
            </div>
          </div>
        </div>

        <div className="col-lg-3 d-none d-lg-block">
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="d-flex justify-content-between small py-1">
              <span className="text-muted">토론중</span><b>{statMap['discussing'] || 0}</b>
            </div>
            <div className="d-flex justify-content-between small py-1 border-top">
              <span className="text-muted">공론결과</span><b>{statMap['results'] || 0}</b>
            </div>
            <div className="d-flex justify-content-between small py-1 border-top">
              <span className="text-muted">여주·양평 당원비율</span><b className="text-success">{statMap['member_rate'] || '-'}</b>
            </div>
          </div>
          <CardList cards={local} label="지역위원회" />
        </div>
      </div>

      {/* 모바일: 카드 목록 */}
      <div className="d-lg-none mt-3">
        <div className="fw-bold mb-2">지역위원회 공론결과</div>
        {local.map(c => (
          <div key={c.id} className="border rounded-3 bg-white p-2 mb-2">
            <div className="fw-semibold">{c.title}</div>
            <div className="small text-muted">{c.subtitle}</div>
          </div>
        ))}
        <a className="btn btn-success w-100 mt-2" href="/rebuild/member">당원가입 / 당원게시판</a>
      </div>
    </div>
  )
}
