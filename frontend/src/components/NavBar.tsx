import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Link } from 'react-router-dom';

let _notifBeepCtx: AudioContext | null = null
function notifBeep(freq: number, pattern: number[]) {
  if (localStorage.getItem('yp_sound_enabled') === 'false') return
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    if (!_notifBeepCtx) _notifBeepCtx = new Ctx()
    _notifBeepCtx!.resume()
    const ac = _notifBeepCtx
    pattern.forEach((dur, i) => {
      const o = ac!.createOscillator()
      const g = ac!.createGain()
      o.connect(g); g.connect(ac!.destination)
      o.type = 'sine'; o.frequency.value = freq
      const t = ac!.currentTime + pattern.slice(0, i).reduce((a, b) => a + b, 0)
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur - 0.01)
      o.start(t); o.stop(t + dur)
    })
  } catch (e) { /* ignore */ }
}

export default function NavBar() {
  const { user, loading, introEnabled } = useAuth()
  const host = window.location.hostname
  const siteName = host === 'localhost' || host === '127.0.0.1' ? '함께사는로컬'
    : host === 'test.unocum.kr' ? '함께사는테스트' : '함께사는양평'

  const [notif, setNotif] = useState({ memos: 0, notices: 0, friend_requests: 0, ai_broadcasts: 0 })
  const prevRef = useRef({ memos: 0, notices: 0, friend_requests: 0, ai_broadcasts: 0 })
  const [toasts, setToasts] = useState<{ id: number; type: string; msg: string }[]>([])
  const toastIdRef = useRef(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!user?.id) return
    const poll = () => {
      fetch('/api/user/notification-summary', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          const prev = prevRef.current
          if (d.notices > prev.notices) {
            const n = d.notices - prev.notices
            notifBeep(660, [0.3])
            showToast('📢', `${n}개의 새 공지사항`)
          }
          if (d.memos > prev.memos) {
            const n = d.memos - prev.memos
            notifBeep(880, [0.15, 0.1, 0.15])
            showToast('📝', `${n}개의 새 메모`)
          }
          if (d.friend_requests > prev.friend_requests) {
            const n = d.friend_requests - prev.friend_requests
            notifBeep(1047, [0.1, 0.08, 0.1, 0.08, 0.1])
            showToast('👥', `${n}개의 새 벗 신청`)
          }
          if (d.ai_broadcasts > prev.ai_broadcasts) {
            const n = d.ai_broadcasts - prev.ai_broadcasts
            notifBeep(523, [0.2, 0.15, 0.2, 0.15, 0.2])
            showToast('🤖', `${n}개의 새 AI 이야기`)
          }
          prevRef.current = d
          setNotif(d)
        })
        .catch(() => {})
    }
    poll()
    const iv = setInterval(poll, 15000)
    return () => clearInterval(iv)
  }, [user?.id])

  function showToast(icon: string, msg: string) {
    const id = ++toastIdRef.current
    setToasts(prev => [...prev, { id, type: icon, msg }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  function doSearch(e: React.FormEvent) {
    e.preventDefault()
    const inp = searchRef.current
    if (inp?.value) window.location.href = '/search?q=' + encodeURIComponent(inp.value)
  }

  const [myVillage, setMyVillage] = useState<{exists:boolean;title?:string;myeon?:string;ri?:string}>({exists:false})
  const [managedPageExists, setManagedPageExists] = useState(false)
  const hasVillage = user?.managed_pages?.some(p => p.startsWith('vi_') || p === 'village') || user?.role === 'leader'
  const villageParts = (() => {
    for (const p of (user?.managed_pages || [])) {
      if (p.startsWith('vi_')) {
        const parts = p.slice(3).split('_')
        return { myeon: parts[0] || '', ri: parts[1] || '', tooltip: parts[1] + ' 마을' }
      }
    }
    return { myeon: '', ri: '', tooltip: '마을' }
  })()
  useEffect(() => {
    if (!user?.id) return
    fetch('/api/village/my-page', { credentials: 'include' }).then(r => r.json()).then(d => setMyVillage(d)).catch(() => {})
    if (villageParts.myeon && villageParts.ri) {
      fetch(`/api/village/page?myeon=${villageParts.myeon}&ri=${villageParts.ri}`, { credentials: 'include' })
        .then(r => r.json()).then(d => setManagedPageExists(!!d.id)).catch(() => {})
    }
  }, [user?.id])

  const totalMemos = notif.memos
  const totalNotices = notif.notices
  const totalFriendReqs = notif.friend_requests
  const totalAiBroadcasts = notif.ai_broadcasts

  return (
    <nav className="navbar navbar-expand-lg sticky-top mb-1">
      <div className="container">
        {/* Left: logo + quick menu */}
        <div className="d-flex align-items-center flex-shrink-0">
          <Link className="navbar-brand d-flex align-items-center me-1" to={!loading && user?.id && introEnabled ? `/user/${user.id}` : '/intro'}>          
            <img src="/static/images/logo.png" alt="Yangpyeong community logo - navigate to home" height="36" title={siteName} />
            <span className="fw-bold text-success d-none d-lg-inline ms-2" style={{ fontSize: '1.2rem' }}>{siteName}</span>
          </Link>
          <div className="d-inline-flex align-items-center position-relative" id="navQuick">
            <button className="btn btn-sm btn-outline-warning px-2 py-0" style={{ fontSize: '0.9rem' }}
              onClick={() => document.getElementById('quickMenu')?.classList.toggle('d-none')}>⭐</button>
            <a href="/share-report" className="btn btn-sm btn-outline-success px-2 py-0 ms-1" style={{ fontSize: '0.9rem' }}>📸</a>
            {user?.id && hasVillage && (
              <div className="d-inline-flex align-items-center ms-1 position-relative">
                <a href="/village" className="text-decoration-none" title="마을" style={{ fontSize: '1.2rem' }}
                  onClick={e => { e.preventDefault(); document.getElementById('villageMenu')?.classList.toggle('d-none') }}>🏘️</a>
                <div className="position-absolute bg-white border rounded shadow-sm p-2 d-none" id="villageMenu"
                  style={{ zIndex: 1050, minWidth: 140, top: '100%', left: 0 }}>
                  <a className="d-block small py-1 px-2 text-dark text-decoration-none rounded" href="/village">📝 봉사</a>
                  {managedPageExists && villageParts.ri && (
                    <a className="d-block small py-1 px-2 text-dark text-decoration-none rounded"
                      href={`/village/view/${villageParts.myeon}/${villageParts.ri}`}>📖 마을 홍보</a>
                  )}
                </div>
              </div>
            )}
            <div className="position-absolute bg-white border rounded shadow-sm p-2 d-none" id="quickMenu"
              style={{ zIndex: 1050, minWidth: 140, top: '100%', left: 0 }} onClick={e => e.stopPropagation()}>
              <a className="d-block small py-1 px-2 text-dark text-decoration-none rounded" href="/main">💭 꿈꾸기</a>
              <a className="d-block small py-1 px-2 text-dark text-decoration-none rounded" href="/construction">📍 위치기반안내</a>
              <a className="d-block small py-1 px-2 text-dark text-decoration-none rounded" href="#"
                onClick={e => { e.preventDefault(); window.open('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50') }}>🤖 통벗채팅</a>
            </div>
          </div>
        </div>

        {/* Center: search */}
        <div className="d-flex align-items-center mx-1">
          <form className="d-flex align-items-center" onSubmit={doSearch} role="search">
            {searchOpen ? (
              <>
                <input ref={searchRef} className="form-control form-control-sm" type="search" name="q" placeholder="검색"
                  autoFocus style={{ width: 130, borderRadius: 20 }}
                  onBlur={e => { if (!e.currentTarget.value) setSearchOpen(false) }} />
                <button type="submit" className="btn btn-sm btn-outline-secondary ms-1 py-0 px-1">🔍</button>
              </>
            ) : (
              <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: '1rem' }}
                onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}>🔍</button>
            )}
          </form>
        </div>

        {/* Navigation menus */}
        <div className="collapse navbar-collapse" id="navbarNav" style={{ background: 'white', zIndex: 1020 }}>
          <ul className="navbar-nav mx-auto align-items-center">
            <li className="nav-item dropdown mx-1">
              <a className="nav-link dropdown-toggle px-2" href="#" data-bs-toggle="dropdown">소개</a>
              <ul className="dropdown-menu border-0 shadow">
                <li style={{ fontSize: '0.7rem', fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 16px 2px' }}>소개</li>
                <li><a className="dropdown-item" href="/proposal">사업소개</a></li>
                <li><a className="dropdown-item" href="/presentation">운영계획</a></li>
                <li><hr className="dropdown-divider" /></li>
                <li><a className="dropdown-item" href="/terms">회원약관</a></li>
                <li><a className="dropdown-item" href="/charter">정관</a></li>
              </ul>
            </li>
            <li className="nav-item dropdown">
              <a className="nav-link dropdown-toggle px-2" href="#" data-bs-toggle="dropdown">소식</a>
              <ul className="dropdown-menu">
                <li style={{ fontSize: '0.7rem', fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 16px 2px' }}>소식</li>
                <li><a className="dropdown-item" href="/kr-yp-news">대한민국과양평</a></li>
                <li><a className="dropdown-item" href="/world-news">세계와양평</a></li>
                <li><a className="dropdown-item" href="/share">공유마당</a></li>
                <li><a className="dropdown-item" href="/construction">📍 위치기반안내</a></li>
              </ul>
            </li>
            <li className="nav-item dropdown mx-1">
              <a className="nav-link dropdown-toggle px-2" href="#" data-bs-toggle="dropdown">하는일</a>
              <ul className="dropdown-menu border-0 shadow">
                <li style={{ fontSize: '0.7rem', fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 16px 2px' }}>하는일</li>
                <li><a className="dropdown-item" href="/service/ramp">휠체어경사로보급사업</a></li>
                <li><a className="dropdown-item" href="/service/legal">노무사 이훈의 법률상담</a></li>
                <li><a className="dropdown-item" href="/service/psycho">숨상담심리연구소</a></li>
              </ul>
            </li>
            <li className="nav-item dropdown mx-1">
              <a className="nav-link dropdown-toggle px-2" href="#" data-bs-toggle="dropdown">제안</a>
              <ul className="dropdown-menu border-0 shadow">
                <li style={{ fontSize: '0.7rem', fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 16px 2px' }}>제안</li>
                <li><a className="dropdown-item" href="/main">꿈꾸기</a></li>
                <li><a className="dropdown-item" href="/all-proposals">누구의꿈</a></li>
              </ul>
            </li>
            {user?.role === 'leader' && (
              <li className="nav-item dropdown mx-1">
                <a className="nav-link dropdown-toggle px-2" href="#" data-bs-toggle="dropdown">관리</a>
                <ul className="dropdown-menu border-0 shadow">
                  <li style={{ fontSize: '0.7rem', fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', letterSpacing: 1, padding: '6px 16px 2px' }}>관리</li>
                  <li><a className="dropdown-item" href="/admin">누구의꿈(관리)</a></li>
                  <li><a className="dropdown-item" href="/admin/users">회원관리</a></li>
                  <li><a className="dropdown-item" href="/admin/news">소식(관리)</a></li>
                  <li><a className="dropdown-item" href="/admin/share-reports">공유(관리)</a></li>
                  <li><a className="dropdown-item" href="/admin/stores">🏪 동네가게(관리)</a></li>
                  <li><a className="dropdown-item" href="/admin/alerts">🚨 알림(관리)</a></li>
                  <li><div className="dropdown-divider"></div></li>
                  <li><a className="dropdown-item" href="/admin/ai-chat">🤖 관리자 AI</a></li>
                  <li><a className="dropdown-item" href="/admin/ai-feedback">📋 AI 피드백</a></li>
                  <li><a className="dropdown-item" href="/admin/ai-train">📚 양평AI 가르치기</a></li>
                  <li><div className="dropdown-divider"></div></li>
                  {host !== 'unocum.kr' && (
                    <li><a className="dropdown-item" href="/admin/page-managers">🔑 페이지관리자</a></li>
                  )}
                  <li><a className="dropdown-item" href="/admin/message">쪽지 발송</a></li>
                </ul>
              </li>
            )}
          </ul>
        </div>

        {/* Right: AI + Notification hub + Profile */}
        <div className="d-flex align-items-center flex-shrink-0">
          <a href="/ai/chat" className="btn btn-sm btn-outline-success px-2 py-0 position-relative"
            style={{ fontSize: '1.1rem', borderRadius: '50%', width: 34, height: 34, lineHeight: '1' }} title="양평AI">
            🤖
            {totalAiBroadcasts > 0 && (
              <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill"
                style={{ fontSize: '0.5rem', background: '#20c997', minWidth: 14, padding: '1px 4px', lineHeight: '1.2' }}>
                {totalAiBroadcasts}
              </span>
            )}
          </a>
          {!loading && user?.id ? (
            <div className="d-flex align-items-center ms-1 gap-1">
              {/* Friend requests */}
              <a href="/friends" className="text-decoration-none position-relative" title="벗 신청">
                <span style={{ fontSize: '1.1rem' }}>👥</span>
                {totalFriendReqs > 0 && (
                  <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill"
                    style={{ fontSize: '0.5rem', background: '#dc3545', minWidth: 14, padding: '1px 4px', lineHeight: '1.2' }}>
                    {totalFriendReqs}
                  </span>
                )}
              </a>
              {/* 메모 */}
              <a href="/memo" className="text-decoration-none position-relative ms-1" title="메모">
                <span style={{ fontSize: '1.1rem' }}>📝</span>
                {totalMemos > 0 && (
                  <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill"
                    style={{ fontSize: '0.5rem', background: '#ffc107', color: '#000', minWidth: 14, padding: '1px 4px', lineHeight: '1.2' }}>
                    {totalMemos}
                  </span>
                )}
              </a>
              {/* 편지 */}
              <a href="/message/inbox" className="text-decoration-none position-relative ms-1" title="편지">
                <span style={{ fontSize: '1.1rem' }}>✉️</span>
                {totalNotices > 0 && (
                  <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill"
                    style={{ fontSize: '0.5rem', background: '#0d6efd', minWidth: 14, padding: '1px 4px', lineHeight: '1.2' }}>
                    {totalNotices}
                  </span>
                )}
              </a>
              {/* 일반회원: 공개된 마을 홍보페이지 링크 */}
              {!hasVillage && myVillage.exists && (
                <a href={`/village/view/${myVillage.myeon}/${myVillage.ri}`} className="text-decoration-none ms-1" title={myVillage.title}>
                  <span style={{ fontSize: '1.1rem' }}>📖</span>
                </a>
              )}
              <a href={`/user/${user.id}`} className="text-decoration-none ms-1" title="회원정보">👤</a>
            </div>
          ) : (
            <a href="/login" className="text-decoration-none text-muted ms-2" title="회원정보">👤</a>
          )}
          <button className="navbar-toggler ms-2" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav"
            style={{ border: 'none', padding: 0 }}>
            <span className="navbar-toggler-icon"></span>
          </button>
        </div>

        {/* Toast notifications */}
        {toasts.length > 0 && (
          <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 9999 }}>
            {toasts.map(t => (
              <div key={t.id} className="shadow rounded px-3 py-2 mb-2"
                style={{ background: '#333', color: '#fff', fontSize: '0.85rem', minWidth: 200, transition: 'opacity 0.3s' }}>
                {t.type} {t.msg}
              </div>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
