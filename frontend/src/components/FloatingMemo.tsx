import { useState, useEffect, useRef } from 'react'

interface Reminder {
  id: number
  title: string
  event_date: string
  occ_date?: string
  kind?: string
}

const POLL_INTERVAL = 30000

export default function FloatingMemo() {
  const [reminder, setReminder] = useState<Reminder | null>(null)
  const [popping, setPopping] = useState(false)
  const [visible, setVisible] = useState(false)
  const [showBubble, setShowBubble] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const doneAtRef = useRef<number | null>(null)
  const shownIdsRef = useRef<Set<number>>(new Set())

  const fetchReminders = async () => {
    try {
      const res = await fetch('/api/bot/schedule/reminders', { credentials: 'include' })
      if (!res.ok) return
      const d = await res.json()
      const reminders: Reminder[] = d.reminders || []
      const upcoming = reminders.find(r => !shownIdsRef.current.has(r.id))
      if (upcoming) {
        setReminder(upcoming)
        setVisible(true)
        setShowBubble(true)
        doneAtRef.current = Date.now()
        const evt = new Date(upcoming.event_date)
        const now = new Date()
        const diff = Math.max(0, (evt.getTime() - now.getTime()) / 1000)
        setRemaining(Math.min(diff, 600))
        shownIdsRef.current.add(upcoming.id)
        setTimeout(() => setShowBubble(false), 5000)
      }
    } catch {}
  }

  useEffect(() => {
    fetchReminders()
    const poll = setInterval(fetchReminders, POLL_INTERVAL)
    return () => clearInterval(poll)
  }, [])

  useEffect(() => {
    if (!visible || popping) return
    const timer = setInterval(() => {
      if (!doneAtRef.current || !reminder) return
      const elapsed = (Date.now() - doneAtRef.current) / 1000
      const rem = Math.max(0, remaining - elapsed)
      setRemaining(rem)
      if (rem <= 0) {
        setPopping(true)
        setTimeout(() => {
          setVisible(false)
          setPopping(false)
          setReminder(null)
          doneAtRef.current = null
        }, 500)
        clearInterval(timer)
      }
    }, 200)
    return () => clearInterval(timer)
  }, [visible, popping, remaining, reminder])

  const handleClick = () => {
    window.location.href = reminder && reminder.kind === 'memo' ? '/memo' : '/schedule'
  }

  const handleClose = () => {
    setPopping(true)
    setTimeout(() => {
      setVisible(false)
      setPopping(false)
      setReminder(null)
      doneAtRef.current = null
    }, 500)
  }

  if (!visible || !reminder) return null

  const isBill = reminder.title.includes('공과금') || reminder.title.includes('요금') || reminder.title.includes('납부')
  const color = isBill ? '#fff3cd' : '#d4edda'
  const icon = isBill ? '💰' : '⏰'

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 80,
        zIndex: 9999,
        transition: 'transform 0.5s cubic-bezier(0.4,0,0.2,1), opacity 0.5s',
        transform: `scale(${popping ? 0 : 1}) rotate(${popping ? 45 : 0}deg)`,
        opacity: popping ? 0 : 1,
      }}
    >
      {/* 말풍선 */}
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          right: 0,
          background: '#fff',
          border: `2px solid ${isBill ? '#ffc107' : '#28a745'}`,
          borderRadius: 12,
          padding: '10px 14px',
          maxWidth: 220,
          minWidth: 140,
          boxShadow: '2px 4px 16px rgba(0,0,0,0.15)',
          fontSize: '0.85rem',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          transition: 'opacity 0.4s, transform 0.4s',
          opacity: showBubble ? 1 : 0,
          transform: showBubble ? 'translateY(0)' : 'translateY(8px)',
          pointerEvents: showBubble ? 'auto' : 'none',
        }}
      >
        <div style={{ fontWeight: 'bold', marginBottom: 4 }}>{icon} {reminder.title}</div>
        <div style={{ color: '#666', fontSize: '0.8rem' }}>
          📅 {reminder.event_date.replace('T', ' ')}
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: -8,
            right: 18,
            width: 0,
            height: 0,
            borderLeft: '8px solid transparent',
            borderRight: '8px solid transparent',
            borderTop: '8px solid #fff',
          }}
        />
      </div>

      {/* 동그라미 */}
      <div
        onClick={handleClick}
        style={{
          width: 48,
          height: 48,
          borderRadius: '50%',
          background: color,
          border: `2px solid ${isBill ? '#ffc107' : '#28a745'}`,
          boxShadow: '2px 4px 12px rgba(0,0,0,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.2rem',
          position: 'relative',
          cursor: 'pointer',
        }}
      >
        {icon}
      </div>

      {/* 닫기 버튼 */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        style={{
          position: 'absolute',
          top: -6,
          right: -6,
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: '#6c757d',
          color: '#fff',
          border: 'none',
          fontSize: '0.6rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  )
}
