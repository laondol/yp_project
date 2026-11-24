import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 브라우저 음성인식 (Web Speech API)
 * - Chrome / Edge / Android Chrome 지원
 * - ko-KR, 연속 인식, 실시간(interim) 결과 제공
 */
export default function useSpeech(onFinal: (text: string) => void) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const recRef = useRef<any>(null)
  const finalRef = useRef(onFinal)
  finalRef.current = onFinal

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
    return () => {
      try { recRef.current?.stop() } catch {}
    }
  }, [])

  const stop = useCallback(() => {
    try { recRef.current?.stop() } catch {}
    recRef.current = null
    setListening(false)
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setError('이 브라우저는 음성인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.')
      return
    }
    try { recRef.current?.stop() } catch {}

    const rec = new SR()
    rec.lang = 'ko-KR'
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const txt = r[0]?.transcript || ''
        if (r.isFinal) finalText += txt
        else interimText += txt
      }
      if (finalText) finalRef.current(finalText)
      setInterim(interimText)
    }

    rec.onerror = (e: any) => {
      const code = e?.error || ''
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('마이크 권한이 거부되었습니다. 브라우저 주소창의 마이크 권한을 허용해 주세요.')
      } else if (code === 'no-speech') {
        setError('음성이 감지되지 않았습니다. 다시 말씀해 주세요.')
      } else if (code === 'network') {
        setError('음성인식 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.')
      } else {
        setError('음성인식 오류가 발생했습니다. 다시 시도해 주세요.')
      }
      setListening(false)
      setInterim('')
    }

    rec.onend = () => {
      setListening(false)
      setInterim('')
    }

    recRef.current = rec
    try {
      rec.start()
      setListening(true)
      setError('')
    } catch {
      setError('음성인식을 시작할 수 없습니다.')
    }
  }, [])

  return { supported, listening, interim, error, start, stop, clearError: () => setError('') }
}
