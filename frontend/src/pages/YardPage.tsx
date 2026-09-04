import { useEffect, useState } from 'react'
import { formatKST } from '../utils/format'

interface YardItem {
  id: string; db_id: number; kind: 'post' | 'event'
  title: string; content: string
  source_type?: string; platform?: string
  source_url?: string; author_name?: string
  event_date?: string; created_at: string
}

const platformBadge: Record<string, { label: string; cls: string }> = {
  instagram: { label: '📸 인스타그램', cls: 'bg-danger' },
  facebook: { label: '📘 페이스북', cls: 'bg-primary' },
  kakao: { label: '💛 카카오', cls: 'bg-warning text-dark' },
  event: { label: '🌾 마을행사', cls: 'bg-success' },
  manual: { label: '📢 직접 등록', cls: 'bg-secondary' },
  web: { label: '🌐 웹', cls: 'bg-info' },
}

function detailHref(it: YardItem): string {
  if (it.kind === 'event') return it.source_url || ''
  if (it.kind === 'post' && it.db_id) return `/yard/${it.db_id}`
  return it.source_url || ''
}

export default function YardPage() {
  const [items, setItems] = useState<YardItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  const load = () => {
    setLoading(true)
    fetch('/api/yard')
      .then(r => r.json())
      .then(d => setItems(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const filtered = items.filter(i =>
    filter === 'all' ? true : filter === 'event' ? i.kind === 'event' : i.kind === 'post' && i.platform === filter
  )

  return (
    <div className="container mt-4">
      <h3 className="fw-bold mb-4">🌾 마당</h3>
      <div className="alert alert-success small mb-4">
        <strong>양평 공동체의 소식 한 데 모임!</strong> 마을행사, 단체 SNS 공지, 지역 소식을 함께 모아 알려 드립니다.
        인스타그램·페이스북 공개 게시물은 상세 페이지에서 원문 그대로 볼 수 있습니다.
      </div>

      {/* 필터 */}
      <div className="d-flex gap-2 flex-wrap mb-3">
        {[
          { key: 'all', label: '전체' },
          { key: 'event', label: '🌾 마을행사' },
          { key: 'instagram', label: '📸 인스타그램' },
          { key: 'facebook', label: '📘 페이스북' },
          { key: 'kakao', label: '💛 카카오' },
          { key: 'manual', label: '📢 소식' },
        ].map(f => (
          <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-success' : 'btn-outline-success'}`}
            onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-5 text-muted"><div className="spinner-border" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <div className="fs-1 mb-3">🌾</div>
          <p>아직 등록된 소식이 없습니다.</p>
        </div>
      ) : (
        <div className="row g-3 flex-nowrap flex-sm-wrap" style={{ overflowX: 'auto', paddingBottom: 4 }}>
          {filtered.map(it => {
            const badge = platformBadge[it.platform || ''] || platformBadge.manual
            const href = detailHref(it)
            return (
              <div key={it.id} className="col-12 col-md-6 col-lg-4" style={{ minWidth: 340 }}>
                <div className="card border-0 shadow-sm h-100" style={{ borderRadius: 16, overflow: 'hidden' }}>
                  <div className="bg-light d-flex align-items-center justify-content-center" style={{ height: 120 }}>
                    <span style={{ fontSize: '2.5rem' }}>
                      {it.platform === 'instagram' ? '📸' : it.platform === 'facebook' ? '📘' : it.kind === 'event' ? '🌾' : it.platform === 'kakao' ? '💛' : '📢'}
                    </span>
                  </div>
                  <div className="card-body p-3 d-flex flex-column">
                    <div className="d-flex gap-1 flex-wrap mb-2">
                      <span className={`badge ${badge.cls}`}>{badge.label}</span>
                      {it.kind === 'event' && it.event_date && (
                        <span className="badge bg-success">📅 {it.event_date}</span>
                      )}
                    </div>
                    <h6 className="fw-bold mb-2" style={{ cursor: 'pointer' }} onClick={() => { if (href) window.location.href = href }}>
                      {it.title}
                    </h6>
                    <p className="small text-muted flex-grow-1 mb-2">{(it.content || '').substring(0, 120)}</p>
                    <div className="d-flex justify-content-between align-items-center mt-auto pt-2 border-top">
                      <small className="text-muted">👤 {it.author_name || '관리자'}</small>
                      {href && <a href={href} className="small text-primary text-decoration-none">자세히 보기 →</a>}
                    </div>
                    <div className="small text-muted mt-1">{it.created_at ? formatKST(it.created_at, { year: 'numeric', month: '2-digit', day: '2-digit' }) : ''}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
