import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const MOODS: Record<string, { emoji: string; label: string }> = {
  warm: { emoji: '💕', label: '따스한' }, proud: { emoji: '🥲', label: '대견한' },
  encourage: { emoji: '💪', label: '응원' }, worried: { emoji: '😌', label: '걱정' },
  happy: { emoji: '😊', label: '기쁜' }, blessing: { emoji: '🙏', label: '축복' },
  neutral: { emoji: '🤖', label: '평온' },
}
const LEVELS: Record<number, { emoji: string; name: string }> = {
  1: { emoji: '🥚', name: '알' }, 2: { emoji: '🐣', name: '새싹' },
  3: { emoji: '🌱', name: '묘목' }, 4: { emoji: '🪴', name: '나무' },
  5: { emoji: '🌸', name: '꽃' }, 6: { emoji: '🌟', name: '별' },
  7: { emoji: '👑', name: '수호자' },
}

interface BotInfo {
  bot_name: string; bot_id: string; mood: string; level: number
  intimacy: number; tone: string; chat_count: number
}

interface ChatMessage {
  role: 'user' | 'bot'; text: string; name: string
  pages?: { label: string; path: string }[]
}

export default function TongBotChatPage() {
  const navigate = useNavigate()
  const [bot, setBot] = useState<BotInfo | null>(null)
  const [userId, setUserId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyData, setHistoryData] = useState<{role:string;text:string}[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/me', { credentials: 'include' }).then(r => r.json()).then(d => {
      if (d.bot) {
        setBot(d.bot)
        setUserId(d.id)
        const gc = [`${d.username}님, 반갑습니다!`, `오늘도 좋은 하루 되세요, ${d.username}님!`]
        const greeting = gc[Math.floor(Math.random() * gc.length)]
        setMessages([{ role: 'bot', text: greeting, name: d.bot.bot_name || '통벗' }])
      }
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  const sendChat = () => {
    const msg = input.trim()
    if (!msg || sending) return
    setSending(true)
    setMessages(prev => [...prev, { role: 'user', text: msg, name: '나' }])
    setInput('')
    fetch('/api/bot/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
      credentials: 'include',
    }).then(r => r.json()).then(d => {
      const msgs: ChatMessage[] = [
        { role: 'bot', text: d.reply || '(응답 없음)', name: d.bot_name || bot?.bot_name || '통벗' }
      ]
      if (d.schedule) { msgs.push({ role: 'bot', text: `📅 ${d.schedule.title}`, name: 'AI' }) }
      if (d.suggestion) d.suggestion.forEach((s: {text:string}) => msgs.push({ role: 'bot', text: `💡 ${s.text}`, name: '제안' }))
      if (d.pages && d.pages.length) {
        msgs.push({ role: 'bot', text: '🔗 아래 페이지를 바로 열어드릴게요.', name: '통벗', pages: d.pages })
      }
      setMessages(prev => [...prev, ...msgs])
    }).catch(() => setMessages(prev => [...prev, { role: 'bot', text: '응답 실패', name: 'AI' }]))
      .finally(() => {
        setSending(false)
        inputRef.current?.focus()
      })
  }

  const loadHistory = () => {
    if (showHistory) { setShowHistory(false); return }
    setShowHistory(true)
    fetch('/api/bot/history', { credentials: 'include' }).then(r => r.json()).then(d => setHistoryData(d.history || [])).catch(() => setHistoryData([]))
  }

  const moodInfo = bot ? MOODS[bot.mood] || MOODS.neutral : MOODS.neutral
  const levelInfo = bot ? LEVELS[bot.level] || LEVELS[1] : LEVELS[1]
  const searchParams = new URLSearchParams(window.location.search)
  const isPopup = searchParams.get('popup') === '1'

  return (
    <div className="d-flex flex-column" style={{ height: isPopup ? '100vh' : 'calc(100vh - 56px)', maxWidth: 800, margin: '0 auto' }}>
      {/* Status Bar */}
      <div className="d-flex align-items-center gap-3 p-3 border-bottom bg-white" style={{ flexShrink: 0 }}>
        <div className="d-flex align-items-center gap-2">
          <span className="fs-3">{moodInfo.emoji}</span>
          <div>
            <strong>{bot?.bot_name || '통벗'}</strong>
            <small className="text-muted d-block">{moodInfo.label} · {levelInfo.name} Lv.{bot?.level || 1}</small>
          </div>
        </div>
        <div className="ms-auto d-flex align-items-center gap-3 small text-muted">
          <span>💬 {bot?.chat_count || 0}</span>
          <span>❤️ {bot?.intimacy || 0}</span>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-grow-1 overflow-auto p-3" style={{ background: '#f8f9fa' }}>
        {messages.map((c, i) => (
          <div key={i} className={`d-flex mb-3 ${c.role === 'user' ? 'justify-content-end' : 'justify-content-start'}`}>
              <div className="px-3 py-2 position-relative" style={{
                maxWidth: '80%', borderRadius: 16,
                background: c.role === 'user' ? '#198754' : '#fff',
                color: c.role === 'user' ? '#fff' : '#212529',
                wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}>
                {c.text}
                {c.pages && c.pages.length > 0 && (
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    {c.pages.map((p, pi) => (
                      <button key={pi} className="btn btn-sm btn-success"
                        onClick={() => navigate(p.path)}>
                        ▶ {p.label} 열기
                      </button>
                    ))}
                  </div>
                )}
                {c.role === 'bot' && (
                  <div className="position-absolute d-flex gap-1" style={{ top: 2, right: 4 }}>
                    <button className="btn btn-sm p-0" title="도움됨" style={{ fontSize: '0.65rem' }}
                      onClick={async () => {
                        await fetch('/api/bot/feedback', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ positive: true, bot_user_id: userId }),
                          credentials: 'include',
                        })
                        alert('👍 의견 감사합니다!')
                      }}>👍</button>
                    <button className="btn btn-sm p-0" title="메모 저장" style={{ fontSize: '0.65rem' }}
                      onClick={async () => {
                        const r = await fetch('/api/bot/memos', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ content: c.text, author: 'bot' }),
                          credentials: 'include',
                        })
                        const d = await r.json()
                        if (d.success) alert('✅ 메모 저장됨')
                      }}>💾</button>
                  </div>
                )}
              </div>
          </div>
        ))}
        {sending && (
          <div className="d-flex justify-content-start mb-3">
            <div className="px-3 py-2" style={{ maxWidth: '80%', borderRadius: 16, background: '#fff', color: '#6c757d' }}>
              입력 중...
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-top d-flex gap-2 bg-white" style={{ flexShrink: 0 }}>
        <input ref={inputRef} className="form-control" placeholder="메시지를 입력하세요..."
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }}}
          disabled={sending} />
        <button className="btn btn-success px-4" onClick={sendChat} disabled={sending || !input.trim()}>전송</button>
        <button className="btn btn-outline-secondary" onClick={loadHistory} title="대화 기록">📜</button>
      </div>

      {/* History Panel */}
      {showHistory && (
        <div className="border-top p-2 small" style={{ maxHeight: 200, overflowY: 'auto', background: '#fff', flexShrink: 0 }}>
          <strong>📜 대화 기록 ({bot?.chat_count || 0}회)</strong>
          {historyData.length === 0 && <div className="text-muted py-1">기록이 없습니다.</div>}
          {historyData.map((h, i) => (
            <div key={i} className={`mb-1 ${h.role === 'user' ? 'text-end' : 'text-start'}`}>
              <span className={`badge bg-${h.role === 'user' ? 'primary' : 'success'}`}>{h.role === 'user' ? '나' : '통벗'}</span> {h.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
