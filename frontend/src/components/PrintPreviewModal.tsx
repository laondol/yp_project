import { useRef, useState, useEffect, useLayoutEffect } from 'react'
import { toPng } from 'html-to-image'

interface PrintData {
  title: string
  category: string
  date: string
  address: string
  content: string
}

interface Props {
  onClose: () => void
  data: PrintData
}

type Paper = { key: string; label: string; w: number; h: number; sns?: boolean }

const PAPERS: Paper[] = [
  { key: 'A4 portrait', label: 'A4 세로', w: 794, h: 1123 },
  { key: 'A4 landscape', label: 'A4 가로', w: 1123, h: 794 },
  { key: 'A5 portrait', label: 'A5 세로', w: 559, h: 794 },
  { key: 'A5 landscape', label: 'A5 가로', w: 794, h: 559 },
  { key: 'B5 portrait', label: 'B5 세로', w: 665, h: 945 },
  { key: 'Letter portrait', label: 'Letter 세로', w: 816, h: 1056 },
  { key: 'sns-ig-45', label: '인스타 세로 4:5 (1080×1350)', w: 1080, h: 1350, sns: true },
  { key: 'sns-ig-sq', label: '인스타 정사각 (1080×1080)', w: 1080, h: 1080, sns: true },
  { key: 'sns-fb', label: '페이스북 카드 (1200×630)', w: 1200, h: 630, sns: true },
  { key: 'sns-story', label: '세로 스크롤·릴스 (1080×1920)', w: 1080, h: 1920, sns: true },
]

