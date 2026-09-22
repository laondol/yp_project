import { useState } from 'react'
import { useLocation } from 'react-router-dom'

const PAGE_TITLES: Record<string, string> = {
  '/schedule2': '📅 일정',
  '/schedule-popup': '📅 일정',
  '/bot/chat': '🤖 통벗',
  '/chat': '👥 벗채팅',
  '/compass': '🧭 나침반',
  '/yard/edit': '🏡 마당 편집',
}

export default function PopupBar() {
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const isPopup = new URLSearchParams(window.location.search).get('popup') === '1'

  if (!isPopup) return null

  const title = PAGE_TITLES[location.pathname] || '페이지'

  const handleNav = (url: string) => {
    setMenuOpen(false)
    // 메인 창이 있으면 메인 창에서 열기 + 팝업 닫기
    if (window.opener && !window.opener.closed) {
      window.opener.location.href = url
      window.close()
    } else {
      window.location.href = url
    }
  }

  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 1040 }}>
      <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom"
        style={{ background: '#f8f9fa', minHeight: 44 }}>
        {/* 왼쪽: 햄버거 메뉴 */}
        <button className="btn btn-sm p-1" onClick={() => setMenuOpen(!menuOpen)}
          style={{ border: 'none', minWidth: 32 }}>
          <span style={{ fontSize: '1.2em' }}>{menuOpen ? '✕' : '☰'}</span>
        </button>

        {/* 가운데: 제목 */}
        <span className="fw-bold small text-muted">{title}</span>

        {/* 오른쪽: 닫기 */}
        <button className="btn btn-sm btn-outline-danger" onClick={() => window.close()}
          style={{ fontSize: '0.8em', padding: '2px 10px' }}>
          닫기
        </button>
      </div>

      {/* 햄버거 드롭다운 메뉴 */}
      {menuOpen && (
        <div className="border-bottom shadow-sm" style={{ background: '#fff' }}>
          <div className="p-2">
            <button className="btn w-100 text-start btn-sm mb-1" style={{ borderRadius: 8 }}
              onClick={() => handleNav('/')}>
              🏠 홈으로
            </button>
            <button className="btn w-100 text-start btn-sm mb-1" style={{ borderRadius: 8 }}
              onClick={() => handleNav('/main')}>
              📋 메인
            </button>
            <button className="btn w-100 text-start btn-sm mb-1" style={{ borderRadius: 8 }}
              onClick={() => handleNav('/message/inbox')}>
              📬 편지함
            </button>
            <button className="btn w-100 text-start btn-sm mb-1" style={{ borderRadius: 8 }}
              onClick={() => handleNav('/user/edit-profile')}>
              👤 내 정보
            </button>
            <hr className="my-1" />
            <button className="btn w-100 text-start btn-sm text-danger" style={{ borderRadius: 8 }}
              onClick={() => {
                localStorage.removeItem('user')
                if (window.opener && !window.opener.closed) {
                  window.opener.location.href = '/login'
                  window.close()
                } else {
                  window.location.href = '/login'
                }
              }}>
              🚪 로그아웃
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
