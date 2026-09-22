import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const tabs = [
  { path: '/service/legal', label: '소개', icon: '🏛️' },
  { path: '/legal', label: '법률상담 게시판', icon: '📋' },
  { path: '/legal/issues', label: '노동이슈', icon: '📰' },
  { path: '/legal/schedule', label: '방문상담 예약', icon: '📅' },
]

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'leader'
  const [mobileOpen, setMobileOpen] = useState(false)

  const currentPath = location.pathname

  const isActive = (path: string) =>
    currentPath === path || (path !== '/service/legal' && currentPath.startsWith(path))

  const handleNav = (path: string) => {
    navigate(path)
    setMobileOpen(false)
  }

  const currentTab = tabs.find(t => isActive(t.path))

  /* ── 공통 메뉴 버튼 목록 ── */
  const menuButtons = (onNavigate: (p: string) => void) => (
    <>
      {tabs.map(tab => (
        <button key={tab.path}
          className={`btn w-100 text-start mb-1 d-flex align-items-center gap-2 ${isActive(tab.path) ? 'btn-success text-white' : 'btn-light text-dark'}`}
          style={{ fontSize: '0.88em', borderRadius: 10, padding: '10px 14px' }}
          onClick={() => onNavigate(tab.path)}>
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      ))}
      {isAdmin && (
        <button className="btn w-100 text-start mb-1 d-flex align-items-center gap-2 btn-outline-secondary"
          style={{ fontSize: '0.85em', borderRadius: 10, padding: '10px 14px' }}
          onClick={() => onNavigate('/service/legal/edit')}>
          <span>⚙️</span>
          <span>관리</span>
        </button>
      )}
    </>
  )

  return (
    <>
      {/* ══════ 데스크톱: 왼쪽 고정 사이드바 ══════ */}
      <div className="d-none d-md-flex gap-3" style={{ minHeight: '70vh' }}>
        <div className="flex-shrink-0" style={{ width: 210 }}>
          <div className="card border-0 shadow-sm" style={{ borderRadius: 14, position: 'sticky', top: 80 }}>
            <div className="card-body p-2">
              <div className="text-center py-2 mb-2" style={{ borderBottom: '1px solid #e9ecef' }}>
                <div style={{ fontSize: '1.3em' }}>🏛️</div>
                <div className="fw-bold" style={{ color: '#198754', fontSize: '0.9em', lineHeight: 1.3 }}>
                  이훈노무사<br />노동법률상담소
                </div>
              </div>
              {menuButtons(navigate)}
            </div>
          </div>
        </div>
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          {children}
        </div>
      </div>

      {/* ══════ 모바일: 본문 ══════ */}
      <div className="d-block d-md-none" style={{ paddingBottom: 60 }}>
        {children}
      </div>

      {/* ══════ 모바일: 하단 고정 햄버거 바 ══════ */}
      <div className="d-md-none" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1050,
        background: '#fff', borderTop: '1px solid #dee2e6',
        boxShadow: '0 -2px 8px rgba(0,0,0,0.08)',
      }}>
        <button className="w-100 d-flex align-items-center justify-content-between px-3 py-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          style={{ background: 'none', border: 'none' }}>
          <div className="d-flex align-items-center gap-2">
            <span style={{ fontSize: '1.2em' }}>{mobileOpen ? '✕' : '☰'}</span>
            <span className="fw-bold" style={{ color: '#198754', fontSize: '0.88em' }}>
              이훈노무사 법률사무소
            </span>
          </div>
          <span className="text-muted small">
            {currentTab?.icon} {currentTab?.label}
          </span>
        </button>
      </div>

      {/* ══════ 모바일: 슬라이드업 메뉴 ══════ */}
      {mobileOpen && (
        <div className="d-md-none" style={{
          position: 'fixed', bottom: 52, left: 0, right: 0, zIndex: 1045,
          background: '#fff', borderTop: '1px solid #dee2e6',
          boxShadow: '0 -4px 16px rgba(0,0,0,0.12)',
          borderRadius: '16px 16px 0 0',
          maxHeight: '60vh', overflowY: 'auto',
          animation: 'slideUp 0.25s ease-out',
        }}>
          <div className="p-2">
            <div className="text-center mb-2" style={{ fontSize: '0.75em', color: '#6c757d' }}>
              ─── 메뉴 ───
            </div>
            {menuButtons(handleNav)}
          </div>
        </div>
      )}

      {/* 슬라이드업 애니메이션 CSS */}
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </>
  )
}
