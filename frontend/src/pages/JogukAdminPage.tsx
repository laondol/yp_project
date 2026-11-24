import { useEffect, useRef, useState } from 'react'
import { jget, jpost, jput, jdel } from '../lib/joguk'
import JogukCandidatesPage from './JogukCandidatesPage'
import ContentEditor from '../components/contentEditor/ContentEditor'
import type { ContentEditorHandle } from '../components/contentEditor/ContentEditor'

type Tab = 'banners' | 'comments' | 'accounts' | 'cards' | 'stats' | 'issues' | 'topics' | 'posts' | 'candidates'

export default function JogukAdminPage() {
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    const allowed = ['banners', 'comments', 'accounts', 'cards', 'stats', 'issues', 'topics', 'posts', 'candidates']
    return (t && allowed.includes(t) ? t : 'banners') as Tab
  })
  const [overview, setOverview] = useState<any>(null)
  const [msg, setMsg] = useState('')

  // banners
  const [banners, setBanners] = useState<any[]>([])
  const [assignEmail, setAssignEmail] = useState<Record<number, string>>({})
  const [assignees, setAssignees] = useState<Record<number, any[]>>({})
  const bannerEditorRef = useRef<ContentEditorHandle | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [bTitle, setBTitle] = useState('')
  const [bSummary, setBSummary] = useState('')
  const [bBody, setBBody] = useState('')

  // comments
  const [comments, setComments] = useState<any[]>([])
  const [cFilter, setCFilter] = useState('')

  // accounts
  const [accounts, setAccounts] = useState<any[]>([])
  const [accFilter, setAccFilter] = useState('')

  // cards
  const [cards, setCards] = useState<any[]>([])
  const [cardSide, setCardSide] = useState('central')
  const [cardTitle, setCardTitle] = useState('')
  const [cardSub, setCardSub] = useState('')

  // stats
  const [stats, setStats] = useState<any[]>([])

  // posts (관리)
  const [adminPosts, setAdminPosts] = useState<any[]>([])

  // topics (관리)
  const [adminTopics, setAdminTopics] = useState<any[]>([])
  const [newTopicName, setNewTopicName] = useState('')
  const [newTopicGroup, setNewTopicGroup] = useState('일반')

  // issues
  const [issues, setIssues] = useState<any[]>([])
  const [iTitle, setITitle] = useState('')
  const [iBody, setIBody] = useState('')

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(''), 2500) }

  const refresh = async () => {
    setOverview(await jget('/api/admin/rebuild/overview'))
  }

  const loadBanners = async () => {
    const d = await jget('/api/admin/rebuild/banners')
    setBanners(d.items || [])
  }
  const loadComments = async () => {
    const d = await jget(`/api/admin/rebuild/comments${cFilter ? `?banner_id=${cFilter}` : ''}`)
    setComments(d.items || [])
  }
  const loadAccounts = async () => {
    const d = await jget(`/api/admin/rebuild/accounts${accFilter ? `?status=${accFilter}` : ''}`)
    setAccounts(d.items || [])
  }
  const loadCards = async () => {
    const d = await jget('/api/admin/rebuild/cards')
    setCards(d.items || [])
  }
  const loadStats = async () => {
    const d = await jget('/api/admin/rebuild/stats')
    setStats(d.items || [])
  }
  const loadAdminPosts = async () => {
    const d = await jget('/api/admin/rebuild/posts')
    setAdminPosts(d.items || [])
  }

  const setPostStatus = async (pp: any, status: string) => {
    await jpost(`/api/admin/rebuild/posts/${pp.id}/status`, { status })
    loadAdminPosts(); flash('처리했습니다.')
  }

  const loadTopicsAdmin = async () => {
    const d = await jget('/api/admin/rebuild/topics')
    setAdminTopics(d.items || [])
  }

  const addTopic = async () => {
    const d = await jpost('/api/admin/rebuild/topics', { name: newTopicName, group: newTopicGroup })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    setNewTopicName(''); loadTopicsAdmin(); loadIssues(); flash('주제를 추가했습니다.')
  }

  const saveTopic = async (t: any) => {
    const d = await jput(`/api/admin/rebuild/topics/${t.id}`, {
      name: t.name, group: t.group, active: t.active, sort_order: t.sort_order,
    })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    loadTopicsAdmin(); loadIssues(); flash('저장했습니다.')
  }

  const removeTopic = async (t: any) => {
    if (!confirm(`"${t.name}" 주제를 삭제할까요?`)) return
    const d = await jdel(`/api/admin/rebuild/topics/${t.id}`)
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    loadTopicsAdmin(); loadIssues(); flash('삭제했습니다.')
  }

  const loadIssues = async () => {
    const d = await jget('/api/admin/rebuild/issues')
    setIssues(d.items || [])
  }

  useEffect(() => { refresh(); loadBanners(); loadIssues() }, [])
  useEffect(() => {
    if (tab === 'comments') loadComments()
    if (tab === 'accounts') loadAccounts()
    if (tab === 'cards') loadCards()
    if (tab === 'stats') loadStats()
    if (tab === 'issues') loadIssues()
    if (tab === 'topics') loadTopicsAdmin()
    if (tab === 'posts') loadAdminPosts()
    if (tab === 'banners') loadBanners()
  }, [tab, cFilter, accFilter])

  const createBanner = async () => {
    const content = bannerEditorRef.current?.getContent() || bBody
    const drawing = bannerEditorRef.current?.getDrawingData() || ''
    const body = drawing ? `${content}<div><img src="${drawing}" style="max-width:100%" /></div>` : content
    if (editingId) {
      const d = await jput(`/api/admin/rebuild/banners/${editingId}`, { title: bTitle, summary: bSummary, body, is_public: true })
      if (d.status !== 'ok') { flash(d.msg || '실패'); return }
      flash('글을 수정했습니다.')
    } else {
      const d = await jpost('/api/admin/rebuild/banners', { title: bTitle, summary: bSummary, body, is_public: true })
      if (d.status !== 'ok') { flash(d.msg || '실패'); return }
      flash('글을 등록했습니다.')
    }
    setEditingId(null); setBTitle(''); setBSummary(''); setBBody('')
    bannerEditorRef.current?.setContent('')
    loadBanners(); refresh()
  }

  const startEdit = (b: any) => {
    setEditingId(b.id); setBTitle(b.title || ''); setBSummary(b.summary || ''); setBBody(b.body || '')
    bannerEditorRef.current?.setContent(b.body || '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const toggleBanner = async (b: any) => {
    await jput(`/api/admin/rebuild/banners/${b.id}`, {
      title: b.title, summary: b.summary, body: b.body, image_path: b.image_path, is_public: !b.is_public,
    })
    loadBanners(); flash('공개 상태를 변경했습니다.')
  }

  const setBannerStatus = async (b: any, status: string) => {
    const d = await jpost(`/api/admin/rebuild/banners/${b.id}/status`, { status })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    loadBanners(); flash('상태를 변경했습니다.')
  }

  const loadAssignees = async (bid: number) => {
    const d = await jget(`/api/admin/rebuild/banners/${bid}/assignees`)
    setAssignees(prev => ({ ...prev, [bid]: d.items || [] }))
  }

  const addAssignee = async (b: any) => {
    const email = (assignEmail[b.id] || '').trim()
    if (!email) return
    const d = await jpost(`/api/admin/rebuild/banners/${b.id}/assignees`, { email })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    setAssignEmail(prev => ({ ...prev, [b.id]: '' }))
    loadAssignees(b.id); flash('담당 당원을 추가했습니다.')
  }

  const removeAssignee = async (b: any, aid: number) => {
    await jdel(`/api/admin/rebuild/banners/${b.id}/assignees/${aid}`)
    loadAssignees(b.id)
  }

  const removeBanner = async (b: any) => {
    if (!confirm(`"${b.title}" 글과 댓글을 삭제할까요?`)) return
    await jdel(`/api/admin/rebuild/banners/${b.id}`)
    loadBanners(); refresh(); flash('삭제했습니다.')
  }

  const setCommentStatus = async (c: any, status: string) => {
    await jpost(`/api/admin/rebuild/comments/${c.id}/status`, { status })
    loadComments(); flash('처리했습니다.')
  }

  const toggleBannerPoster = async (a: any) => {
    const d = await jpost('/api/rebuild/banner-poster/toggle', { account_id: a.id, on: !a.banner_poster })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    loadAccounts(); flash(a.banner_poster ? '현수막 게시자 해제' : '현수막 게시자 지정')
  }

  const toggleCommittee = async (a: any) => {
    const d = await jpost('/api/rebuild/committee/toggle', { account_id: a.id, on: !a.committee })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    loadAccounts(); flash(a.committee ? '운영위원 해제' : '운영위원 지정')
  }

  const setAccountStatus = async (a: any, status: string) => {
    await jpost(`/api/admin/rebuild/accounts/${a.id}/status`, { status })
    loadAccounts(); refresh(); flash('변경했습니다.')
  }

  const addCard = async () => {
    const d = await jpost('/api/admin/rebuild/cards', { side: cardSide, title: cardTitle, subtitle: cardSub })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    setCardTitle(''); setCardSub(''); loadCards(); flash('카드를 추가했습니다.')
  }

  const saveStats = async () => {
    await jpost('/api/admin/rebuild/stats', { items: stats })
    loadStats(); flash('통계를 저장했습니다.')
  }

  const createIssue = async () => {
    const d = await jpost('/api/admin/rebuild/issues', { title: iTitle, body: iBody })
    if (d.status !== 'ok') { flash(d.msg || '실패'); return }
    setITitle(''); setIBody(''); loadIssues(); refresh(); flash('안건을 등록했습니다.')
  }

  const closeIssue = async (it: any) => {
    const summary = prompt('공론 결과 요약을 입력하세요 (현수막 게시판 카드로 노출됩니다)', it.result_summary || '')
    if (summary === null) return
    await jput(`/api/admin/rebuild/issues/${it.id}`, { status: 'closed', result_summary: summary })
    loadIssues(); flash('종료 처리했습니다.')
  }

  return (
    <div className="container py-3" style={{ maxWidth: 1100 }}>
      <h5 className="fw-bold mb-1">조국혁신당 여주·양평 지역위원회 (관리)</h5>
      <p className="text-muted small mb-3">현수막 QR 게시판 · 당원게시판 관리</p>

      {overview && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {[
            ['현수막 글', overview.banners], ['댓글', overview.comments],
            ['익명 댓글', overview.anonymous], ['당원 대기', overview.pending],
            ['당원 승인', overview.approved], ['공론 안건', overview.issues],
          ].map(([k, v]) => (
            <div key={String(k)} className="border rounded-3 px-3 py-2 bg-white text-center flex-fill">
              <div className="small text-muted">{k}</div>
              <div className="fw-bold">{v}</div>
            </div>
          ))}
        </div>
      )}

      {msg && <div className="alert alert-success py-2 small">{msg}</div>}

      <ul className="nav nav-tabs mb-3">
        {([['banners', '현수막 글'], ['comments', '댓글'], ['accounts', '당원 승인'], ['issues', '공론 안건'], ['candidates', '현안 후보'], ['posts', '게시글'], ['topics', '주제'], ['cards', '카드'], ['stats', '통계']] as [Tab, string][])
          .map(([k, label]) => (
            <li className="nav-item" key={k}>
              <button className={`nav-link ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>
            </li>
          ))}
      </ul>

      {tab === 'banners' && (
        <div>
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="fw-bold mb-2">현수막 글 등록</div>
            <input className="form-control form-control-sm mb-2" placeholder="제목" value={bTitle} onChange={e => setBTitle(e.target.value)} />
            <input className="form-control form-control-sm mb-2" placeholder="한 줄 설명" value={bSummary} onChange={e => setBSummary(e.target.value)} />
            <ContentEditor ref={bannerEditorRef} showLocation={false}
              uploadUrl="/api/admin/rebuild/upload-image" fileUploadUrl="/api/admin/rebuild/upload-file"
              placeholder="본문을 입력하세요. 사진 붙여넣기·자르기·회전·그림판·파일첨부·링크 모두 가능합니다." />
            <div className="d-flex gap-2 mt-2">
              <button className="btn btn-sm btn-success" onClick={createBanner}>{editingId ? '수정 저장' : '등록'}</button>
              {editingId && <button className="btn btn-sm btn-outline-secondary" onClick={() => { setEditingId(null); setBTitle(''); setBSummary(''); setBBody(''); bannerEditorRef.current?.setContent('') }}>취소</button>}
            </div>
          </div>

          {banners.map(b => (
            <div key={b.id} className="border rounded-3 bg-white p-3 mb-2">
              <div className="d-flex justify-content-between align-items-start">
                <div>
                  <div className="fw-bold">{b.title} {!b.is_public && <span className="badge bg-secondary">비공개</span>}</div>
                  <div className="small text-muted">{b.summary}</div>
                  <div className="d-flex gap-2 align-items-start mt-2">
                    <img src={`/api/rebuild/banner/${b.token}/qr.png?size=800`} alt="QR" style={{ width: 150, height: 150 }} className="border rounded" />
                    <div className="small">
                      <div>QR 주소: <code>{b.public_url || `/rebuild/${b.token}`}</code></div>
                      <div className="d-flex gap-1 mt-1 flex-wrap">
                        <button className="btn btn-sm btn-outline-secondary py-0"
                          onClick={() => { navigator.clipboard?.writeText(b.public_url || `${location.origin}/rebuild/${b.token}`); flash('QR 링크를 복사했습니다.') }}>주소 복사</button>
                        <a className="btn btn-sm btn-outline-secondary py-0" href={`/api/rebuild/banner/${b.token}/qr.png?size=1200`} target="_blank" rel="noreferrer">QR 크게</a>
                        <a className="btn btn-sm btn-outline-secondary py-0" href={`/api/rebuild/banner/${b.token}/qr.png?size=1200`} download={`rebuild-${b.token}.png`}>QR 저장</a>
                        <a className="btn btn-sm btn-outline-success py-0" href={`/rebuild/${b.token}`} target="_blank" rel="noreferrer">열기</a>
                      </div>
                    </div>
                  </div>
                  <div className="small text-muted">공감 {b.like_count} · 댓글 {b.comment_count}</div>
                  <div className="mt-2 small">
                    <span className={`badge ${b.status === 'done' ? 'bg-secondary' : b.status === 'posted' ? 'bg-success' : 'bg-warning text-dark'}`}>
                      {b.status === 'draft' ? '작성' : b.status === 'posted' ? '게시' : '완료'}
                    </span>
                    <div className="d-flex gap-1 mt-1 flex-wrap">
                      <button className="btn btn-sm btn-outline-success py-0" onClick={() => setBannerStatus(b, 'posted')}>게시</button>
                      <button className="btn btn-sm btn-outline-secondary py-0" onClick={() => setBannerStatus(b, 'done')}>완료</button>
                      <button className="btn btn-sm btn-outline-warning py-0" onClick={() => { loadAssignees(b.id) }}>담당자</button>
                    </div>
                    {assignees[b.id] && (
                      <div className="mt-2 border-top pt-2">
                        <div className="d-flex gap-1 mb-1">
                          <input className="form-control form-control-sm" placeholder="당원 이메일"
                            value={assignEmail[b.id] || ''} onChange={e => setAssignEmail(prev => ({ ...prev, [b.id]: e.target.value }))} />
                          <button className="btn btn-sm btn-success" onClick={() => addAssignee(b)}>추가</button>
                        </div>
                        {(assignees[b.id] || []).map(a => (
                          <div key={a.account_id} className="d-flex justify-content-between align-items-center">
                            <span>{a.email} {a.photo_path ? '· 게시완료' : '· 미게시'}</span>
                            <button className="btn btn-sm btn-outline-danger py-0" onClick={() => removeAssignee(b, a.account_id)}>삭제</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="d-flex gap-1">
                  <button className="btn btn-sm btn-outline-primary" onClick={() => startEdit(b)}>수정</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleBanner(b)}>{b.is_public ? '비공개' : '공개'}</button>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => removeBanner(b)}>삭제</button>
                </div>
              </div>
            </div>
          ))}
          {!banners.length && <div className="text-muted small">등록된 글이 없습니다.</div>}
        </div>
      )}

      {tab === 'comments' && (
        <div>
          <div className="d-flex gap-2 mb-2">
            <select className="form-select form-select-sm" style={{ maxWidth: 260 }} value={cFilter} onChange={e => setCFilter(e.target.value)}>
              <option value="">전체 글</option>
              {banners.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
            </select>
            <button className="btn btn-sm btn-outline-secondary" onClick={loadComments}>새로고침</button>
          </div>
          {comments.map(c => (
            <div key={c.id} className="border rounded-3 bg-white p-3 mb-2">
              <div className="d-flex justify-content-between">
                <div className="small">
                  <b>{c.masked_email}</b>
                  {c.is_anonymous && <span className="badge bg-warning text-dark ms-1">익명</span>}
                  <span className="badge bg-light text-dark ms-1">{c.status}</span>
                  <span className="text-muted ms-2">{new Date(c.created_at).toLocaleString('ko-KR')}</span>
                </div>
                <div className="d-flex gap-1">
                  {c.status !== 'visible' && <button className="btn btn-sm btn-outline-success" onClick={() => setCommentStatus(c, 'visible')}>공개</button>}
                  {c.status === 'visible' && <button className="btn btn-sm btn-outline-secondary" onClick={() => setCommentStatus(c, 'hidden')}>숨김</button>}
                  <button className="btn btn-sm btn-outline-danger" onClick={() => setCommentStatus(c, 'flagged')}>삭제예정</button>
                </div>
              </div>
              <div className="mt-2" style={{ whiteSpace: 'pre-wrap' }}>{c.content || '(내용 없음)'}</div>
              {c.drawing_path && <img src={c.drawing_path} alt="첨부 그림" className="img-fluid border rounded mt-2" style={{ maxHeight: 240 }} />}
              {(c.files || []).map((f: string) => <div key={f}><a href={f} target="_blank" rel="noreferrer">첨부파일</a></div>)}
              {c.link_url && <div><a href={c.link_url} target="_blank" rel="noreferrer">{c.link_url}</a></div>}
            </div>
          ))}
          {!comments.length && <div className="text-muted small">댓글이 없습니다.</div>}
        </div>
      )}

      {tab === 'accounts' && (
        <div>
          <div className="d-flex gap-2 mb-2">
            <select className="form-select form-select-sm" style={{ maxWidth: 200 }} value={accFilter} onChange={e => setAccFilter(e.target.value)}>
              <option value="">전체</option>
              <option value="pending">승인 대기</option>
              <option value="approved">승인</option>
              <option value="offline">오프라인 확인</option>
              <option value="rejected">거절</option>
              <option value="left">탈당</option>
            </select>
          </div>
          <div className="alert alert-light border small">
            승인은 가입 알림 메일의 <b>[승인]</b> 링크로도 가능합니다. 이름·주소는 서버에 저장되지 않습니다.
          </div>
          {accounts.map(a => (
            <div key={a.id} className="border rounded-3 bg-white p-2 mb-2 d-flex justify-content-between align-items-center">
              <div className="small">
                <b>{a.email}</b>
                <span className="badge bg-light text-dark ms-2">{a.status}</span>
                <span className="text-muted ms-2">이메일 인증 {a.email_verified ? '완료' : '미완료'}</span>
              </div>
              <div className="d-flex gap-1 align-items-center">
                {a.committee && <span className="badge bg-success">운영위</span>}
                {a.banner_poster && <span className="badge bg-info text-dark">현수막 게시자</span>}
                <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleCommittee(a)}>
                  {a.committee ? '운영위 해제' : '운영위 지정'}
                </button>
                <button className="btn btn-sm btn-outline-info" onClick={() => toggleBannerPoster(a)}>
                  {a.banner_poster ? '게시자 해제' : '현수막 게시자'}
                </button>
                {a.status === 'approved' && (
                  <button className="btn btn-sm btn-outline-success"
                    onClick={() => { if (confirm(`${a.email} 님을 오프라인 확인(글쓰기 가능)으로 변경할까요?`)) setAccountStatus(a, 'offline') }}>오프라인 승인</button>
                )}
                {(a.status === 'approved' || a.status === 'offline') && (
                  <button className="btn btn-sm btn-outline-danger"
                    onClick={() => { if (confirm(`${a.email} 님을 탈당 처리할까요?`)) setAccountStatus(a, 'left') }}>탈당</button>
                )}
              </div>
            </div>
          ))}
          {!accounts.length && <div className="text-muted small">계정이 없습니다.</div>}
        </div>
      )}

      {tab === 'issues' && (
        <div>
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="fw-bold mb-2">공론 안건 등록</div>
            <div className="small text-muted mb-2">주제: 공론 (모든 안건은 공론으로 등록됩니다)</div>
            <input className="form-control form-control-sm mb-2" placeholder="안건 제목" value={iTitle} onChange={e => setITitle(e.target.value)} />
            <textarea className="form-control form-control-sm mb-2" rows={3} placeholder="설명" value={iBody} onChange={e => setIBody(e.target.value)} />
            <button className="btn btn-sm btn-success" onClick={createIssue}>등록</button>
          </div>
          {issues.map(it => (
            <div key={it.id} className="border rounded-3 bg-white p-3 mb-2">
              <div className="d-flex justify-content-between">
                <div>
                  <div className="fw-bold">{it.title}</div>
                  <div className="small text-muted">
                    {it.status === 'open' ? '진행중' : '종료'} · 찬성 {it.vote_yes} / 반대 {it.vote_no}
                  </div>
                  {it.result_summary && <div className="small mt-1">결과: {it.result_summary}</div>}
                </div>
                <div className="d-flex gap-1">
                  {it.status === 'open' && <button className="btn btn-sm btn-outline-success" onClick={() => closeIssue(it)}>종료+요약</button>}
                  <button className="btn btn-sm btn-outline-danger" onClick={async () => { if (confirm('삭제할까요?')) { await jdel(`/api/admin/rebuild/issues/${it.id}`); loadIssues(); refresh() } }}>삭제</button>
                </div>
              </div>
            </div>
          ))}
          {!issues.length && <div className="text-muted small">안건이 없습니다.</div>}
        </div>
      )}

      {tab === 'candidates' && <JogukCandidatesPage />}

      {tab === 'posts' && (
        <div>
          {adminPosts.map(pp => (
            <div key={pp.id} className="border rounded-3 bg-white p-3 mb-2 d-flex justify-content-between align-items-center">
              <div className="small">
                <b>{pp.title}</b>
                <div className="text-muted">{pp.topic_name} · {pp.author} · {new Date(pp.created_at).toLocaleString('ko-KR')} · 댓글 {pp.comment_count}</div>
              </div>
              <div className="d-flex gap-1">
                <a className="btn btn-sm btn-outline-success" href={`/rebuild/member`} target="_blank" rel="noreferrer">게시판</a>
                {pp.status !== 'hidden' ? (
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setPostStatus(pp, 'hidden')}>숨김</button>
                ) : (
                  <button className="btn btn-sm btn-outline-success" onClick={() => setPostStatus(pp, 'visible')}>공개</button>
                )}
              </div>
            </div>
          ))}
          {!adminPosts.length && <div className="text-muted small">게시글이 없습니다.</div>}
        </div>
      )}

      {tab === 'topics' && (
        <div>
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="fw-bold mb-2">주제 추가</div>
            <div className="d-flex gap-2">
              <select className="form-select form-select-sm" style={{ maxWidth: 120 }} value={newTopicGroup} onChange={e => setNewTopicGroup(e.target.value)}>
                <option value="일반">일반</option>
                <option value="현안">현안</option>
              </select>
              <input className="form-control form-control-sm" placeholder="주제명 (예: 후기)" value={newTopicName}
                onChange={e => setNewTopicName(e.target.value)} />
              <button className="btn btn-sm btn-success" onClick={addTopic}>추가</button>
            </div>
          </div>

          {adminTopics.map(t => (
            <div key={t.id} className="border rounded-3 bg-white p-3 mb-2">
              <div className="d-flex gap-2 align-items-center flex-wrap">
                <select className="form-select form-select-sm" style={{ maxWidth: 100 }}
                  value={t.group} onChange={e => setAdminTopics(prev => prev.map(x => x.id === t.id ? { ...x, group: e.target.value } : x))}>
                  <option value="일반">일반</option>
                  <option value="현안">현안</option>
                </select>
                <input className="form-control form-control-sm" style={{ maxWidth: 220 }} value={t.name}
                  onChange={e => setAdminTopics(prev => prev.map(x => x.id === t.id ? { ...x, name: e.target.value } : x))} />
                <input className="form-control form-control-sm" style={{ maxWidth: 90 }} type="number" value={t.sort_order}
                  onChange={e => setAdminTopics(prev => prev.map(x => x.id === t.id ? { ...x, sort_order: Number(e.target.value) } : x))} title="노출 순서" />
                <label className="d-flex align-items-center gap-1 small">
                  <input type="checkbox" checked={t.active}
                    onChange={e => setAdminTopics(prev => prev.map(x => x.id === t.id ? { ...x, active: e.target.checked } : x))} />
                  노출
                </label>
                <span className="small text-muted">안건 {t.issue_count}건</span>
                <button className="btn btn-sm btn-success" onClick={() => saveTopic(t)}>저장</button>
                <button className="btn btn-sm btn-outline-danger" onClick={() => removeTopic(t)}>삭제</button>
              </div>
            </div>
          ))}
          {!adminTopics.length && <div className="text-muted small">주제가 없습니다.</div>}
        </div>
      )}

      {tab === 'cards' && (
        <div>
          <div className="border rounded-3 bg-white p-3 mb-3">
            <div className="fw-bold mb-2">카드 추가</div>
            <div className="d-flex gap-2 mb-2">
              <select className="form-select form-select-sm" style={{ maxWidth: 160 }} value={cardSide} onChange={e => setCardSide(e.target.value)}>
                <option value="central">중앙당(좌)</option>
                <option value="local">지역위(우)</option>
              </select>
              <input className="form-control form-control-sm" placeholder="제목" value={cardTitle} onChange={e => setCardTitle(e.target.value)} />
              <input className="form-control form-control-sm" placeholder="부제" value={cardSub} onChange={e => setCardSub(e.target.value)} />
              <button className="btn btn-sm btn-success" onClick={addCard}>추가</button>
            </div>
          </div>
          {['central', 'local'].map(side => (
            <div key={side} className="mb-3">
              <div className="fw-bold mb-1">{side === 'central' ? '중앙당 카드' : '지역위원회 카드'}</div>
              {cards.filter(c => c.side === side).map(c => (
                <div key={c.id} className="border rounded-3 bg-white p-2 mb-1 d-flex justify-content-between">
                  <div className="small"><b>{c.title}</b> <span className="text-muted">{c.subtitle}</span></div>
                  <button className="btn btn-sm btn-outline-danger" onClick={async () => { await jdel(`/api/admin/rebuild/cards/${c.id}`); loadCards() }}>삭제</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {tab === 'stats' && (
        <div className="border rounded-3 bg-white p-3">
          <div className="fw-bold mb-2">상단 통계 (수동 입력)</div>
          {stats.map((s, i) => (
            <div key={s.key} className="d-flex gap-2 mb-2 align-items-center">
              <div className="small" style={{ width: 160 }}>{s.label}</div>
              <input className="form-control form-control-sm" value={s.value}
                onChange={e => { const next = [...stats]; next[i] = { ...s, value: e.target.value }; setStats(next) }} />
            </div>
          ))}
          <button className="btn btn-sm btn-success" onClick={saveStats}>저장</button>
        </div>
      )}
    </div>
  )
}
