import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Loading from '../components/common/Loading'
import ErrorMessage from '../components/common/ErrorMessage'

interface ProfileUser {
  id: number; username: string; real_name?: string; town?: string; village?: string;
  social_provider?: string; points: number; role?: string; managed_pages?: string;
  is_neighbor?: boolean; location_share?: boolean; village_notify?: boolean;
  curr_address?: string;
}

interface PointHistory {
  id: number; change_type: string; amount: number; balance_after: number;
  description?: string; created_at?: string;
}

interface Message {
  id: number; subject?: string; content?: string; sender_role?: string;
  is_read: boolean; created_at?: string;
}

interface PostItem {
  title: string; date?: string; type: string; url: string;
}

interface Appointment {
  id: number; title?: string; date?: string; time_slot?: string;
  location?: string; status?: string; edit_url?: string;
}

interface Draft {
  id: number; title?: string; category?: string; status?: string;
  updated_at?: string;
}

interface ShareImage {
  path: string; title?: string; url: string;
}

interface Friend {
  id: number; username: string; name: string; town: string; village: string;
}

const CATS: Record<string, string> = {
  share: '공유마당', dream: '꿈꾸기', news: '소식', legal: '법률상담',
  psycho: '심리상담', village_wish: '마을바람',
}
const TYPE_LABELS: Record<string, string> = {
  꿈꾸기: '💭 꿈꾸기', 공유: '📸 공유', 바람: '💨 마을바람', 법률: '⚖️ 법률',
}
const CHANGE_LABELS: Record<string, string> = {
  signup: '가입', monthly: '월급', post: '제안', comment: '댓글', like: '추천',
  village_report: '제보', share_report: '공유', admin_adjust: '관리자 조정',
  village_appointment: '마을지기 임명', village_monthly: '마을지기 활동비', letter: '편지발송',
}

