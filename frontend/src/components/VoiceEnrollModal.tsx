import { useState, useEffect } from 'react'
import { startMicCapture, stopMicCapture, clearMicBuffer, buildWavBlob } from '../utils/voiceAudio'

const PHRASES = [
  '안녕하세요 통벗, 오늘 날씨가 참 좋네요.',
  '통벗, 내 일정을 알려줘.',
  '통벗, 양평 소식을 들려줘.',
  '통벗, 같이 산책 나갈까요?',
  '통벗, 고마워요. 내일 또 봐요.',
]

const REC_SECONDS = 5.0
const MIN_SAMPLES = 4

export interface VoiceEnrollModalProps {
  enrolled: boolean
  onClose: () => void
  onEnrolled?: () => void
  onDeleted?: () => void
}

export default function VoiceEnrollModal({ enrolled: enrolledProp, onClose, onEnrolled, onDeleted }: VoiceEnrollModalProps) {
  const [consented, setConsented] = useState(false)
  const [recordings, setRecordings] = useState<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState('')
  // 관리 모드: 테스트
  const [testResult, setTestResult] = useState<{ similarity?: number; threshold?: number; pass?: boolean } | null>(null)
  const [reEnroll, setReEnroll] = useState(false) // 등록 상태에서도 재등록 선택 가능

  const enrolled = enrolledProp && !reEnroll

  useEffect(() => {
    return () => { stopMicCapture() }
  }, [])

  const resetAll = () => {
    setRecordings([])
    setTestResult(null)
  }

  const startRecord = async (testMode = false) => {
    try {
      await startMicCapture()
    } catch {
      alert('마이크 권한이 필요합니다.')
      return
    }
    clearMicBuffer()
    setRecording(true)
    setRemaining(Math.ceil(REC_SECONDS))
    const started = Date.now()
    const timer = window.setInterval(() => {
      const left = REC_SECONDS - (Date.now() - started) / 1000
      setRemaining(Math.max(0, Math.ceil(left)))
      if (left <= 0) {
        window.clearInterval(timer)
        const blob = buildWavBlob(REC_SECONDS + 0.5)
        setRecording(false)
        if (!blob || blob.size <= 44) {
          alert('녹음이 잡히지 않았습니다. 다시 시도해 주세요.')
          return
        }
        if (testMode) {
          // 테스트: 업로드해서 유사도 표시
          uploadTest(blob)
        } else {
          setRecordings(prev => [...prev, blob])
        }
      }
    }, 100)
  }

  const uploadTest = async (blob: Blob) => {
    try {
      setTestResult({ }) // 측정 중
      const fd = new FormData()
      fd.append('audio', blob, 'test.wav')
      const res = await fetch('/api/bot/voice-check', { method: 'POST', body: fd, credentials: 'include' })
      const d = await res.json()
      setTestResult({ similarity: d.similarity, threshold: d.threshold, pass: !d.enabled ? undefined : !!d.match })
    } catch {
      setTestResult(null)
      alert('테스트(Server) 연결 실패')
    }
  }

  const save = async () => {
    if (recordings.length < MIN_SAMPLES || uploading) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('consent', 'y')
      recordings.forEach((b, i) => fd.append('audio', b, `voice_${i}.wav`))
      const res = await fetch('/api/bot/voice-enroll', { method: 'POST', body: fd, credentials: 'include' })
      const d = await res.json()
      if (d.success) {
        setResult(d.msg || '등록되었습니다.')
        if (onEnrolled) onEnrolled()
        window.setTimeout(() => { resetAll(); onClose() }, 1200)
      } else {
        alert(d.error || '등록 실패')
      }
    } catch {
      alert('서버 연결 실패')
    }
    setUploading(false)
  }

  const removeEnroll = async () => {
    if (!confirm('등록된 목소리를 삭제할까요? 삭제하면 누구의 목소리든 인식됩니다.')) return
    try {
      const fd = new FormData()
      fd.append('consent', 'y')
      fd.append('remove', 'y')
      const res = await fetch('/api/bot/voice-enroll', { method: 'POST', body: fd, credentials: 'include' })
      const d = await res.json()
      if (d.success) {
        if (onDeleted) onDeleted()
        alert(d.msg || '삭제되었습니다.')
        onClose()
      }
    } catch {
      alert('서버 연결 실패')
    }
  }

  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.5)', zIndex: 5000 }} onClick={onClose}>
      <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
        <div className="modal-content" style={{ borderRadius: 16 }}>
          <div className="modal-header py-2">
            <h6 className="modal-title mb-0">🎙️ 내 목소리 {enrolled ? '관리' : '등록'}</h6>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {enrolled && !result ? (
              <>
                <div className="alert alert-success small" style={{ borderRadius: 10 }}>
                  📚 등록 완료 상태 — 통벗은 본인 음성만 인식합니다.
                </div>
                {/* 성문 테스트 */}
                <div className="text-center border rounded p-3 mb-2">
                  <div className="small text-muted mb-2">자유롭게 말씀해 보세요 — 유사도와 본인 기준선을 비교해 표시합니다.</div>
                  {recording ? (
                    <div className="text-danger fw-bold">🔴 듣는 중... ({remaining}초)</div>
                  ) : (
                    <button className="btn btn-outline-success btn-sm" onClick={() => startRecord(true)}>
                      🎤 목소리 테스트 (5초)
                    </button>
                  )}
                  {testResult && testResult.similarity != null && (
                    <div className={`mt-2 fw-bold ${testResult.pass ? 'text-success' : 'text-danger'}`}>
                      유사도 {testResult.similarity.toFixed(3)} / 기준선 {testResult.threshold != null ? testResult.threshold.toFixed(3) : '0.72'} — {testResult.pass ? '✅ 본인으로 인식됨' : '❌ 다른 사람으로 판정'}
                    </div>
                  )}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-outline-primary" onClick={() => { resetAll(); setReEnroll(true) }}>
                    🔁 다시 등록 (정확도 개선)
                  </button>
                  <button className="btn btn-sm btn-outline-danger ms-auto" onClick={removeEnroll}>
                    🗑 등록 삭제
                  </button>
                </div>
              </>
            ) : (
              <>
                {!consented && !result ? (
                  <div className="alert alert-warning small" style={{ borderRadius: 10 }}>
                    <strong>🔊 음성 등록 동의</strong><br />
                    본인 확인용 성문(목소리의 수치적 특징)만 서버에 저장됩니다. 원본 녹음은 저장하지 않으며,
                    언제든 삭제할 수 있습니다. 등록한 목소리는 통벗 채팅에서 본인 음성만 인식하는 용도로만 사용됩니다.<br />
                    <div className="form-check mt-2">
                      <input className="form-check-input" type="checkbox" id="voiceConsent" checked={consented}
                        onChange={e => setConsented(e.target.checked)} />
                      <label className="form-check-label small" htmlFor="voiceConsent">위 내용에 동의하고 등록합니다.</label>
                    </div>
                    {enrolledProp && <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setReEnroll(false)}>취소</button>}
                  </div>
                ) : result ? (
                  <div className="alert alert-success small" style={{ borderRadius: 10 }}>{result}</div>
                ) : (
                  <>
                    <div className="small text-muted mb-2">
                      정확도 향상을 위해 5문장을 읽어주세요. (녹음 {REC_SECONDS}초씩, 최소 {MIN_SAMPLES}개 유효 — 이 기준선이 낮은 환경도 자동 보정됩니다)
                    </div>
                    {recordings.length < PHRASES.length ? (
                      <div className="text-center py-3 border rounded mb-2">
                        <div className="fw-bold mb-2" style={{ fontSize: '1.05rem' }}>"{PHRASES[recordings.length]}"</div>
                        {recording ? (
                          <div className="text-danger fw-bold">🔴 녹음 중... ({remaining}초)</div>
                        ) : (
                          <button className="btn btn-success" onClick={() => startRecord(false)}>
                            녹음하기 ({recordings.length + 1}/{PHRASES.length})
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-2 mb-2">
                        <div className="text-success fw-bold mb-2">✅ 녹음 {recordings.length}건 완료</div>
                        <button className="btn btn-success w-100 py-2 fw-bold" onClick={save} disabled={uploading}>
                          {uploading ? '등록 중...' : '내 목소리 등록'}
                        </button>
                      </div>
                    )}
                    <div className="d-flex gap-1 justify-content-center flex-wrap">
                      {PHRASES.map((_, i) => (
                        <span key={i} style={{
                          width: 10, height: 10, borderRadius: '50%',
                          background: i < recordings.length ? '#27ae60' : '#dee2e6',
                        }} />
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
          <div className="modal-footer py-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { onClose() }}>닫기</button>
          </div>
        </div>
      </div>
    </div>
  )
}
