import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'
import SortableBlocks from '../components/SortableBlocks'
import { useBlockOrder } from '../hooks/useBlockOrder'
import { openPopup } from '../lib/popup'
const CHANGE_LABELS: Record<string, string> = {
  signup: '가입', monthly: '월급', post: '제안', comment: '댓글', like: '추천',
  village_report: '제보', share_report: '공유', admin_adjust: '관리자 조정',
  village_appointment: '마을지기 임명', village_monthly: '마을지기 활동비', letter: '편지발송',
}

export default function IntroProfilePage() {
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNip, setShowNip] = useState(false)
  const [showMemos, setShowMemos] = useState(false)
  const [weather, setWeather] = useState<any>(null)
  const [showWeatherModal, setShowWeatherModal] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const { order, saveOrder } = useBlockOrder('intro')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch('/api/user/me/profile', { credentials: 'include' })
      if (r.status === 401) { navigate('/login'); return }
      if (!r.ok) throw new Error('불러오기 실패')
      const d = await r.json()
      setData(d)
      if (d.profile_user?.town) {
        fetch(`/api/daily-info?town=${encodeURIComponent(d.profile_user.town)}`).then(r => r.json()).then(d => {
          if (d.weather) setWeather(d.weather)
        }).catch(() => {})
      }
    } catch (e: any) { setError(e.message || '오류') }
    finally { setLoading(false) }
  }, [navigate])

  useEffect(() => { load() }, [load])

  const formatDate = (s?: string) => {
    if (!s) return ''
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />
  if (!data) return null

  const u = data.profile_user
  const hasAppointments = data.appointments?.length > 0
  const hasBotActivity = data.bot_memory || data.drafts?.length > 0

  return (
    <div className="container mt-4" style={{ maxWidth: 800 }}>
      {/* 인트로 메뉴바 - 점3개(⋯) 토글 */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate(-1)}>
          ← 뒤로
        </button>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={() => setMenuOpen(!menuOpen)}
          style={{ fontSize: '1.2rem', padding: '2px 10px', letterSpacing: 2 }}
          title="메뉴"
        >
          ⋯
        </button>
      </div>

      {/* 메뉴 바 (펼침) */}
      <div className={`mb-3 ${menuOpen ? 'intro-nav-visible' : 'intro-nav-hidden'}`}
        style={{ overflow: 'hidden', transition: 'max-height 0.3s ease' }}>
        <div className="card border-0 shadow-sm" style={{ borderRadius: 18 }}>
          <div className="card-body p-2 d-flex flex-wrap gap-1 justify-content-center">
            <a href="/main" className="btn btn-sm btn-outline-success">💭 꿈꾸기</a>
            <a href="/construction" className="btn btn-sm btn-outline-success">📍 위치기반안내</a>
            <a href="/share" className="btn btn-sm btn-outline-success">📸 공유마당</a>
            <a href={`/user/${u.id}`} className="btn btn-sm btn-outline-success">👤 내 정보</a>
            <a href="/memo" className="btn btn-sm btn-outline-success">📝 메모</a>
            <a href="/friends" className="btn btn-sm btn-outline-success">👥 벗</a>
          </div>
        </div>
      </div>

      <SortableBlocks order={order} onReorder={saveOrder} dragEnabled={true}>
        {{
          member_info: (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-body p-3">
                <div className="d-flex align-items-center gap-2 mb-2">
                  <div className="bg-success text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                    style={{ width: 48, height: 48, fontSize: '1.2rem' }}>
                    {data.profile_initial}
                  </div>
                  <div>
                    <div className="fw-bold small">{u.real_name || u.username}</div>
                    <small className="text-muted">@{u.username}</small>
                  </div>
                </div>
                <div className="d-flex gap-1 flex-wrap mb-2">
                  <span className="badge bg-light text-dark small">{u.town} {u.village}</span>
                  {u.is_neighbor && <span className="badge bg-success small">이웃</span>}
                  {u.role === 'leader' && <span className="badge bg-primary small">책</span>}
                  {data.p_is_village && <span className="badge bg-success small">마</span>}
                </div>
                <div className="d-flex gap-1 flex-wrap mt-2">
                  <button className="btn btn-sm btn-outline-warning"
onClick={() => openPopup('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')}>
                        🤖 {data.bot_name || '통벗'}
                  </button>
                  <button className="btn btn-sm btn-outline-info"
onClick={() => openPopup('/chat?popup=1', 'chatPopup', 'width=800,height=600,left=100,top=50')}>
                        👥 벗채팅
                  </button>
                  <button className="btn btn-sm btn-outline-secondary"
onClick={() => openPopup('/schedule2', 'schedPopup', 'width=700,height=700,left=100,top=50')}>
                        📅 일정
                  </button>
                </div>
              </div>
            </div>
          ),

          tongbot: (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-body p-3">
                {data.bot_mood && (
                  <div className="small text-muted mb-1 text-center">
                    {data.bot_mood === 'warm' ? '💕' : data.bot_mood === 'happy' ? '😊' : data.bot_mood === 'encourage' ? '💪' : '🤖'}
                    Lv.{data.bot_level || 1} ❤️{data.bot_intimacy || 0}
                  </div>
                )}
                {weather && (
                  <div className="mt-1">
                    <div className="d-flex align-items-center small">
                      <span style={{ cursor: 'pointer' }} onClick={() => setShowWeatherModal(true)}>
                        {weather.icon} <span className="fw-bold text-primary">{weather.sky} {weather.temperature}°C</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ),

          todo_memo: <TodoMemoStrip />,

          location: (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-body p-2">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <small className="text-muted">📍</small>
                  <span className="fw-bold small">{data.curr_location || `${u.town || ''} ${u.village || ''}`}</span>
                  <div className="ms-auto d-flex gap-1">
                    <div className="form-check form-switch mb-0 small">
                      <input className="form-check-input" type="checkbox" checked={u.location_share}
                        onChange={e => fetch('/user/location/share/toggle', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ value: e.target.checked ? 'friends' : 'off' })
                        })} />
                      <label className="form-check-label">위치</label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ),

          dashboard: null,

          appointments: hasAppointments ? (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>📅 법률상담 예약</div>
              <div className="card-body p-0">
                {data.appointments.map((a: any) => (
                  <div key={a.id} className="p-2 border-bottom small">
                    <div className="d-flex justify-content-between">
                      <strong>{a.title || '상담'}</strong>
                      <span className={`badge bg-${a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'secondary'}`}>
                        {a.status}
                      </span>
                    </div>
                    <div className="text-muted">{a.date} {a.time_slot} | {a.location}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null,

          bot_activity: hasBotActivity ? (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>🤖 통벗 활동</div>
              <div className="card-body p-0">
                {data.bot_memory && (
                  <div className="p-2 px-3 small text-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                    {data.bot_memory}
                  </div>
                )}
              </div>
            </div>
          ) : null,

          points: (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold d-flex justify-content-between"
                style={{ borderRadius: '18px 18px 0 0', cursor: 'pointer' }}
                onClick={() => setShowNip(!showNip)}>
                <span>💎 닢 내역</span>
                <span>{showNip ? '▲' : '▼'}</span>
              </div>
              {showNip && (
                <div className="card-body p-0">
                  <div className="table-responsive">
                    <table className="table table-hover mb-0 small">
                      <thead className="table-light">
                        <tr><th>일시</th><th>유형</th><th>변동</th><th>잔액</th></tr>
                      </thead>
                      <tbody>
                        {(data.point_history || []).length === 0 ? (
                          <tr><td colSpan={4} className="text-center text-muted py-4">내역 없음</td></tr>
                        ) : (
                          (data.point_history || []).slice(0, 10).map((h: any) => (
                            <tr key={h.id}>
                              <td className="text-muted">{formatDate(h.created_at)}</td>
                              <td>{CHANGE_LABELS[h.change_type] || h.change_type}</td>
                              <td className={`fw-bold ${h.amount > 0 ? 'text-success' : 'text-danger'}`}>
                                {h.amount > 0 ? '+' : ''}{h.amount.toLocaleString()}
                              </td>
                              <td>{h.balance_after.toLocaleString()}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ),

          friends_messages: (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>👥 벗 · 편지</div>
              <div className="card-body p-0">
                <div className="list-group list-group-flush" style={{ maxHeight: 200, overflowY: 'auto' }}>
                  {(data.messages || []).length === 0 ? (
                    <div className="list-group-item text-center text-muted py-4">편지가 없습니다.</div>
                  ) : (
                    (data.messages || []).slice(0, 10).map((m: any) => (
                      <div key={m.id} className="list-group-item small">
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">{formatDate(m.created_at)}</span>
                        </div>
                        <strong>{m.subject || '(제목 없음)'}</strong>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ),

          posts: (data.posts || []).length > 0 ? (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>📝 작성한 글</div>
              <div className="card-body p-0">
                {(data.posts || []).slice(0, 10).map((p: any, i: number) => (
                  <div key={i} className="list-group-item small">
                    <strong>{(p.title || '').slice(0, 50)}</strong>
                    <small className="text-muted float-end">{formatDate(p.date)}</small>
                  </div>
                ))}
              </div>
            </div>
          ) : null,

          photos: (data.share_images || []).length > 0 ? (
            <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
              <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>🖼️ 공유한 사진</div>
              <div className="card-body p-2">
                <div className="row g-2">
                  {(data.share_images || []).slice(0, 8).map((img: any, i: number) => (
                    <div key={i} className="col-4 col-md-3">
                      <img src={img.path} className="img-fluid rounded"
                        style={{ height: 100, objectFit: 'cover', width: '100%' }}
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                        alt={img.title || '사진'} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null,
        }}
      </SortableBlocks>

      {/* Memo Modal */}
      {showMemos && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1050 }}
          onClick={() => setShowMemos(false)}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 16, maxHeight: '80vh' }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="fw-bold">📝 메모</h5>
                <button className="btn-close" onClick={() => setShowMemos(false)} />
              </div>
              <div className="modal-body overflow-auto" style={{ maxHeight: 'calc(80vh - 80px)' }}>
                <div className="text-muted text-center py-4">메모는 내 정보 페이지에서 관리할 수 있습니다.</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Weather Modal */}
      {showWeatherModal && weather && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1050 }}
          onClick={() => setShowWeatherModal(false)}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 pb-0">
                <h6 className="fw-bold">🌤️ 날씨</h6>
                <button className="btn-close" onClick={() => setShowWeatherModal(false)} />
              </div>
              <div className="modal-body p-3">
                <div className="text-center mb-3">
                  <div style={{ fontSize: '2rem' }}>{weather.icon}</div>
                  <div className="fw-bold text-primary fs-5">{weather.sky} {weather.temperature}°C</div>
                  <div className="text-muted">체감 {weather.feels_like}°C</div>
                </div>
                <div className="d-flex gap-3 text-muted small justify-content-center flex-wrap">
                  <span>💧 습도 {weather.humidity}%</span>
                  <span>🌧️ 강수 {weather.precipitation_prob}%</span>
                  <span>💨 바람 {weather.wind_speed}m/s</span>
                </div>
                {weather.tip && (
                  <div className="mt-2 text-center fw-bold" style={{ color: '#1976d2' }}>💡 {weather.tip}</div>
                )}
                {weather.sunrise && weather.sunset && (
                  <div className="mt-2 text-center text-muted small">🌅 일출 {weather.sunrise} · 🌇 일몰 {weather.sunset}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TodoMemoStrip() {
  const [memos, setMemos] = useState<{ id: number; content: string; done: boolean; end_date: string; updated_at?: string }[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch('/api/bot/memos', { credentials: 'include' })
      .then(r => r.json()).then(d => {
        const list = Array.isArray(d.memos) ? d.memos.filter((m: any) => !m.done) : []
        list.sort((a: any, b: any) => {
          const ae = a.end_date ? new Date(a.end_date).getTime() : Infinity
          const be = b.end_date ? new Date(b.end_date).getTime() : Infinity
          return ae - be
        })
        setMemos(list)
      }).catch(() => {})
  }, [])

  if (memos.length === 0) return null
  const fmt = (s: string) => {
    if (!s) return ''
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  const first = memos[0]

  return (
    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18, background: '#fffdf5', borderLeft: '3px solid #f0ad4e' }}>
      <div className="card-body p-2">
        <div className="d-flex align-items-center gap-2">
          <span title="할일메모">📌</span>
          <div className="flex-grow-1 small" style={{ minWidth: 0 }}>
            <span className="d-block text-truncate" title={first.content}>{first.content}</span>
            {first.end_date && <small className="text-muted">⏰ {fmt(first.end_date)}</small>}
          </div>
          {memos.length > 1 && (
            <button className="btn btn-sm btn-outline-secondary py-0 px-1"
              onClick={() => setExpanded(!expanded)}>
              {expanded ? '▲' : `▼ ${memos.length}`}
            </button>
          )}
        </div>
        {expanded && (
          <div className="mt-2 pt-1" style={{ borderTop: '1px dashed #f0ad4e' }}>
            {memos.map(m => (
              <div key={m.id} className="d-flex align-items-center gap-2 py-1 small">
                <span className="flex-grow-1 text-truncate" title={m.content}>{m.content}</span>
                {m.end_date && <small className="text-muted flex-shrink-0">⏰ {fmt(m.end_date)}</small>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