export default function UserProfilePage() {
  const { userId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<{
    profile_user: ProfileUser; is_own: boolean; is_admin: boolean; is_friend: boolean;
    p_is_village: boolean; point_history: PointHistory[]; messages: Message[];
    posts: PostItem[]; appointments: Appointment[]; drafts: Draft[];
    bot_id?: string; bot_name?: string; bot_mood?: string; bot_level?: number;
    bot_intimacy?: number; bot_tone?: string; bot_chat_count?: number;
    bot_memory?: string; curr_location?: string; share_images: ShareImage[];
    recent_friends: Friend[]; profile_initial: string;
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showNip, setShowNip] = useState(false)
  const [showAddressEdit, setShowAddressEdit] = useState(false)
  const [showBotSettings, setShowBotSettings] = useState(false)
  const [showMemos, setShowMemos] = useState(false)
  const [weather, setWeather] = useState<any>(null)
  const [allWeather, setAllWeather] = useState<Record<string, any>>({})
  const [showWeatherModal, setShowWeatherModal] = useState(false)
  const [showWeatherDetail, setShowWeatherDetail] = useState(false)
  const [expandedTown, setExpandedTown] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await fetch(`/api/user/${userId}/profile`)
      if (r.status === 401) { navigate('/login'); return }
      if (!r.ok) throw new Error('불러오기 실패')
      const d = await r.json()
      setData(d)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '불러오기 실패')
    } finally { setLoading(false) }
  }, [userId, navigate])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(me => {
      const town = me.town || me.curr_town || '양평읍'
      fetch(`/api/daily-info?town=${encodeURIComponent(town)}`).then(r => r.json()).then(d => {
        if (d.weather) setWeather(d.weather)
      }).catch(() => {})
    }).catch(() => {})
  }, [])

  const formatDate = (s?: string) => {
    if (!s) return ''
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const formatDateShort = (s?: string) => {
    if (!s) return ''
    const d = new Date(s)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  if (loading) return <Loading />
  if (error) return <ErrorMessage message={error} onRetry={load} />
  if (!data) return null

  const u = data.profile_user
  const hasAppointments = data.is_own && data.appointments.length > 0
  const hasBotActivity = data.is_own && (data.bot_memory || data.drafts.length > 0)

  return (
    <div className="container mt-4" style={{ maxWidth: 800 }}>
      {/* Profile Header */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
        <div className="card-body p-3">
          <div className="row">
            {/* Left: User info */}
            <div className="col-6 pe-3" style={{ borderRight: '2px solid #dee2e6' }}>
              <div className="d-flex align-items-center gap-2 mb-2">
                <div className="bg-success text-white rounded-circle d-flex align-items-center justify-content-center flex-shrink-0"
                  style={{ width: 48, height: 48, fontSize: '1.2rem' }}>
                  {data.profile_initial}
                </div>
                <div>
                  <div className="fw-bold small">{u.real_name || u.username}</div>
                  <small className="text-muted">@{u.username} <span className="text-muted">({{
                    google: '구글', naver: '네이버', kakao: '카카오톡',
                  }[u.social_provider || ''] || '함사양'})</span></small>
                </div>
              </div>
              <div className="d-flex gap-1 flex-wrap mb-2">
                <span className="badge bg-light text-dark small">{u.town} {u.village}</span>
                {u.is_neighbor && <span className="badge bg-success small">이웃</span>}
                {u.role === 'leader' && <span className="badge bg-primary small">책</span>}
                {(u.role === 'admin' || u.managed_pages) && <span className="badge bg-danger small">관</span>}
                {data.p_is_village && <span className="badge bg-success small">마</span>}
              </div>
              <button className="text-decoration-none border-0 bg-transparent p-0"
                onClick={() => setShowNip(!showNip)}>
                <span className="fw-bold text-success fs-5">
                  {u.points?.toLocaleString()}
                </span>
                <small className="text-muted"> 닢</small>
              </button>
              {data.is_own && (
                <div className="mt-1"><small className="text-muted">📍 {data.curr_location || '위치 없음'}</small></div>
              )}
              {data.is_own ? (
                <div className="mt-2 d-flex gap-1 flex-wrap">
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/user/edit-profile')}>✏️ 수정</button>
                  <a href="/logout" className="btn btn-sm btn-outline-danger"
                    onClick={e => { if (!confirm('로그아웃 하시겠습니까?')) e.preventDefault() }}>🚪 로그아웃</a>
                </div>
              ) : (
                <div className="mt-2">
                  {data.is_friend ? (
                    <span className="badge bg-success">👥 벗</span>
                  ) : null}
                </div>
              )}
            </div>
            {/* Right: TongBot */}
            <div className="col-6 ps-3">
              {data.is_own ? (
                <>
                  <div className="d-flex align-items-center gap-1 justify-content-center mb-1">
                    <button className="btn btn-warning btn-sm"
                      onClick={() => window.open('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')}>
                      🤖 {data.bot_name || data.bot_id || '통벗'}
                    </button>
                    <button className="btn btn-sm btn-outline-secondary"
                      onClick={() => setShowBotSettings(true)} title="통벗 설정">✏️</button>
                    <button className="btn btn-sm btn-outline-warning"
                      onClick={() => setShowMemos(true)} title="메모">📝</button>
                  </div>
                  {data.bot_mood && (
                    <div className="small text-muted mb-1 text-center">
                      {data.bot_mood === 'warm' ? '💕' : data.bot_mood === 'happy' ? '😊' : data.bot_mood === 'proud' ? '🥲' : data.bot_mood === 'encourage' ? '💪' : data.bot_mood === 'worried' ? '😌' : data.bot_mood === 'blessing' ? '🙏' : '🤖'}
                      Lv.{data.bot_level || 1} ❤️{data.bot_intimacy || 0}
                    </div>
                  )}
                  <div className="d-flex flex-wrap gap-1 justify-content-center mb-2">
                    <a href="/epub" className="btn btn-sm btn-outline-success">✍️ 콘텐츠</a>
                    <button className="btn btn-sm btn-outline-success"
                      onClick={() => window.open('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')}>
                      ✍️ 글쓰기
                    </button>
                    <button className="btn btn-sm btn-outline-info"
                      onClick={() => window.open('/chat?popup=1', 'chatPopup', 'width=800,height=600,left=100,top=50')}>
                      👥 벗채팅
                    </button>
                    <button className="btn btn-sm btn-outline-secondary"
                      onClick={() => window.open('/schedule2', 'schedPopup', 'width=700,height=700,left=100,top=50')}>
                      📅 일정
                    </button>
                  </div>
                  {/* 통벗 채팅 한줄 */}
                  {data.bot_memory && (
                    <div className="small text-muted p-1 mb-1 rounded" style={{ background: '#f0fdf4', borderLeft: '3px solid #198754', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => window.open('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')}>
                      🤖 {data.bot_memory.split('\n').filter((l:string)=>l.trim()).slice(-1)[0]?.replace(/^(회원|통벗):\s*/, '') || ''}
                    </div>
                  )}
                  {/* 날씨 한줄 + 펼치기 */}
                  {weather && (
                    <div className="mt-1">
                      <div className="d-flex align-items-center small">
                        <span style={{ cursor: 'pointer' }} onClick={() => {
                          if (Object.keys(allWeather).length === 0) {
                            fetch('/api/weather/all').then(r => r.json()).then(d => setAllWeather(d)).catch(() => {})
                          }
                          setShowWeatherModal(true)
                        }}>{weather.icon} <span className="fw-bold text-primary">{weather.sky} {weather.temperature}°C</span> <span className="text-muted">체감 {weather.feels_like}°C</span></span>
                        <span className="text-muted ms-auto" style={{ cursor: 'pointer' }}
                          onClick={() => {
                            if (!showWeatherDetail && Object.keys(allWeather).length === 0) {
                              fetch('/api/weather/all').then(r => r.json()).then(d => setAllWeather(d)).catch(() => {})
                            }
                            setShowWeatherDetail(!showWeatherDetail)
                          }}>{showWeatherDetail ? '▲' : '▼'}</span>
                      </div>
                      {showWeatherDetail && (
                        <div className="mt-1 p-2 rounded small" style={{ background: 'linear-gradient(135deg, #e8f4fd 0%, #f0f9ff 100%)', border: '1px solid #bee5eb' }}>
                          <div className="d-flex gap-2 text-muted mb-1" style={{ flexWrap: 'wrap' }}>
                            <span>💧 습도 {weather.humidity}%</span>
                            <span>🌧️ 강수 {weather.precipitation_prob}%</span>
                            <span>💨 바람 {weather.wind_speed}m/s</span>
                            {weather.uv_text && <span>☀️ 자외선 {weather.uv_text}</span>}
                          </div>
                          {(weather.air_text || weather.o3_text) && (
                            <div className="d-flex gap-2 text-muted mb-1" style={{ flexWrap: 'wrap' }}>
                              {weather.air_text && <span>🌫️ 공기 {weather.air_text} (PM2.5 {weather.pm25}µg/m³)</span>}
                              {weather.o3_text && <span>🫧 오존 {weather.o3_text}</span>}
                            </div>
                          )}
                          {weather.rain_info && <div className="text-info mb-1">🌧️ {weather.rain_info}</div>}
                          {weather.sunrise && weather.sunset && <div className="text-muted mb-1">🌅 일출 {weather.sunrise} · 🌇 일몰 {weather.sunset}</div>}
                          {weather.tip && <div className="fw-bold" style={{ color: '#1976d2' }}>💡 {weather.tip}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-muted py-4"><small>통벗 정보 없음</small></div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 할일메모 - 위치기반안내 위 */}
      {data.is_own && <TodoMemoStrip />}

      {/* Location - 맨 위 */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
        <div className="card-body p-2">
          <div className="d-flex align-items-center gap-2 flex-wrap">
            <small className="text-muted">📍</small>
            <span className="fw-bold small">{data.curr_location || `${u.town || ''} ${u.village || ''}`}</span>
            {data.is_own && (
              <>
                <button className="btn btn-sm btn-outline-secondary py-0 px-1"
                  onClick={() => setShowAddressEdit(!showAddressEdit)}>✏️</button>
                <a href="/construction?tab=home" className="btn btn-sm btn-outline-secondary py-0 px-1">🏠</a>
                <a href="/construction?tab=scenery&sub=facility" className="btn btn-sm btn-outline-secondary py-0 px-1">🚻</a>
                <div className="ms-auto d-flex gap-1">
                  <div className="form-check form-switch mb-0 small">
                    <input className="form-check-input" type="checkbox" checked={u.location_share}
                      onChange={e => fetch('/user/location/share/toggle', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: e.target.checked ? 'friends' : 'off' })
                      })} />
                    <label className="form-check-label">위치</label>
                  </div>
                  <div className="form-check form-switch mb-0 small">
                    <input className="form-check-input" type="checkbox" checked={u.village_notify}
                      onChange={e => fetch('/user/village/notify/toggle', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ value: e.target.checked })
                      })} />
                    <label className="form-check-label">소식</label>
                  </div>
                </div>
              </>
            )}
          </div>
          {data.is_own && showAddressEdit && (
            <div className="mt-2 p-2 bg-light rounded">
              <form method="POST" action="/user/location/correct?back=profile" className="row g-1 align-items-center">
                <div className="col-12 mb-1"><small className="text-muted">📍 위치 보정 참여시 <strong>1닢</strong> 지급</small></div>
                <div className="col-8">
                  <input type="text" name="manual_loc" className="form-control form-control-sm" placeholder="정확한 주소 입력 (예: 양수리 935)" required />
                </div>
                <div className="col-4">
                  <button className="btn btn-sm btn-outline-secondary w-100" type="submit">📍 보정</button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Dashboard */}
      {data.is_own && <DashboardPanel />}

      {/* Appointments */}
      {hasAppointments && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
          <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>📅 법률상담 예약</div>
          <div className="card-body p-0">
            {data.appointments.map(a => (
              <div key={a.id} className="p-2 border-bottom small">
                <div className="d-flex justify-content-between">
                  <a href="/legal/schedule" className="text-decoration-none"><strong>{a.title || '상담'}</strong></a>
                  <span className={`badge bg-${a.status === 'approved' ? 'success' : a.status === 'pending' ? 'warning' : 'secondary'}`}>
                    {a.status}
                  </span>
                </div>
                <div className="text-muted">{a.date} {a.time_slot} | {a.location}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TongBot Activity */}
      {hasBotActivity && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
          <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>🤖 통벗 활동 (30일 보관)</div>
          <div className="card-body p-0">
            {data.drafts.length > 0 && (
              <>
                <div className="px-3 pt-2 small fw-bold text-success">✍️ 글쓰기 초안</div>
                {Object.entries(CATS).map(([key, label]) => {
                  const catDrafts = data.drafts.filter(d => d.category === key)
                  if (catDrafts.length === 0) return null
                  return (
                    <div key={key}>
                      <div className="px-3 small text-muted mt-1">{label} ({catDrafts.length})</div>
                      {catDrafts.map(d => (
                        <button key={d.id}
                          className="list-group-item list-group-item-action small ps-4 border-0 text-start"
                          onClick={() => window.open('/bot/chat?popup=1', 'tongbotChat', 'width=450,height=700,left=100,top=50')}>
                          {d.title || '제목없음'}
                          <span className={`badge bg-${d.status === 'reviewed' ? 'success' : 'secondary'} ms-1`}>
                            {d.status === 'reviewed' ? '교정완료' : '작성중'}
                          </span>
                          <small className="text-muted float-end">
                            {d.updated_at ? formatDateShort(d.updated_at) : ''}
                          </small>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </>
            )}
            {data.bot_memory && (
              <>
                <div className="px-3 pt-2 small fw-bold text-success">💬 최근 대화</div>
                <div className="p-2 px-3 small text-muted" style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>
                  {data.bot_memory}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Point History */}
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
                  <tr><th>일시</th><th>유형</th><th>변동</th><th>잔액</th><th>설명</th></tr>
                </thead>
                <tbody>
                  {data.point_history.length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-muted py-4">내역 없음</td></tr>
                  ) : (
                    data.point_history.map(h => (
                      <tr key={h.id}>
                        <td className="text-muted">{formatDate(h.created_at)}</td>
                        <td>{CHANGE_LABELS[h.change_type] || h.change_type}</td>
                        <td className={`fw-bold ${h.amount > 0 ? 'text-success' : 'text-danger'}`}>
                          {h.amount > 0 ? '+' : ''}{h.amount.toLocaleString()}
                        </td>
                        <td>{h.balance_after.toLocaleString()}</td>
                        <td className="small">{h.description}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Friends + Messages */}
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
        <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>
          {data.is_own ? '👥 벗 · 편지' : '💬 편지'}
        </div>
        <div className="card-body p-0">
          {data.is_own && data.recent_friends.length > 0 && (
            <div className="p-2 border-bottom">
              <small className="text-muted">최근 교류한 벗</small>
              <div className="d-flex flex-wrap gap-1 mt-1">
                {data.recent_friends.slice(0, 8).map(f => (
                  <a key={f.id} href={`/user/${f.id}`} className="badge bg-light text-dark text-decoration-none">
                    {f.name}
                  </a>
                ))}
              </div>
            </div>
          )}
          <div className="list-group list-group-flush" style={{ maxHeight: 250, overflowY: 'auto' }}>
            {data.messages.length === 0 ? (
              <div className="list-group-item text-center text-muted py-4">편지가 없습니다.</div>
            ) : (
              data.messages.map(m => (
                data.is_own ? (
                  <a key={m.id} href={`/message/read/${m.id}`}
                    className={`list-group-item list-group-item-action small ${!m.is_read && data.is_own ? 'fw-bold bg-light' : ''}`}>
                    <div className="d-flex justify-content-between">
                      <span className="text-muted">{formatDate(m.created_at)}</span>
                      {data.is_own && (
                        <span className={`badge ${m.sender_role === 'admin' ? 'bg-danger' : m.sender_role === 'leader' ? 'bg-primary' : 'bg-secondary'}`}>
                          {m.sender_role}
                        </span>
                      )}
                    </div>
                    <strong>{m.subject || '(제목 없음)'}</strong>
                    <small className="text-muted d-block">
                      {(m.content || '').startsWith('<div') ?
                        <span dangerouslySetInnerHTML={{ __html: m.content || '' }} /> :
                        (m.content || '').slice(0, 80) + ((m.content || '').length > 80 ? '...' : '')}
                    </small>
                  </a>
                ) : (
                  <div key={m.id} className="list-group-item small">
                    <div className="d-flex justify-content-between">
                      <span className="text-muted">{formatDate(m.created_at)}</span>
                      <span className={`badge ${m.is_read ? 'bg-secondary' : 'bg-warning text-dark'}`}>
                        {m.is_read ? '읽음' : '읽지않음'}
                      </span>
                    </div>
                    <strong>{m.subject || '(제목 없음)'}</strong>
                    <small className="text-muted d-block">
                      {(m.content || '').startsWith('<div') ?
                        <span dangerouslySetInnerHTML={{ __html: m.content || '' }} /> :
                        (m.content || '').slice(0, 80) + ((m.content || '').length > 80 ? '...' : '')}
                    </small>
                  </div>
                )
              ))
            )}
          </div>
        </div>
      </div>

      {/* Posts */}
      {data.posts.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
          <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>📝 작성한 글</div>
          <div className="card-body p-0">
            {Object.entries(TYPE_LABELS).map(([tkey, tlabel]) => {
              const tposts = data.posts.filter(p => p.type === tkey)
              if (tposts.length === 0) return null
              return (
                <div key={tkey}>
                  <div className="px-3 pt-2 small fw-bold text-success">{tlabel} ({tposts.length})</div>
                  <div className="list-group list-group-flush">
                    {tposts.map((p, i) => (
                      <a key={i} href={p.url}
                        className="list-group-item list-group-item-action small ps-4">
                        {(p.title || '').slice(0, 50)}{(p.title || '').length > 50 ? '...' : ''}
                        <small className="text-muted float-end">{formatDate(p.date)}</small>
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Photos */}
      {data.share_images.length > 0 && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
          <div className="card-header bg-white fw-bold" style={{ borderRadius: '18px 18px 0 0' }}>🖼️ 공유한 사진</div>
          <div className="card-body p-2">
            <div className="row g-2">
              {data.share_images.map((img, i) => (
                <div key={i} className="col-4 col-md-3">
                  <a href={img.url} className="d-block position-relative">
                    <img src={img.path} className="img-fluid rounded"
                      style={{ height: 120, objectFit: 'cover', width: '100%' }}
                      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      alt={img.title || '사진'} />
                    <small className="d-block text-truncate text-muted">{img.title || '사진'}</small>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

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
                <MemoPanel />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bot Settings Modal */}
      {showBotSettings && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1050 }}
          onClick={() => setShowBotSettings(false)}>
          <div className="modal-dialog modal-dialog-centered modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 16 }}>
              <div className="modal-header border-0 pb-0">
                <h5 className="fw-bold">🤖 통벗 설정</h5>
                <button className="btn-close" onClick={() => setShowBotSettings(false)} />
              </div>
              <div className="modal-body">
                <BotSettingsPanel data={data} load={load} onClose={() => setShowBotSettings(false)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Weather Modal - 면 전체 날씨 */}
      {showWeatherModal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.4)', zIndex: 1050 }}
          onClick={() => setShowWeatherModal(false)}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
            <div className="modal-content" style={{ borderRadius: 16, maxHeight: '80vh' }}>
              <div className="modal-header border-0 pb-0">
                <h6 className="fw-bold">🌤️ 양평군 면별 날씨</h6>
                <button className="btn-close" onClick={() => setShowWeatherModal(false)} />
              </div>
              <div className="modal-body overflow-auto p-2" style={{ maxHeight: 'calc(80vh - 80px)' }}>
                {Object.keys(allWeather).length === 0 ? (
                  <div className="text-center text-muted py-3 small">로딩 중...</div>
                ) : (
                  Object.entries(allWeather).map(([town, w]: [string, any]) => {
                    const open = expandedTown === town
                    return (
                      <div key={town} className="mb-1 rounded" style={{ background: '#f8f9fa' }}>
                        <div className="d-flex align-items-center gap-2 p-2 small" style={{ cursor: 'pointer' }}
                          onClick={() => setExpandedTown(open ? null : town)}>
                          <span className="fs-6">{w.icon}</span>
                          <div className="flex-grow-1">
                            <span className="fw-bold">{w.town}</span>{' '}
                            <span className="text-muted">{w.sky} {w.temperature}°C</span>
                          </div>
                          <span className="text-muted small">{open ? '▲' : '▼'}</span>
                        </div>
                        {open && (
                          <div className="px-2 pb-2 d-flex gap-2 text-muted flex-wrap" style={{ fontSize: '0.75rem' }}>
                            <span>💧 습도 {w.humidity}%</span>
                            <span>🌧️ 강수 {w.precipitation_prob}%</span>
                            <span>💨 바람 {w.wind_speed}m/s</span>
                            {w.uv_text && <span>☀️ 자외선 {w.uv_text}</span>}
                            {(w.air_text || w.o3_text) && (
                              <>
                                {w.air_text && <span>🌫️ 공기 {w.air_text} (PM2.5 {w.pm25}µg/m³)</span>}
                                {w.o3_text && <span>🫧 오존 {w.o3_text}</span>}
                              </>
                            )}
                            {w.rain_info && <span className="text-info w-100">🌧️ {w.rain_info}</span>}
                            {w.sunrise && w.sunset && <span className="w-100">🌅 일출 {w.sunrise} · 🌇 일몰 {w.sunset}</span>}
                            {w.tip && <span className="w-100" style={{ color: '#1976d2' }}>💡 {w.tip}</span>}
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function DashboardPanel() {
  const [dash, setDash] = useState<{
    today_schedules: { id: number; title: string; time: string; location: string; memo: string }[]
    unread_count: number; unread_messages: { id: number; subject: string; sender: string; created_at: string }[]
    notices: { id: number; title: string; content: string; alert_type: string; urgency: string }[]
    ai_tip: string
  } | null>(null)
  const [leaderboard, setLeaderboard] = useState<{user_id:number;bot_name:string;username:string;level:number;intimacy:number;knowledge_count:number;praise_count:number;score:number;mood:string}[]>([])
  const [showAllRank, setShowAllRank] = useState(false)

  useEffect(() => {
    fetch('/api/user/dashboard', { credentials: 'include' })
      .then(r => r.json()).then(d => setDash(d)).catch(() => {})
    fetch('/api/bot/leaderboard', { credentials: 'include' })
      .then(r => r.json()).then(d => setLeaderboard(d.leaderboard || [])).catch(() => {})
  }, [])

  if (!dash) return null

  return (
    <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18 }}>
      <div className="card-body p-3">
        {/* 통벗 AI Tip 한줄 */}
        {dash.ai_tip && (
          <div className="small mb-2" style={{ color: '#1976d2' }}>🤖 {dash.ai_tip}</div>
        )}

        {/* 오늘 일정 한줄 */}
        {dash.today_schedules.length > 0 && (
          <div className="small text-muted mb-1">
            📅 {dash.today_schedules.map((s: any) => `${s.title} ${s.time}`).join(' · ')}
          </div>
        )}

        {/* 안 읽은 편지 한줄 */}
        {dash.unread_messages.length > 0 && (
          <div className="small text-muted mb-1">
            ✉️ 안 읽은 편지 {dash.unread_count}건
          </div>
        )}

        {/* 통벗 랭킹 1등 */}
        {leaderboard.length > 0 && (
          <div className="mt-1">
            {!showAllRank ? (
              <div className="d-flex align-items-center gap-1 small" style={{ cursor: 'pointer' }} onClick={() => setShowAllRank(true)}>
                <span className="fw-bold text-warning">🏆 1위</span>
                <span>{leaderboard[0].bot_name}</span>
                <small className="text-muted">Lv.{leaderboard[0].level} ❤️{leaderboard[0].intimacy}</small>
                <small className="text-muted ms-auto">▼</small>
              </div>
            ) : (
              <div>
                <div className="d-flex align-items-center mb-1" style={{ cursor: 'pointer' }} onClick={() => setShowAllRank(false)}>
                  <small className="fw-bold text-warning">🏆 통벗 랭킹</small>
                  <small className="text-muted ms-auto">▲</small>
                </div>
                {leaderboard.slice(0, 10).map((b, i) => (
                  <div key={b.user_id} className="d-flex align-items-center gap-1 py-1 small">
                    <span className={`fw-bold ${i < 3 ? 'text-warning' : 'text-muted'}`}>{i + 1}</span>
                    <span>{b.bot_name}</span>
                    <small className="text-muted">Lv.{b.level} ❤️{b.intimacy}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoPanel() {
  const [memos, setMemos] = useState<{id:number;content:string;author:string;is_shared:boolean;done:boolean;end_date?:string;created_at:string}[]>([])
  const [newContent, setNewContent] = useState('')
  const [editing, setEditing] = useState<{id:number;content:string} | null>(null)
  const [comments, setComments] = useState<Record<number, {id:number;content:string;user_name:string;is_own:boolean}[]>>({})
  const [openComments, setOpenComments] = useState<Record<number, boolean>>({})
  const [commentInputs, setCommentInputs] = useState<Record<number, string>>({})

  const load = () => {
    fetch('/api/bot/memos', { credentials: 'include' }).then(r => r.json()).then(d => {
      setMemos(Array.isArray(d.memos) ? d.memos : [])
    }).catch(() => {})
  }
  useEffect(load, [])

  const create = () => {
    const c = newContent.trim()
    if (!c) return
    fetch('/api/bot/memos', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: c }), credentials: 'include' })
      .then(r => r.json()).then(d => { if (d.success) { setNewContent(''); load() } })
  }

  const update = (id: number, data: any) => {
    fetch(`/api/bot/memos/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data), credentials: 'include' }).then(r => r.json()).then(d => { if (d.success) load() })
  }

  const remove = (id: number) => {
    if (!confirm('삭제하시겠습니까?')) return
    fetch(`/api/bot/memos/${id}`, { method: 'DELETE', credentials: 'include' })
      .then(r => r.json()).then(d => { if (d.success) load() })
  }

  const toggleComments = (id: number) => {
    const o = !openComments[id]
    setOpenComments(prev => ({ ...prev, [id]: o }))
    if (o && !comments[id]) {
      fetch(`/api/bot/memos/${id}/comments`, { credentials: 'include' })
        .then(r => r.json()).then(d => {
          setComments(prev => ({ ...prev, [id]: Array.isArray(d.comments) ? d.comments : [] }))
        }).catch(() => {})
    }
  }

  const addComment = (memoId: number) => {
    const c = (commentInputs[memoId] || '').trim()
    if (!c) return
    fetch(`/api/bot/memos/${memoId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: c }), credentials: 'include'
    }).then(r => r.json()).then(d => {
      if (d.success) {
        setCommentInputs(prev => ({ ...prev, [memoId]: '' }))
        fetch(`/api/bot/memos/${memoId}/comments`, { credentials: 'include' })
          .then(r => r.json()).then(d2 => {
            setComments(prev => ({ ...prev, [memoId]: Array.isArray(d2.comments) ? d2.comments : [] }))
          })
      }
    })
  }

  const delComment = (memoId: number, commentId: number) => {
    fetch(`/api/bot/memos/${memoId}/comments/${commentId}`, { method: 'DELETE', credentials: 'include' })
      .then(r => r.json()).then(d => {
        if (d.success) {
          setComments(prev => ({
            ...prev,
            [memoId]: (prev[memoId] || []).filter(c => c.id !== commentId)
          }))
        }
      })
  }

  return (
    <div>
      {/* New memo input */}
      <div className="input-group input-group-sm mb-3">
        <input className="form-control" placeholder="메모 내용 입력..."
          value={newContent} onChange={e => setNewContent(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') create() }} />
        <button className="btn btn-success" onClick={create}>추가</button>
      </div>

      {/* Memo list */}
      {memos.length === 0 && <div className="text-muted text-center py-4">메모가 없습니다.</div>}
      {memos.map(m => (
        <div key={m.id} className="p-2 mb-2 rounded" style={{ background: m.done ? '#f0fdf4' : '#fff', border: '1px solid #e5e7eb' }}>
          <div className="d-flex align-items-start gap-2">
            {/* Done checkbox */}
            <input type="checkbox" className="mt-1" checked={m.done}
              onChange={e => update(m.id, { done: e.target.checked })} />
            {/* Content */}
            <div className="flex-grow-1">
              {editing?.id === m.id ? (
                <div className="d-flex gap-1">
                  <input className="form-control form-control-sm" value={editing.content}
                    onChange={e => setEditing({ ...editing, content: e.target.value })} />
                  <button className="btn btn-sm btn-primary" onClick={() => {
                    update(m.id, { content: editing.content }); setEditing(null)
                  }}>저장</button>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setEditing(null)}>취소</button>
                </div>
              ) : (
                <>
                  <span style={{ textDecoration: m.done ? 'line-through' : 'none', wordBreak: 'break-word' }}>{m.content}</span>
                  <div className="d-flex gap-2 mt-1">
                    <small className="text-muted">{m.author === 'bot' ? '🤖' : '👤'} {new Date(m.created_at).toLocaleDateString()}</small>
                    {m.end_date && <small className="text-muted">⏰ {new Date(m.end_date).toLocaleDateString()}</small>}
                    <button className="btn btn-sm p-0 text-primary" onClick={() => setEditing({ id: m.id, content: m.content })}>✏️</button>
                    <button className="btn btn-sm p-0 text-danger" onClick={() => remove(m.id)}>🗑️</button>
                    <button className="btn btn-sm p-0" onClick={() => update(m.id, { is_shared: !m.is_shared })}>
                      {m.is_shared ? '🔓 공개' : '🔒 비공개'}
                    </button>
                    <button className="btn btn-sm p-0" onClick={() => toggleComments(m.id)}>
                      💬 {(comments[m.id]?.length || 0) > 0 ? comments[m.id]!.length : ''}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Comments */}
          {openComments[m.id] && (
            <div className="mt-2 ps-4 border-start border-2">
              {(comments[m.id] || []).map(c => (
                <div key={c.id} className="d-flex justify-content-between align-items-start mb-1 small">
                  <div><strong>{c.user_name}</strong> {c.content}</div>
                  {c.is_own && <button className="btn btn-sm p-0 text-danger" onClick={() => delComment(m.id, c.id)}>🗑️</button>}
                </div>
              ))}
              <div className="d-flex gap-1 mt-1">
                <input className="form-control form-control-sm" placeholder="댓글..."
                  value={commentInputs[m.id] || ''} onChange={e => setCommentInputs(prev => ({ ...prev, [m.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') addComment(m.id) }} />
                <button className="btn btn-sm btn-outline-primary" onClick={() => addComment(m.id)}>작성</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function BotSettingsPanel({ data, load, onClose }: { data: any; load: () => void; onClose: () => void }) {
  const [name, setName] = useState(data.bot_name || '')
  const [llmProvider, setLlmProvider] = useState('motif')
  const [apiKey, setApiKey] = useState('')

  const doRename = async () => {
    const n = name.trim()
    if (!n) return alert('이름을 입력하세요.')
    const r = await fetch('/api/bot/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) })
    const d = await r.json()
    if (d.error) alert(d.error)
    else { alert('✅ 이름 변경 완료'); load() }
  }

  return (
    <div>
      {/* Bot Name */}
      <div className="mb-3">
        <label className="form-label small fw-bold">통벗 이름</label>
        <div className="input-group input-group-sm">
          <input className="form-control" value={name} onChange={e => setName(e.target.value)}
            placeholder="이름 (2~20자)" maxLength={20} />
          <button className="btn btn-primary" onClick={doRename}>저장</button>
        </div>
      </div>

      {/* LLM Provider */}
      <div className="mb-3">
        <label className="form-label small fw-bold">LLM 제공자</label>
        <select className="form-select form-select-sm" value={llmProvider} onChange={e => setLlmProvider(e.target.value)}>
          <option value="motif">MOTIF (기본)</option>
          <option value="groq">Groq</option>
          <option value="openai">OpenAI</option>
        </select>
        <small className="text-muted d-block mt-1">개인용도로만 사용 가능합니다.</small>
      </div>

      {/* API Key */}
      <div className="mb-2">
        <label className="form-label small fw-bold">API 키</label>
        <input className="form-control form-control-sm" type="password" value={apiKey}
          onChange={e => setApiKey(e.target.value)} placeholder="API 키 입력" />
        <small className="text-muted d-block mt-1">비워두면 기본 키가 사용됩니다.</small>
      </div>

      <div className="d-flex gap-2 mt-3">
        <button className="btn btn-sm btn-success" onClick={() => {
          fetch('/api/bot/llm-settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: llmProvider, api_key: apiKey })
          }).then(r => r.json()).then(d => {
            if (d.success) alert('✅ LLM 설정 저장 완료')
            else alert(d.error || '저장 실패')
          }).catch(() => alert('저장 실패'))
        }}>설정 저장</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>닫기</button>
      </div>
    </div>
  )
}

function TodoMemoStrip() {
  const [memos, setMemos] = useState<{ id: number; content: string; done: boolean; end_date: string; created_at?: string; updated_at?: string }[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch('/api/bot/memos', { credentials: 'include' })
      .then(r => r.json()).then(d => {
        const list: { id: number; content: string; done: boolean; end_date: string; created_at?: string; updated_at?: string }[] =
          Array.isArray(d.memos) ? d.memos.filter((m: any) => !m.done) : []
        list.sort((a, b) => {
          const ae = a.end_date ? new Date(a.end_date).getTime() : Infinity
          const be = b.end_date ? new Date(b.end_date).getTime() : Infinity
          if (ae !== be) return ae - be
          return (new Date(b.updated_at || b.created_at || 0).getTime()) - (new Date(a.updated_at || a.created_at || 0).getTime())
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

