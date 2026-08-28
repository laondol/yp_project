import { useState, useRef, useEffect, useCallback } from 'react'
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

// Web Speech API 타입 선언
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}
interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}
interface SpeechRecognitionResult {
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
  isFinal: boolean
}
interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

declare global {
  interface Window {
    SpeechRecognition: any
    webkitSpeechRecognition: any
  }
}

function speak(text: string, lang = 'ko-KR', onEnd?: () => void) {
  const synth = window.speechSynthesis
  if (!synth) return
  synth.cancel()
  const utter = new SpeechSynthesisUtterance(text.replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,!?~]/g, ''))
  utter.lang = lang
  utter.rate = 1
  utter.pitch = 1
  const voices = synth.getVoices()
  const ko = voices.find(v => v.lang.startsWith('ko'))
  if (ko) utter.voice = ko
  if (onEnd) {
    utter.onend = onEnd
    utter.onerror = onEnd
  }
  // Chrome: cancel() 직후 speak()하면 무시되는 버그 → 약간의 딜레이 필요
  setTimeout(() => synth.speak(utter), 150)
}

// 마이크 시작/종료 신호음
function playBeep(freq = 880, duration = 120) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext
    if (!AC) return
    const ctx = new AC()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.08, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000)
    osc.start()
    osc.stop(ctx.currentTime + duration / 1000)
    osc.onended = () => ctx.close()
  } catch {}
}