const safeName = (s: string) => (s || 'note').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export default function PrintPreviewModal({ onClose, data }: Props) {
  const [paperIdx, setPaperIdx] = useState(0)
  const [scale, setScale] = useState(0.5)
  const [busy, setBusy] = useState('')
  const [hint, setHint] = useState('')
  const paperRef = useRef<HTMLDivElement>(null)
  const [paperH, setPaperH] = useState<number>(PAPERS[0].h)
  const paper = PAPERS[paperIdx]

  // 용지 크기 → @page 규칙
  useEffect(() => {
    let el = document.getElementById('page-size-style') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'page-size-style'
      document.head.appendChild(el)
    }
    el.textContent = paper.sns
      ? `@page { size: ${paper.w}px ${paper.h}px; margin: 0; }`
      : `@page { size: ${paper.key}; margin: 10mm; }`
  }, [paper])

  // 미리보기 스케일 (영역 폭/높이에 맞춤) + 실제 종이 높이 측정
  useLayoutEffect(() => {
    const fitW = Math.min(560, window.innerWidth - 80)
    const fitH = window.innerHeight * 0.5
    const s = Math.min(fitW / paper.w, fitH / paper.h, 1)
    setScale(s)
    if (paperRef.current) setPaperH(paperRef.current.offsetHeight)
  }, [paper, data])

  // 본문 이미지가 종이 폭을 넘지 않도록
  useEffect(() => {
    const styleId = 'print-paper-img-style'
    let el = document.getElementById(styleId) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = styleId
      document.head.appendChild(el)
    }
    el.textContent = '.print-paper img { max-width: 100%; height: auto; }'
  }, [])

  const doPrint = () => {
    const body = document.body
    body.classList.add('print-from-modal')
    let done = false
    const cleanup = () => {
      if (done) return
      done = true
      body.classList.remove('print-from-modal')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    setTimeout(() => {
      try { window.print() } finally { setTimeout(cleanup, 500) }
    }, 80)
  }

  const savePdf = () => {
    setHint('인쇄 대화상자에서 "대상(PDF로 저장)"을 선택한 뒤 저장하세요.')
    doPrint()
  }

  const savePng = async () => {
    if (!paperRef.current || busy) return
    setBusy('png')
    setHint('')
    try {
      const url = await toPng(paperRef.current, {
        pixelRatio: paper.sns ? 1 : 2,
        backgroundColor: '#ffffff',
        style: { transform: 'none', margin: '0' },
      })
      const res = await fetch(url)
      const blob = await res.blob()
      downloadBlob(blob, safeName(data.title) + '.png')
      setHint('이미지(PNG)를 저장했습니다.')
    } catch {
      setHint('이미지 생성에 실패했습니다.')
    } finally { setBusy('') }
  }

  const saveHtml = () => {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const meta = [data.category && `분류: ${esc(data.category)}`, data.date, data.address && `📍 ${esc(data.address)}`
      ].filter(Boolean).join(' · ')
    const html = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8">
<title>${esc(data.title)}</title>
<style>
body{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;max-width:760px;margin:40px auto;padding:0 24px;line-height:1.85;color:#222}
h1{font-size:24px;margin:0 0 6px}
.meta{color:#666;font-size:13px;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:18px}
img{max-width:100%;height:auto}
</style></head>
<body><h1>${esc(data.title)}</h1>
<div class="meta">${meta}</div>
${data.content}
</body></html>`
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), safeName(data.title) + '.html')
    setHint('HTML 파일을 저장했습니다.')
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 1060, overflow: 'auto' }}
      onClick={onClose}>
      <div className="bg-white mx-auto my-4 p-4" style={{ maxWidth: 720, borderRadius: 16, zIndex: 1061 }}
        onClick={e => e.stopPropagation()}>

        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex align-items-center gap-2">
            <b>🖨 출력 미리보기</b>
            <select className="form-select form-select-sm" style={{ maxWidth: 250 }}
              value={paperIdx} onChange={e => setPaperIdx(Number(e.target.value))}>
              <optgroup label="인쇄 용지">
                {PAPERS.map((p, i) => !p.sns && <option key={p.key} value={i}>{p.label}</option>)}
              </optgroup>
              <optgroup label="SNS 이미지">
                {PAPERS.map((p, i) => p.sns && <option key={p.key} value={i}>{p.label}</option>)}
              </optgroup>
            </select>
          </div>
          <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>✕ 닫기</button>
        </div>

        {/* 종이 미리보기 */}
        <div className="d-flex justify-content-center mb-3" style={{ background: '#f1f3f5', borderRadius: 10, padding: 16, overflow: 'auto' }}>
          <div style={{ width: paper.w * scale, height: paperH * scale, flexShrink: 0 }}>
            <div
              ref={paperRef}
              className="print-paper bg-white"
              style={{
                width: paper.w,
                minHeight: paper.h,
                padding: paper.sns ? '56px 64px' : '48px 52px',
                boxSizing: 'border-box',
                boxShadow: '0 2px 12px rgba(0,0,0,.18)',
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}>
              <div style={{ borderBottom: '2px solid #333', paddingBottom: 10, marginBottom: 18 }}>
                <h1 style={{ fontSize: 22, margin: '0 0 6px', fontWeight: 700 }}>{data.title}</h1>
                <div style={{ fontSize: 12, color: '#666' }}>
                  {[data.category && `분류: ${data.category}`, data.date, data.address && `📍 ${data.address}`]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ lineHeight: 1.85, fontSize: 15, wordBreak: 'break-word' }}
                dangerouslySetInnerHTML={{ __html: data.content }} />
            </div>
          </div>
        </div>

        {hint && <div className="alert alert-info py-2 small mb-3">{hint}</div>}

        <div className="d-flex gap-2 flex-wrap justify-content-center">
          <button className="btn btn-success fw-bold px-4" onClick={doPrint}>🖨 인쇄</button>
          <button className="btn btn-outline-primary fw-bold px-4" onClick={savePdf}> PDF로 저장</button>
          <button className="btn btn-outline-success fw-bold px-4" onClick={savePng} disabled={!!busy}>
            {busy === 'png' ? '생성 중...' : '🖼 이미지(PNG)'}
          </button>
          <button className="btn btn-outline-secondary fw-bold px-4" onClick={saveHtml}>📄 HTML 저장</button>
          <button className="btn btn-outline-secondary px-4" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  )
}
