import { useLocation } from 'react-router-dom'

const PAGE_TITLES: Record<string, string> = {
  '/schedule2': '📅 일정',
  '/bot/chat': '🤖 통벗',
  '/chat': '👥 벗채팅',
  '/compass': '🧭 나침반',
}

export default function PopupBar() {
  const location = useLocation()
  const isPopup = new URLSearchParams(window.location.search).get('popup') === '1'

  if (!isPopup) return null

  const title = PAGE_TITLES[location.pathname] || '페이지'

  return (
    <div className="d-flex align-items-center justify-content-between px-3 py-2 border-bottom"
      style={{ background: '#f8f9fa', minHeight: 44, position: 'sticky', top: 0, zIndex: 1040 }}>
      <button className="btn btn-sm btn-outline-secondary" onClick={() => window.history.back()}>
        ← 뒤로
      </button>
      <span className="fw-bold small text-muted">{title}</span>
      <button className="btn btn-sm btn-outline-danger" onClick={() => window.close()}>
        닫기
      </button>
    </div>
  )
}