// 채팅창 닫기 음성 명령 ("채팅창 닫아(줘)" 등 짧은 마침 표현)
const CLOSE_WIN_RE = /^(?:[가-힣]{1,3}\s*)?(?:채팅\s*창|창)?\s*(?:닫아|닫아\s*줘|닫기|꺼줘|끝낼게|끝내자|그만하자)(?:\s*(?:줘|요))?$/

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
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // STT/TTS 상태
  const [isListening, setIsListening] = useState(false)
  const [autoTts, setAutoTts] = useState(() => {
    try { return localStorage.getItem('tongbot_auto_tts') === 'true' } catch { return false }
  })
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)
  const [continuous, setContinuous] = useState(() => {
    try { return localStorage.getItem('tongbot_listen_continuous') === 'true' } catch { return false }
  })
  const recognitionRef = useRef<any>(null)
  const continuousRef = useRef(continuous)
  const sendChatRef = useRef<(msg?: string) => void>(() => {})
  const sendingRef = useRef(false)
  const lastTranscriptRef = useRef('')
  const silenceTimerRef = useRef<number | null>(null)
  const ttsSpeakingRef = useRef(false)

  useEffect(() => {
    try { localStorage.setItem('tongbot_auto_tts', String(autoTts)) } catch {}
  }, [autoTts])

  // 3초 침묵 시 자동 전송 타이머
  const armSilenceTimer = () => {
    if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null
      const t = lastTranscriptRef.current.trim()
      if (t && !sendingRef.current) {
        lastTranscriptRef.current = ''
        sendChatRef.current(t)
      }
    }, 3000)
  }

  // 통벗 말하는 동안 마이크 중지 (에코 루프 방지: 봇 목소리를 마이크가 듣는 것 차단)
  const suspendMicForTts = () => {
    ttsSpeakingRef.current = true
    if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
    try { recognitionRef.current?.stop() } catch {}
  }

  // 통벗 말 끝나면 연속 듣기 재개
  const resumeMicIfContinuous = () => {
    ttsSpeakingRef.current = false
    if (continuousRef.current) {
      setTimeout(() => {
        if (!continuousRef.current || ttsSpeakingRef.current) return
        try { recognitionRef.current?.start(); setIsListening(true) } catch {}
      }, 300)
    }
  }

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

  // 음성 합성 음성 목록 로드
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.getVoices()
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices()
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sending) inputRef.current?.focus()
  }, [sending])

  // 입력창 자동 확장 (말하는 대로 글이 모두 보이게)
  useEffect(() => {
    const el = inputRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    }
  }, [input])

  // STT 시작
  const startRecognition = useCallback((isContinuous: boolean) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('이 브라우저는 음성 인식을 지원하지 않습니다.\nChrome/Edge 브라우저를 사용해 주세요.')
      return
    }
    try { recognitionRef.current?.stop() } catch {}
    const recognition = new SpeechRecognition()
    recognition.lang = 'ko-KR'
    recognition.interimResults = true
    recognition.continuous = isContinuous
    recognition.maxAlternatives = 1

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      // 채팅창 닫기 음성 명령 즉시 처리
      if (!sendingRef.current && CLOSE_WIN_RE.test(transcript.trim())) {
        if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
        lastTranscriptRef.current = ''
        setInput('')
        playBeep(520)
        setTimeout(() => window.close(), 400)
        return
      }
      lastTranscriptRef.current = transcript
      setInput(transcript)
      armSilenceTimer()
    }
    recognition.onerror = (e: any) => {
      setIsListening(false)
      if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
        continuousRef.current = false
        setContinuous(false)
      }
    }
    recognition.onend = () => {
      setIsListening(false)
      if (continuousRef.current && !ttsSpeakingRef.current) {
        setTimeout(() => {
          if (!continuousRef.current || ttsSpeakingRef.current) return
          try { recognitionRef.current?.start(); setIsListening(true) } catch {}
        }, 400)
      }
    }

    recognitionRef.current = recognition
    recognition.start()
    setIsListening(true)
  }, [])

  // 🎤 한 번 듣기 토글
  const toggleListening = useCallback(() => {
    if (isListening) {
      if (continuousRef.current) {
        continuousRef.current = false
        setContinuous(false)
        try { localStorage.setItem('tongbot_listen_continuous', 'false') } catch {}
      }
      if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      recognitionRef.current?.stop()
      setIsListening(false)
      playBeep(520)
      return
    }
    playBeep(880)
    startRecognition(false)
  }, [isListening, startRecognition])

  // 🎙️ 연속 말하기 모드 토글
  const setContinuousMode = useCallback((on: boolean) => {
    continuousRef.current = on
    setContinuous(on)
    try { localStorage.setItem('tongbot_listen_continuous', String(on)) } catch {}
    if (on) {
      lastTranscriptRef.current = ''
      playBeep(880)
      startRecognition(true)
    } else {
      if (silenceTimerRef.current) { window.clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null }
      recognitionRef.current?.stop()
      setIsListening(false)
      playBeep(520)
    }
  }, [startRecognition])

  // 페이지 로드 시 연속 모드 자동 재개
  useEffect(() => {
    if (continuousRef.current) {
      startRecognition(true)
    }
    return () => {
      try { recognitionRef.current?.stop() } catch {}
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current)
    }
  }, [startRecognition])

  // 채팅창 열림/닫힘 알림 → 네비바 웨이크워드 마이크 충돌 방지
  useEffect(() => {
    try { localStorage.setItem('tongbot_popup_open', '1') } catch {}
    const cleanup = () => { try { localStorage.removeItem('tongbot_popup_open') } catch {} }
    window.addEventListener('pagehide', cleanup)
    window.addEventListener('beforeunload', cleanup)
    return () => {
      window.removeEventListener('pagehide', cleanup)
      window.removeEventListener('beforeunload', cleanup)
      cleanup()
    }
  }, [])

  // TTS 재생
  const handleSpeak = useCallback((text: string, idx: number) => {
    const synth = window.speechSynthesis
    if (!synth) return
    if (speakingIdx === idx || synth.speaking) {
      synth.cancel()
      setSpeakingIdx(null)
      resumeMicIfContinuous()
      return
    }
    setSpeakingIdx(idx)
    suspendMicForTts()
    speak(text, 'ko-KR', () => {
      setSpeakingIdx(null)
      resumeMicIfContinuous()
    })
  }, [speakingIdx])

  const sendChat = (override?: string) => {
    const msg = (typeof override === 'string' ? override : input).trim()
    if (!msg || sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setMessages(prev => [...prev, { role: 'user', text: msg, name: '나' }])
    setInput('')
    lastTranscriptRef.current = ''
    fetch('/api/bot/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
      credentials: 'include',
    }).then(r => r.json()).then(d => {
      const reply = d.reply || '(응답 없음)'
      const msgs: ChatMessage[] = [
        { role: 'bot', text: reply, name: d.bot_name || bot?.bot_name || '통벗' }
      ]
      if (d.schedule) { msgs.push({ role: 'bot', text: `📅 ${d.schedule.title}`, name: 'AI' }) }
      if (d.suggestion) d.suggestion.forEach((s: {text:string}) => msgs.push({ role: 'bot', text: `💡 ${s.text}`, name: '제안' }))
      if (d.pages && d.pages.length) {
        msgs.push({ role: 'bot', text: '🔗 아래 페이지를 바로 열어드릴게요.', name: '통벗', pages: d.pages })
      }
      setMessages(prev => [...prev, ...msgs])
      // 통벗 음성 명령 적용 (말하기 켜줘/꺼줘, 연속 듣기 켜줘/꺼줘)
      if (d.voice_cmd === 'on') setAutoTts(true)
      if (d.voice_cmd === 'off') setAutoTts(false)
      if (d.listen_cmd === 'on' && !continuousRef.current) setContinuousMode(true)
      if (d.listen_cmd === 'off' && continuousRef.current) setContinuousMode(false)
      // 자동 TTS (통벗 말하는 동안 마이크 중지 → 말 끝나면 재개)
      const ttsDone = () => {
        resumeMicIfContinuous()
        if (d.close_cmd) window.close()
      }
      if ((autoTts || d.voice_cmd === 'on') && reply) {
        suspendMicForTts()
        setTimeout(() => speak(reply, 'ko-KR', ttsDone), 300)
      } else if (d.close_cmd) {
        // 인사 확인 후 채팅창 닫기
        setTimeout(() => window.close(), 1500)
      }
    }).catch(() => setMessages(prev => [...prev, { role: 'bot', text: '응답 실패', name: 'AI' }]))
      .finally(() => {
        sendingRef.current = false
        setSending(false)
        inputRef.current?.focus()
      })
  }
  sendChatRef.current = sendChat

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
        <div className="ms-auto d-flex align-items-center gap-2 small">
          <button
            className={`btn btn-sm py-0 ${autoTts ? 'btn-success' : 'btn-outline-secondary'}`}
            onClick={() => setAutoTts(!autoTts)}
            title={autoTts ? '자동 음성 ON' : '자동 음성 OFF'}
            style={{ fontSize: '0.75rem' }}
          >
            🔊 {autoTts ? 'ON' : 'OFF'}
          </button>
          <span className="text-muted">💬 {bot?.chat_count || 0}</span>
          <span className="text-muted">❤️ {bot?.intimacy || 0}</span>
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
                    <button
                      className="btn btn-sm p-0" title="음성으로 듣기"
                      style={{ fontSize: '0.7rem', color: speakingIdx === i ? '#198754' : '#6c757d' }}
                      onClick={() => handleSpeak(c.text, i)}
                    >
                      {speakingIdx === i ? '⏸' : '🔊'}
                    </button>
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
      <div className="p-3 border-top d-flex gap-2 bg-white align-items-center" style={{ flexShrink: 0 }}>
        <button
          className={`btn ${continuous ? 'btn-success' : 'btn-outline-secondary'} d-flex align-items-center justify-content-center`}
          onClick={() => setContinuousMode(!continuous)}
          title={continuous ? '연속 말하기 중지' : '연속 말하기 (3초 침묵 시 자동 전송)'}
          style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, fontSize: '1.05rem' }}
        >
          🎙️
        </button>
        <button
          className={`btn ${isListening ? 'btn-danger' : 'btn-outline-secondary'} d-flex align-items-center justify-content-center`}
          onClick={toggleListening}
          title={isListening ? '음성 입력 중지' : '음성 입력'}
          style={{ width: 42, height: 42, borderRadius: '50%', flexShrink: 0, fontSize: '1.1rem' }}
        >
          {isListening ? '⏹' : '🎤'}
        </button>
        <textarea ref={inputRef} rows={1} className="form-control" placeholder={isListening ? (continuous ? '연속 듣는 중... 3초 침묵 시 자동 전송' : '듣는 중...') : '메시지를 입력하세요...'}
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat() }}}
          disabled={sending}
          style={{ resize: 'none', overflow: 'hidden', maxHeight: 120 }} />
        <button className="btn btn-success px-4" onClick={() => sendChat()} disabled={sending || !input.trim()}>전송</button>
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
