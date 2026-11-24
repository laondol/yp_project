import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { jget, jpost, jdel } from '../lib/joguk'
import ContentEditor from '../components/contentEditor/ContentEditor'
import type { ContentEditorHandle } from '../components/contentEditor/ContentEditor'
import JogukCandidatesPage from './JogukCandidatesPage'
import useSpeech from '../lib/useSpeech'

interface Me { id: number; email: string; status: string; email_verified: boolean; can_read: boolean; can_write: boolean; committee?: boolean; is_admin?: boolean }
interface Topic { id: number; group: string; name: string; description: string; issue_count: number }

type View = 'board' | 'write' | 'post' | 'issue' | 'candidates' | 'banners'

export default function JogukMemberPage() {
  const [sp] = useSearchParams()
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [authView, setAuthView] = useState<'login' | 'signup'>('login')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [agreePrivacy, setAgreePrivacy] = useState(false)
  const [agreeEmail, setAgreeEmail] = useState(false)
  const [agreeTransfer, setAgreeTransfer] = useState(false)
  const [agreeOverseas, setAgreeOverseas] = useState(false)
  const [agreeAge, setAgreeAge] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)
  const [policy, setPolicy] = useState<any>(null)

  const [topics, setTopics] = useState<Topic[]>([])
  const [view, setView] = useState<View>('board')
  const [topicId, setTopicId] = useState<number | null>(null)
  const [showResults, setShowResults] = useState(false)
  const [openGroup, setOpenGroup] = useState<'일반' | '현안' | null>(null)
  const [allItems, setAllItems] = useState<any[]>([])
  const [banners, setBanners] = useState<any[]>([])
  const [myBanners, setMyBanners] = useState<any[]>([])
  const [postPhoto, setPostPhoto] = useState<Record<number, File | null>>({})
  const [postMemo, setPostMemo] = useState<Record<number, string>>({})
  const [geo, setGeo] = useState<Record<number, { lat: string; lng: string }>>({})
  const [banner, setBanner] = useState<any>(null)
  const [post, setPost] = useState<any>(null)
  const [results, setResults] = useState<any[]>([])
  const [issue, setIssue] = useState<any>(null)
  const [boardMsg, setBoardMsg] = useState('')

  const [pTitle, setPTitle] = useState('')
  const [pTopic, setPTopic] = useState('')
  const [pComment, setPComment] = useState('')
  const [issueComment, setIssueComment] = useState('')
  const editorRef = useRef<ContentEditorHandle | null>(null)
  const titleRef = useRef<HTMLInputElement | null>(null)

  const insertTitle = (text: string) => {
    const el = titleRef.current
    if (!el) { setPTitle(prev => prev + text); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? start
    const v = el.value
    const next = v.slice(0, start) + text + v.slice(end)
    setPTitle(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + text.length
      el.setSelectionRange(pos, pos)
    })
  }

  const titleSpeech = useSpeech(insertTitle)
  const bodySpeech = useSpeech((text) => editorRef.current?.insertText(text))

  const loadMe = async () => {
    const d = await jget('/api/rebuild/me')
    setMe(d.account)
    setLoading(false)
    return d.account as Me | null
  }

  useEffect(() => {
    jget('/api/rebuild/consent-text').then(d => setPolicy(d)).catch(() => {})
  }, [])

  useEffect(() => {
    document.body.classList.add('joguk-clean')
    return () => { document.body.classList.remove('joguk-clean') }
  }, [])

  useEffect(() => {
    (async () => {
      const verify = sp.get('verify')
      const magic = sp.get('magic')
      if (verify) {
        const d = await jpost('/api/rebuild/verify', { token: verify })
        setMsg(d.msg || ''); setErr(d.status === 'ok' ? '' : d.msg || '')
      }
      if (magic) {
        const d = await jpost('/api/rebuild/magic-login', { token: magic })
        if (d.status === 'ok') setMsg('로그인되었습니다.')
        else setErr(d.msg || '')
      }
      await loadMe()
    })()
  }, [])

  useEffect(() => {
    if (me?.can_read) {
      jget('/api/rebuild/topics').then(d => setTopics(d.items || []))
      loadAll()
    }
  }, [me?.can_read])

  const loadPosts = async (tid: number | null) => {
    const d = await jget(`/api/rebuild/posts${tid ? `?topic=${tid}` : ''}`)
    setAllItems((d.items || []).map((x: any) => ({ ...x, kind: 'post' })))
  }

  const loadAll = async () => {
    const [ps, rs] = await Promise.all([
      jget('/api/rebuild/posts'),
      jget('/api/rebuild/results'),
    ])
    const merged = [
      ...(ps.items || []).map((x: any) => ({ ...x, kind: 'post' })),
      ...(rs.items || []).map((x: any) => ({ ...x, kind: 'issue' })),
    ]
    merged.sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    setAllItems(merged)
    setResults(rs.items || [])
  }

  const openAll = () => {
    setTopicId(null); setShowResults(false); setView('board'); setOpenGroup(null)
    setPost(null); setIssue(null); loadAll()
  }

  const openTopic = (tid: number) => {
    setTopicId(tid); setShowResults(false); setView('board'); setOpenGroup(null)
    setPost(null); setIssue(null); loadPosts(tid)
  }

  const openResults = async () => {
    setShowResults(true); setTopicId(null); setView('board'); setPost(null); setIssue(null)
    const d = await jget('/api/rebuild/results')
    setResults(d.items || [])
  }

  const openBanners = async () => {
    setView('banners'); setShowResults(false); setTopicId(null); setPost(null); setIssue(null); setBanner(null)
    const [d, my] = await Promise.all([jget('/api/rebuild/banners'), jget('/api/rebuild/my-banners')])
    if (d.status === 'error') { setBoardMsg(d.msg); setBanners([]); return }
    setBanners(d.items || [])
    setMyBanners(my.items || [])
  }

  const getGeo = (bid: number) => {
    if (!navigator.geolocation) { setBoardMsg('이 브라우저에서는 위치를 사용할 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition(
      pos => setGeo(prev => ({ ...prev, [bid]: { lat: String(pos.coords.latitude), lng: String(pos.coords.longitude) } })),
      () => setBoardMsg('위치를 가져오지 못했습니다. 권한을 확인해 주세요.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const postBanner = async (bid: number) => {
    const fd = new FormData()
    const ph = postPhoto[bid]
    if (!ph) { setBoardMsg('게시 사진을 첨부해 주세요.'); return }
    fd.append('photo', ph)
    fd.append('memo', postMemo[bid] || '')
    const g = geo[bid]
    if (g) { fd.append('lat', g.lat); fd.append('lng', g.lng) }
    const d = await (await fetch(`/api/rebuild/banners/${bid}/post`, { method: 'POST', credentials: 'include', body: fd })).json()
    if (d.status !== 'ok') { setBoardMsg(d.msg || '등록 실패'); return }
    setBoardMsg('현수막 게시를 기록했습니다.')
    openBanners()
  }

  const openCandidates = () => {
    setView('candidates'); setShowResults(false); setTopicId(null); setPost(null); setIssue(null)
  }

  const openPost = async (id: number) => {
    const d = await jget(`/api/rebuild/posts/${id}`)
    setPost(d); setPComment(''); setView('post'); setBoardMsg('')
  }

  const openIssue = async (id: number) => {
    const d = await jget(`/api/rebuild/issues/${id}`)
    setIssue(d); setIssueComment(''); setView('issue'); setBoardMsg('')
  }

  const startWrite = () => {
    titleSpeech.stop(); bodySpeech.stop()
    setView('write'); setBoardMsg('')
    setPTitle(''); setPTopic(String(topicId || topics[0]?.id || ''))
  }

  const savePost = async () => {
    const content = editorRef.current?.getContent() || ''
    const drawing = editorRef.current?.getDrawingData() || ''
    const d = await jpost('/api/rebuild/posts', {
      topic_id: Number(pTopic || topicId || topics[0]?.id || 0),
      title: pTitle, content, drawing_data: drawing,
    })
    if (d.status !== 'ok') { setBoardMsg(d.msg || '등록 실패'); return }
    setView('board'); setPTitle(''); editorRef.current?.setContent('')
    loadAll(); setBoardMsg('글을 등록했습니다.')
  }

  const likePost = async () => {
    if (!post) return
    const d = await jpost(`/api/rebuild/posts/${post.id}/like`)
    if (d.status !== 'ok') { setBoardMsg(d.msg || '실패'); return }
    setPost({ ...post, like_count: d.like_count })
    if (d.candidate) setBoardMsg(`찬성 ${d.threshold}표를 넘어 안건 후보가 되었습니다.`)
    loadAll()
  }

  const sendPostComment = async () => {
    if (!post) return
    const d = await jpost(`/api/rebuild/posts/${post.id}/comments`, { content: pComment })
    if (d.status !== 'ok') { setBoardMsg(d.msg || '등록 실패'); return }
    setPComment(''); openPost(post.id)
  }

  const keepPost = async (id: number) => {
    const d = await jpost(`/api/rebuild/posts/${id}/keep`)
    if (d.status !== 'ok') { setBoardMsg(d.msg || '실패'); return }
    setBoardMsg('글을 계속 유지합니다.')
    if (post && post.id === id) openPost(id)
    loadAll()
  }

  const removePost = async () => {
    if (!post || !confirm('이 글을 삭제할까요?')) return
    await jdel(`/api/rebuild/posts/${post.id}`)
    setView('board'); setPost(null); loadAll()
  }

  const voteIssue = async (s: 'yes' | 'no') => {
    if (!issue) return
    const d = await jpost(`/api/rebuild/issues/${issue.id}/vote`, { stance: s })
    if (d.status !== 'ok') { setBoardMsg(d.msg || '투표 실패'); return }
    openIssue(issue.id)
  }

  const sendIssueComment = async () => {
    if (!issue) return
    const d = await jpost(`/api/rebuild/issues/${issue.id}/comments`, { content: issueComment })
    if (d.status !== 'ok') { setBoardMsg(d.msg || '등록 실패'); return }
    setIssueComment(''); openIssue(issue.id)
  }

  const doLogin = async () => {
    setErr(''); setMsg('')
    const d = await jpost('/api/rebuild/login', { email, password: pw })
    if (d.status !== 'ok') { setErr(d.msg || '로그인 실패'); return }
    await loadMe()
  }

  const doSignup = async () => {
    setErr(''); setMsg('')
    if (!agreePrivacy || !agreeEmail || !agreeTransfer || !agreeOverseas || !agreeAge) {
      setErr('필수 동의 항목을 모두 확인해 주세요.')
      return
    }
    const d = await jpost('/api/rebuild/signup', {
      email, password: pw, name, address,
      agree_privacy: agreePrivacy, agree_email: agreeEmail,
      agree_transfer: agreeTransfer, agree_overseas: agreeOverseas, agree_age: agreeAge,
    })
    if (d.status !== 'ok') { setErr(d.msg || '가입 실패'); return }
    if (d.mail_sent === false) setErr(d.msg || '관리자 알림 메일 발송에 실패했습니다.')
    else setMsg(d.msg || '가입 신청 완료')
    setAuthView('login')
  }

  const doMagic = async () => {
    setErr(''); setMsg('')
    const d = await jpost('/api/rebuild/magic', { email })
    setMsg(d.msg || '')
  }

  const doWithdraw = async () => {
    if (!confirm('회원 탈퇴하시겠습니까? 계정과 작성한 글·댓글이 모두 삭제되며 복구할 수 없습니다.')) return
    const pw = prompt('비밀번호를 입력해 주세요')
    if (!pw) return
    const d = await jpost('/api/rebuild/withdraw', { password: pw })
    if (d.status !== 'ok') { alert(d.msg || '탈퇴 실패'); return }
    alert(d.msg || '탈퇴 처리되었습니다.')
    setMe(null); setAllItems([]); setPost(null); setIssue(null); setResults([]); setTopics([])
    setView('board')
  }

  const doLogout = async () => {
    await jpost('/api/rebuild/logout')
    setMe(null); setAllItems([]); setPost(null); setIssue(null); setResults([]); setTopics([])
    setView('board')
  }

  if (loading) return <div className="container py-5 text-center"><div className="spinner-border text-success" /></div>

  // ---- 로그인 / 가입
  if (!me) {
    return (
      <div className="container py-4" style={{ maxWidth: 560 }}>
        <h4 className="fw-bold mb-1">조국혁신당 여주·양평 지역위원회</h4>
        <p className="text-muted">당원게시판은 <b>당원 승인 후</b> 열람할 수 있습니다.</p>
        <div className="alert alert-light border small">
          <b>이용 절차</b><br />
          ① 가입 (이메일·비밀번호·이름·주소) → ② 이메일 인증 → ③ 위원장 승인 → ④ 열람
          <br />이름·주소는 위원장 메일로만 전달되며 <b>서버에 저장되지 않습니다.</b>
        </div>
        <div className="btn-group w-100 mb-3">
          <button className={`btn ${authView === 'login' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setAuthView('login')}>로그인</button>
          <button className={`btn ${authView === 'signup' ? 'btn-success' : 'btn-outline-success'}`} onClick={() => setAuthView('signup')}>가입</button>
        </div>
        {authView === 'login' ? (
          <div className="border rounded-3 bg-white p-3">
            <input className="form-control mb-2" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" className="form-control mb-2" placeholder="비밀번호" value={pw} onChange={e => setPw(e.target.value)} />
            <button className="btn btn-success w-100 mb-2" onClick={doLogin}>로그인</button>
            <button className="btn btn-outline-secondary w-100" onClick={doMagic}>이메일로 로그인 링크 받기</button>
          </div>
        ) : (
          <div className="border rounded-3 bg-white p-3">
            <input className="form-control mb-2" placeholder="이메일" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" className="form-control mb-2" placeholder="비밀번호 (4자 이상)" value={pw} onChange={e => setPw(e.target.value)} />
            <input className="form-control mb-2" placeholder="이름 (서버에 저장되지 않음)" value={name} onChange={e => setName(e.target.value)} />
            <input className="form-control mb-2" placeholder="주소 (서버에 저장되지 않음)" value={address} onChange={e => setAddress(e.target.value)} />

            <div className="border rounded p-2 mb-2" style={{ background: '#f8f9fa' }}>
              <div className="small fw-bold mb-1">개인정보 수집·이용 동의 (필수)</div>
              <label className="d-flex gap-2 align-items-start small mb-1">
                <input type="checkbox" className="mt-1" checked={agreePrivacy} onChange={e => setAgreePrivacy(e.target.checked)} />
                <span>개인정보 수집·이용에 동의합니다. (이메일·비밀번호, 게시판 운영 목적)</span>
              </label>
              <label className="d-flex gap-2 align-items-start small mb-1">
                <input type="checkbox" className="mt-1" checked={agreeEmail} onChange={e => setAgreeEmail(e.target.checked)} />
                <span>이메일 인증 및 안내 수신에 동의합니다.</span>
              </label>
              <label className="d-flex gap-2 align-items-start small mb-1">
                <input type="checkbox" className="mt-1" checked={agreeTransfer} onChange={e => setAgreeTransfer(e.target.checked)} />
                <span>이름·주소가 위원장 이메일로 전달되는 것에 동의합니다. (서버 미저장)</span>
              </label>
              <label className="d-flex gap-2 align-items-start small mb-1">
                <input type="checkbox" className="mt-1" checked={agreeOverseas} onChange={e => setAgreeOverseas(e.target.checked)} />
                <span>
                  개인정보 <b>국외 이전</b>에 동의합니다.
                  (위원장 메일이 Gmail이라 이름·주소가 미국 Google로 전송됩니다)
                </span>
              </label>
              <label className="d-flex gap-2 align-items-start small mb-1">
                <input type="checkbox" className="mt-1" checked={agreeAge} onChange={e => setAgreeAge(e.target.checked)} />
                <span>만 14세 이상입니다.</span>
              </label>
              <a className="small" href="/rebuild/privacy" target="_blank" rel="noreferrer">개인정보 처리방침 전문 보기</a>
              <button type="button" className="btn btn-sm btn-outline-secondary mt-1" onClick={() => setShowPolicy(v => !v)}>
                {showPolicy ? '동의 내용 닫기' : '동의 내용 자세히 보기'}
              </button>
              {showPolicy && (
                <div className="small text-muted mt-2">
                  {(policy?.items || []).map((it: any) => (
                    <div key={it.key} className="mb-1">· <b>{it.title}</b> — {it.desc}</div>
                  ))}
                  <div className="mt-1">{policy?.rights}</div>
                  <div className="mt-1">동의 버전: {policy?.version}</div>
                </div>
              )}
            </div>

            <button className="btn btn-success w-100" onClick={doSignup}>가입 신청</button>
          </div>
        )}
        {msg && <div className="alert alert-success mt-3 small">{msg}</div>}
        {err && <div className="alert alert-danger mt-3 small">{err}</div>}
      </div>
    )
  }

  if (!me.can_read) {
    return (
      <div className="container py-4" style={{ maxWidth: 560 }}>
        <div className="border rounded-3 bg-white p-4 text-center">
          <h5 className="fw-bold">승인 대기 중</h5>
          <p className="text-muted mb-1">{me.email}</p>
          <p className="small mb-3">현재 상태: <b>{me.status === 'pending' ? '관리자 승인 대기' : me.status === 'rejected' ? '승인 거절' : me.status}</b>
            <br />이메일 인증: {me.email_verified ? '완료' : '미완료'}</p>
          <p className="small text-muted">위원장 승인 후 게시판을 열람할 수 있습니다.</p>
          <button className="btn btn-outline-secondary btn-sm" onClick={doLogout}>로그아웃</button>
        </div>
        {msg && <div className="alert alert-success mt-3 small">{msg}</div>}
      </div>
    )
  }

  const tabBtn = (active: boolean) => `btn btn-sm text-nowrap me-1 mb-1 ${active ? 'btn-success border-0' : 'btn-outline-secondary'}`

  return (
    <div className="container py-3" style={{ maxWidth: 1000 }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="fw-bold mb-0">
          <a href="/" className="text-decoration-none text-success me-2 small">← 홈</a>
          당원게시판
        </h5>
        <div className="small">
          <span className="text-muted me-2">{me.email}{me.committee ? ' · 운영위원' : (me.is_admin ? ' · 책임자' : '')}</span>
          <a className="small text-muted me-2" href="/rebuild/privacy" target="_blank" rel="noreferrer">개인정보 처리방침</a>
          <button className="btn btn-sm btn-outline-secondary me-1" onClick={doLogout}>로그아웃</button>
          <button className="btn btn-sm btn-outline-danger" onClick={doWithdraw}>회원 탈퇴</button>
        </div>
      </div>

      {!me.can_write && (
        <div className="alert alert-warning small py-2">
          온라인 승인 상태입니다. <b>찬반 투표는 가능</b>하며, <b>글쓰기(제안)는 오프라인 확인 후</b> 가능합니다.
        </div>
      )}

      {/* 탭: 전체 / 분류 / 현안 / 공론 결과 / 운영위 */}
      <div className="d-flex overflow-auto pb-1 mb-2" style={{ scrollbarWidth: 'thin' }}>
        <button className={tabBtn(topicId === null && !showResults && view === 'board' && !openGroup)} onClick={() => { setOpenGroup(null); openAll() }}>전체</button>
        <button className={tabBtn(openGroup === '일반' || (!!topicId && topics.find(t => t.id === topicId)?.group === '일반'))}
          onClick={() => { setOpenGroup(openGroup === '일반' ? null : '일반'); setShowResults(false); setView('board') }}>분류</button>
        <button className={tabBtn(openGroup === '현안' || (!!topicId && topics.find(t => t.id === topicId)?.group === '현안'))}
          onClick={() => { setOpenGroup(openGroup === '현안' ? null : '현안'); setShowResults(false); setView('board') }}>현안</button>
        <button className={tabBtn(showResults)} onClick={() => { setOpenGroup(null); openResults() }}>공론 결과</button>
        <button className={tabBtn(view === 'banners')} onClick={() => { setOpenGroup(null); openBanners() }}>현수막</button>
        {(me.committee || me.is_admin) && <button className={tabBtn(view === 'candidates')} onClick={() => { setOpenGroup(null); openCandidates() }}>현안후보</button>}
      </div>

      {/* 분류/현안 목록: 탭을 누르면 아래로 펼쳐짐 */}
      {openGroup && (
        <div className="border rounded-3 bg-white p-2 mb-2">
          {topics.filter(t => t.group === openGroup).map(t => (
            <button key={t.id}
              className="btn btn-link d-block w-100 text-start text-decoration-none py-1 border-bottom"
              onClick={() => { openTopic(t.id); setOpenGroup(null) }}>
              <span className={topicId === t.id ? 'fw-bold text-success' : 'text-dark'}>{t.name}</span>
              {t.description && <span className="text-muted small ms-2">{t.description}</span>}
            </button>
          ))}
          {!topics.filter(t => t.group === openGroup).length && <div className="text-muted small p-1">항목이 없습니다.</div>}
        </div>
      )}

      {boardMsg && <div className="alert alert-success py-2 small">{boardMsg}</div>}

      {/* 글쓰기 화면 (목록 없음) */}
      {view === 'write' && (
        <div className="border rounded-3 bg-white p-3">
          <div className="fw-bold mb-2">글쓰기</div>
          <div className="d-flex gap-2 mb-2">
            <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={pTopic} onChange={e => setPTopic(e.target.value)}>
              {topics.map(t => <option key={t.id} value={t.id}>{t.group} · {t.name}</option>)}
            </select>
            <input ref={titleRef} className="form-control form-control-sm" placeholder="제목" value={pTitle} onChange={e => setPTitle(e.target.value)} />
            <button type="button"
              className={`btn btn-sm ${titleSpeech.listening ? 'btn-danger' : 'btn-outline-secondary'}`}
              style={{ maxWidth: 110 }}
              onClick={() => titleSpeech.listening ? titleSpeech.stop() : titleSpeech.start()}>
              {titleSpeech.listening ? '⏹ 중지' : '🎤 제목'}
            </button>
          </div>
          {(titleSpeech.interim || titleSpeech.error) && (
            <div className={`small mb-2 ${titleSpeech.error ? 'text-danger' : 'text-muted'}`}>
              {titleSpeech.error || `듣는 중… ${titleSpeech.interim}`}
            </div>
          )}
          <ContentEditor ref={editorRef} showLocation={false}
            uploadUrl="/api/rebuild/upload-image" fileUploadUrl="/api/rebuild/upload-file"
            placeholder="내용을 입력하세요. 사진은 Ctrl+V, 자르기·회전·그림판·첨부 모두 가능합니다." />
          <div className="d-flex gap-2 align-items-center mt-2 flex-wrap">
            <button type="button"
              className={`btn btn-sm ${bodySpeech.listening ? 'btn-danger' : 'btn-outline-secondary'}`}
              onClick={() => bodySpeech.listening ? bodySpeech.stop() : bodySpeech.start()}>
              {bodySpeech.listening ? '⏹ 중지' : '🎤 말로 입력'}
            </button>
            {(bodySpeech.interim || bodySpeech.error) && (
              <span className={`small ${bodySpeech.error ? 'text-danger' : 'text-muted'}`}>
                {bodySpeech.error || `듣는 중… ${bodySpeech.interim}`}
              </span>
            )}
          </div>
          <div className="d-flex gap-2 mt-2">
            <button className="btn btn-success" onClick={() => { titleSpeech.stop(); bodySpeech.stop(); savePost() }}>등록</button>
            <button className="btn btn-outline-secondary" onClick={() => { titleSpeech.stop(); bodySpeech.stop(); setView('board') }}>취소</button>
          </div>
        </div>
      )}

      {/* 글 상세 */}
      {view === 'post' && post && (
        <div className="border rounded-3 bg-white p-3">
          <div className="d-flex justify-content-between">
            <div>
              <h6 className="fw-bold mb-1">{post.title}</h6>
              <div className="small text-muted">{post.author} · {new Date(post.created_at).toLocaleString('ko-KR')} · 조회 {post.view_count}</div>
            </div>
            <div className="d-flex gap-1">
              {post.mine && <button className="btn btn-sm btn-outline-danger" onClick={removePost}>삭제</button>}
              <button className="btn btn-sm btn-outline-secondary" onClick={() => { setView('board'); setPost(null) }}>목록</button>
            </div>
          </div>
          <div className="mt-2" dangerouslySetInnerHTML={{ __html: post.content || '' }} />
          {post.drawing_data && <img src={post.drawing_data} alt="첨부 그림" className="img-fluid border rounded mt-2" />}
          {post.expire_at && (
            <div className="alert alert-warning small mt-3">
              올린 지 한 달이 지났지만 찬성표가 <b>{post.like_count}표</b>입니다. 글을 계속 유지하시겠습니까?
              <br />유지하지 않으면 <b>{post.days_left ?? 0}일 후 자동으로 숨김</b> 처리됩니다.
              <div className="d-flex gap-2 mt-2">
                <button className="btn btn-sm btn-success" onClick={() => keepPost(post.id)}>계속 유지</button>
                <button className="btn btn-sm btn-outline-danger" onClick={removePost}>즉시 삭제</button>
              </div>
            </div>
          )}
          {post.keep_until && (
            <div className="alert alert-secondary small mt-3">
              유지 중입니다. 만료일: {new Date(post.keep_until).toLocaleDateString('ko-KR')}
            </div>
          )}
          <div className="mt-2">
            <button className="btn btn-sm btn-outline-success" onClick={likePost}>
              👍 찬성 {post.like_count} / {post.threshold || 10}
            </button>
            {post.candidate && <span className="badge bg-success ms-2">안건 후보</span>}
          </div>
          <div className="border-top mt-3 pt-2">
            <div className="small text-muted mb-1">댓글 {post.comments?.length || 0}</div>
            {(post.comments || []).map((c: any) => (
              <div key={c.id} className="border-top py-1 small">
                <b>{c.author}</b> <span className="text-muted">{new Date(c.created_at).toLocaleString('ko-KR')}</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
              </div>
            ))}
            {me.can_write ? (
              <div className="d-flex gap-2 mt-2">
                <input className="form-control form-control-sm" placeholder="댓글" value={pComment} onChange={e => setPComment(e.target.value)} />
                <button className="btn btn-sm btn-success" onClick={sendPostComment}>등록</button>
              </div>
            ) : <div className="small text-muted">댓글 작성은 오프라인 확인 후 가능합니다.</div>}
          </div>
        </div>
      )}

      {/* 안건 상세 */}
      {view === 'issue' && issue && (
        <div className="border rounded-3 bg-white p-3">
          <div className="d-flex justify-content-between">
            <h6 className="fw-bold">{issue.title}</h6>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { setView('board'); setIssue(null) }}>목록</button>
          </div>
          <div className="bg-light border rounded p-2 mb-2 small">
            {issue.post && (
              <>
                <div>제안글: <b>{issue.post.title}</b></div>
                <div className="text-muted">
                  작성자 {issue.post.author} · {new Date(issue.post.created_at).toLocaleString('ko-KR')}
                </div>
                <div className="text-muted">
                  찬성 {issue.post.like_count} / {issue.post.threshold}
                  {issue.post.candidate_at && (
                    <> → 후보 도달 {new Date(issue.post.candidate_at).toLocaleDateString('ko-KR')}
                      {issue.post.candidate_days !== null && issue.post.candidate_days !== undefined && ` (${issue.post.candidate_days}일 소요)`}
                    </>
                  )}
                </div>
              </>
            )}
            <div className="text-muted mt-1">
              공론화: <b>{new Date(issue.publicized_at || issue.created_at).toLocaleDateString('ko-KR')}</b>
            </div>
            <div className="text-muted">
              운영위 심의: {new Date(issue.created_at).toLocaleDateString('ko-KR')}
              {issue.review_until && <> ~ {new Date(issue.review_until).toLocaleDateString('ko-KR')}</>}
            </div>
            <div className="text-muted">
              공론 투표: {new Date(issue.created_at).toLocaleDateString('ko-KR')}
              {issue.public_until && <> ~ {new Date(issue.public_until).toLocaleDateString('ko-KR')}</>}
              {issue.closed_at && <> · 결과 {new Date(issue.closed_at).toLocaleDateString('ko-KR')}</>}
            </div>
            <div className="text-muted">찬성 {issue.vote_yes}표 · 반대 {issue.vote_no}표</div>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }} className="mb-3">{issue.body}</div>
          <div className="mb-3">
            <div className="small text-muted mb-1">찬반 투표</div>
            <button className={`btn btn-sm me-2 ${issue.my_vote === 'yes' ? 'btn-success' : 'btn-outline-success'}`}
              onClick={() => voteIssue('yes')} disabled={issue.status !== 'open'}>찬성 {issue.vote_yes}</button>
            <button className={`btn btn-sm ${issue.my_vote === 'no' ? 'btn-danger' : 'btn-outline-danger'}`}
              onClick={() => voteIssue('no')} disabled={issue.status !== 'open'}>반대 {issue.vote_no}</button>
          </div>
          <div className="small text-muted mb-1">의견 {issue.comments?.length || 0}</div>
          {(issue.comments || []).map((c: any) => (
            <div key={c.id} className="border-top py-1 small">
              <div>
                <b>{c.author || '당원'}</b>
                <span className="text-muted ms-2">{c.created_at ? new Date(c.created_at).toLocaleString('ko-KR') : ''}</span>
                {c.stance === 'yes' && <span className="badge bg-success ms-2">찬성</span>}
                {c.stance === 'no' && <span className="badge bg-danger ms-2">반대</span>}
              </div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{c.content}</div>
            </div>
          ))}
          {me.is_admin ? (
            <div className="d-flex gap-2 mt-2">
              <input className="form-control form-control-sm" placeholder="공론 활동 기록 (관리자만 작성)"
                value={issueComment} onChange={e => setIssueComment(e.target.value)} />
              <button className="btn btn-sm btn-success" onClick={sendIssueComment}>기록</button>
            </div>
          ) : (
            <div className="small text-muted mt-2">공론 활동 기록은 관리자만 작성합니다.</div>
          )}
          {issue.result_summary && (
            <div className="alert alert-light border mt-3 small"><b>공론 결과</b><br />{issue.result_summary}</div>
          )}
        </div>
      )}

      {/* 현수막 (읽기 전용) */}
      {view === 'banners' && !banner && (
        <div>
          {myBanners.length > 0 && (
            <div className="mb-4">
              <div className="fw-bold mb-2">내가 맡은 현수막 <span className="text-muted small">{myBanners.length}</span></div>
              {myBanners.map((b: any) => (
                <div key={b.id} className="border rounded-3 bg-white p-3 mb-2">
                  <div className="fw-bold">{b.title}</div>
                  <div className="small text-muted">
                    상태: {b.status === 'draft' ? '작성' : b.status === 'posted' ? '게시' : '완료'}
                    {b.assign?.posted_at && <> · 게시일 {new Date(b.assign.posted_at).toLocaleDateString('ko-KR')}</>}
                  </div>
                  {b.assign?.photo_path ? (
                    <div className="mt-2">
                      <img src={b.assign.photo_path} alt="게시 사진" className="img-fluid rounded border" style={{ maxHeight: 260 }} />
                      <div className="small mt-1">
                        {b.assign.lat && b.assign.lng && (
                          <a href={`https://map.kakao.com/link/map/${b.assign.lat},${b.assign.lng}`} target="_blank" rel="noreferrer">
                            📍 위치 보기 ({Number(b.assign.lat).toFixed(4)}, {Number(b.assign.lng).toFixed(4)})
                          </a>
                        )}
                      </div>
                      {b.assign.memo && <div className="small text-muted mt-1">{b.assign.memo}</div>}
                    </div>
                  ) : (
                    <div className="mt-2">
                      <input type="file" accept="image/*" className="form-control form-control-sm mb-2"
                        onChange={e => setPostPhoto(prev => ({ ...prev, [b.id]: e.target.files?.[0] || null }))} />
                      <input className="form-control form-control-sm mb-2" placeholder="메모(선택)"
                        value={postMemo[b.id] || ''} onChange={e => setPostMemo(prev => ({ ...prev, [b.id]: e.target.value }))} />
                      <div className="d-flex gap-2 align-items-center">
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => getGeo(b.id)}>현재 위치</button>
                        {geo[b.id] && <span className="small text-success">위치 확인됨</span>}
                        <button className="btn btn-sm btn-success" onClick={() => postBanner(b.id)}>게시 완료 기록</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="fw-bold mb-2">현수막 <span className="text-muted small">{banners.length}</span></div>
          {banners.map(b => (
            <div key={b.id} className="border rounded-3 bg-white p-3 mb-2">
              <button className="btn btn-link p-0 text-decoration-none text-dark fw-bold text-start"
                onClick={() => setBanner(b)}>{b.title}</button>
              <div className="small text-muted">
                {new Date(b.created_at).toLocaleDateString('ko-KR')} · 공감 {b.like_count} · 댓글 {b.comment_count}
              </div>
            </div>
          ))}
          {!banners.length && <div className="text-muted small">현수막 글이 없습니다.</div>}
        </div>
      )}

      {view === 'banners' && banner && (
        <div className="border rounded-3 bg-white p-3">
          <div className="d-flex justify-content-between">
            <h6 className="fw-bold mb-0">{banner.title}</h6>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setBanner(null)}>목록</button>
          </div>
          <div className="small text-muted mb-2">{new Date(banner.created_at).toLocaleString('ko-KR')}</div>
          {banner.summary && <div className="text-muted mb-2">{banner.summary}</div>}
          {banner.image_path && <img src={banner.image_path} alt="" className="img-fluid rounded mb-2" />}
          {/<[a-z][\s\S]*>/i.test(banner.body || '') ? (
            <div dangerouslySetInnerHTML={{ __html: banner.body }} />
          ) : (
            <div style={{ whiteSpace: 'pre-wrap' }}>{banner.body}</div>
          )}
          <div className="small text-muted mt-3">공감 {banner.like_count} · 댓글 {banner.comment_count} · 조회 {banner.view_count}</div>
        </div>
      )}

      {/* 현안 후보 (운영위원 전용) */}
      {view === 'candidates' && <JogukCandidatesPage />}

      {/* 공론 결과 */}
      {view === 'board' && showResults && (
        <div>
          <div className="fw-bold mb-2">공론 결과 <span className="text-muted small">{results.length}</span></div>
          {results.map(r => (
            <div key={r.id} className="border rounded-3 bg-white p-3 mb-2">
              <button className="btn btn-link p-0 text-decoration-none fw-bold text-dark" onClick={() => openIssue(r.id)}>{r.title}</button>
              <div className="small text-muted">
                {r.status === 'open' ? '진행중' : '종료'} · 찬성 {r.vote_yes} / 반대 {r.vote_no}
                {r.review_until && <> · 심의 ~{new Date(r.review_until).toLocaleDateString('ko-KR')}</>}
                {r.public_until && <> · 공론 ~{new Date(r.public_until).toLocaleDateString('ko-KR')}</>}
              </div>
              {r.result_summary && <div className="small mt-1">{r.result_summary}</div>}
            </div>
          ))}
          {!results.length && <div className="text-muted small">아직 공론 결과가 없습니다.</div>}
        </div>
      )}

      {/* 게시글 목록 */}
      {view === 'board' && !showResults && (
        <div>
          <div className="d-flex justify-content-between align-items-center mb-2">
            <div className="fw-bold">전체 글 <span className="text-muted small">{allItems.length}</span></div>
            {me.can_write && <button className="btn btn-sm btn-success" onClick={startWrite}>✏️ 글쓰기</button>}
          </div>
          {allItems.map((it: any) => {
            const t = topics.find(x => x.id === it.topic_id)
            const label = it.kind === 'issue' ? '공론 · 안건' : `${t?.group || '일반'} · ${t?.name || it.topic_name || ''}`
            return (
              <div key={`${it.kind}-${it.id}`} className="border rounded-3 bg-white p-3 mb-2 d-flex justify-content-between align-items-start gap-2">
                <div className="flex-grow-1">
                  <button className="btn btn-link p-0 text-decoration-none text-dark fw-bold text-start"
                    onClick={() => it.kind === 'issue' ? openIssue(it.id) : openPost(it.id)}>{it.title}</button>
                  <div className="small text-muted">
                    {it.kind === 'issue'
                      ? `${it.status === 'open' ? '진행중' : '종료'} · 찬성 ${it.vote_yes} / 반대 ${it.vote_no}`
                      : `${it.author} · ${new Date(it.created_at).toLocaleDateString('ko-KR')} · 찬성 ${it.like_count}/${it.threshold || 10} · 댓글 ${it.comment_count}`}
                    {it.kind === 'post' && it.candidate && <span className="badge bg-success ms-2">안건 후보</span>}
                  </div>
                </div>
                <div className="text-end small text-nowrap">
                  <span className={`badge ${it.kind === 'issue' ? 'bg-primary' : 'bg-light text-dark'}`}>{label}</span>
                  {it.kind === 'post' && it.expire_at && (
                    <div className="mt-1">
                      <span className="badge bg-danger">만료 D-{it.days_left ?? 0}</span>
                      <div className="mt-1 d-flex gap-1 justify-content-end">
                        <button className="btn btn-sm btn-outline-success py-0" onClick={() => keepPost(it.id)}>유지</button>
                        <button className="btn btn-sm btn-outline-danger py-0" onClick={() => { openPost(it.id) }}>삭제</button>
                      </div>
                    </div>
                  )}
                  {it.kind === 'post' && it.keep_until && (
                    <div className="mt-1"><span className="badge bg-secondary">유지 D-{it.days_left ?? 0}</span></div>
                  )}
                </div>
              </div>
            )
          })}
          {!allItems.length && <div className="text-muted small">게시글이 없습니다.</div>}
        </div>
      )}
    </div>
  )
}
