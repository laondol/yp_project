/** 통벗 화자인식용 브라우저 오디오 캡처 (16kHz mono PCM 롤링 버퍼 → WAV Blob)
 * - MediaRecorder 대신 AudioContext 직접 캡처: 서버에 ffmpeg/디코더 의존 제거
 */

const SR = 16000
const BUF_SECONDS = 8 // 최근 N초 롤링 버퍼 (발화 전체 커버)

let audioCtx: AudioContext | null = null
let stream: MediaStream | null = null
let processor: ScriptProcessorNode | null = null

let ring: Float32Array | null = null
let ringPos = 0
let ringFilled = 0

export function isMicCapturing(): boolean {
  return !!stream && !!processor
}

export async function startMicCapture(): Promise<void> {
  if (isMicCapturing()) return
  const AC = window.AudioContext || (window as any).webkitAudioContext
  audioCtx = new AC({ sampleRate: SR })
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const src = audioCtx.createMediaStreamSource(stream)
  processor = audioCtx.createScriptProcessor(4096, 1, 1)
  ring = new Float32Array(SR * BUF_SECONDS)
  ringPos = 0
  ringFilled = 0
  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0)
    if (!ring) return
    for (let i = 0; i < input.length; i++) {
      ring[ringPos] = input[i]
      ringPos = (ringPos + 1) % ring.length
    }
    ringFilled = Math.min(ringFilled + input.length, ring.length)
  }
  src.connect(processor)
  processor.connect(audioCtx.destination) // 크롬 요구:.destination 연결되어야 onaudioprocess 동작
}

export function stopMicCapture(): void {
  try { processor && processor.disconnect() } catch {}
  try { stream && stream.getTracks().forEach(t => t.stop()) } catch {}
  try { audioCtx && audioCtx.close() } catch {}
  processor = null
  stream = null
  audioCtx = null
  ring = null
  ringFilled = 0
}

export function clearMicBuffer(): void {
  ringFilled = 0
  ringPos = 0
}

/** 마지막 N초를 16kHz 모노 PCM-16 WAV Blob으로 생성 */
export function buildWavBlob(lastSeconds: number = 5): Blob | null {
  if (!ring || ringFilled === 0) return null
  const need = Math.min(SR * Math.floor(lastSeconds), ringFilled)
  const out = new Float32Array(need)
  for (let i = 0; i < need; i++) {
    const idx = (ringPos - 1 - i + ring.length * 4) % ring.length
    out[need - 1 - i] = ring[idx]
  }
  return floatToWav(out, SR)
}

/** Float32 → 16bit WAV 인코딩 */
function floatToWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)) }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)  // PCM
  view.setUint16(22, 1, true)  // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([view], { type: 'audio/wav' })
}
