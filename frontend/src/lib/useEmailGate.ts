import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

export function useEmailGate(service: 'legal' | 'psycho') {
  const { user } = useAuth()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [verified, setVerified] = useState(false)
  const [mode, setMode] = useState<'loading' | 'member' | 'verified' | 'anonymous'>('loading')
  const [verifyEmail, setVerifyEmail] = useState('')
  const [verifyMsg, setVerifyMsg] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (user && user.id) {
      setEmail(user.email || '')
      setName(user.real_name || user.username || '')
      setVerified(true)
      setMode('member')
      return
    }
    fetch('/api/auth/verify-status', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        const ok = service === 'legal' ? d.legal : d.psycho
        if (ok && d.email) {
          setEmail(d.email)
          setVerified(true)
          setMode('verified')
        } else {
          setMode('anonymous')
          setVerified(false)
        }
      })
      .catch(() => { setMode('anonymous'); setVerified(false) })
  }, [user, service])

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const sendVerify = async () => {
    if (!verifyEmail.trim()) { setVerifyMsg('이메일을 입력해 주세요.'); return }
    setVerifyLoading(true); setVerifyMsg('')
    try {
      const body = new URLSearchParams({
        email: verifyEmail.trim(),
        redirect: window.location.pathname,
        purpose: 'verify',
      })
      const res = await fetch('/register/verify-email-button', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        credentials: 'include',
        body,
      })
      const data = await res.json()
      if (data.status === 'success') {
        setVerifyMsg('인증 링크를 이메일로 발송했습니다. 메일함의 링크를 클릭해 주세요.')
        if (timerRef.current) clearInterval(timerRef.current)
        timerRef.current = window.setInterval(async () => {
          try {
            const r = await fetch('/api/auth/verify-status', { credentials: 'include' })
            const d = await r.json()
            const ok = service === 'legal' ? d.legal : d.psycho
            if (ok && d.email) {
              if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
              setEmail(d.email); setVerified(true); setMode('verified')
              setVerifyMsg('이메일 인증이 완료되었습니다.')
            }
          } catch { /* ignore */ }
        }, 3000)
      } else {
        setVerifyMsg(data.msg || '인증 메일 발송에 실패했습니다.')
      }
    } catch { setVerifyMsg('오류가 발생했습니다.') }
    finally { setVerifyLoading(false) }
  }

  return { email, setEmail, name, setName, verified, mode, verifyEmail, setVerifyEmail, sendVerify, verifyMsg, verifyLoading }
}
