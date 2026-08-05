import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import Loading from '../components/common/Loading'
import VillageMapView from '../components/VillageMapView'
import VillageMapPropose from '../components/VillageMapPropose'
import { api } from '../lib/api'
import type { VillagePlaceCategoryData } from '../components/VillageMapView'
import { useAuth } from '../contexts/AuthContext'

interface PageData {
  id: number
  myeon: string
  ri: string
  title: string
  content: string
  visibility: string
  created_at?: string
}

export default function VillagePageView() {
  const { tmyeon, tri } = useParams<{ tmyeon: string; tri: string }>()
  const { user } = useAuth()
  const [page, setPage] = useState<PageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [categories, setCategories] = useState<VillagePlaceCategoryData[]>([])
  const [showPropose, setShowPropose] = useState(false)
  const [mapRefresh, setMapRefresh] = useState(0)

  useEffect(() => {
    if (!tmyeon || !tri) return
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/village/page?myeon=${encodeURIComponent(tmyeon)}&ri=${encodeURIComponent(tri)}`)
        if (!res.ok) {
          if (res.status === 404) throw new Error('페이지를 찾을 수 없습니다.')
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()
        setPage(data)
        try {
          const catD = await api.get<{ categories: VillagePlaceCategoryData[] }>('/api/village/map/categories', { myeon: tmyeon, ri: tri })
          setCategories(catD.categories || [])
        } catch { setCategories([]) }
      } catch (e: unknown) {
        // 페이지 레코드가 없어도 지도는 표시한다 (catch로 삼키지 않고 page=null 유지)
        setPage(null)
      } finally { setLoading(false) }
    }
    load()
  }, [tmyeon, tri])

  if (loading) return <Loading />
  const villageTitle = page?.title || `${tri} 마을`

  return (
    <div className="container py-4" style={{ maxWidth: 900 }}>
      {page ? (
        <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
          <div className="card-body p-4">
            <h4 className="fw-bold mb-3">{page.title}</h4>
            <div className="mb-3 small text-muted">
              {page.myeon} {page.ri} | {page.created_at ? new Date(page.created_at).toLocaleDateString('ko-KR') : ''}
            </div>
            <hr />
            <div className="village-content" dangerouslySetInnerHTML={{ __html: page.content }} />
          </div>
        </div>
      ) : (
        <div className="card border-0 shadow-sm" style={{ borderRadius: 16 }}>
          <div className="card-body p-4">
            <h4 className="fw-bold mb-0">{villageTitle}</h4>
            <div className="mb-1 small text-muted">{tmyeon} {tri}</div>
            <hr />
            <p className="text-muted small mb-0">아직 홍보 페이지가 작성되지 않았습니다. 아래 마을 지도는 바로 이용할 수 있습니다.</p>
          </div>
        </div>
      )}

      <div className="card border-0 shadow-sm mt-3" style={{ borderRadius: 16 }}>
        <div className="card-body p-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h6 className="fw-bold mb-0">🗺️ 마을 지도</h6>
            {user && (
              <button className="btn btn-sm btn-outline-primary" onClick={() => setShowPropose(v => !v)}>
                {showPropose ? '닫기' : '+ 장소 제안'}
              </button>
            )}
          </div>
          {showPropose && (
            <VillageMapPropose myeon={page?.myeon || tmyeon || ''} ri={page?.ri || tri || ''} categories={categories}
              onDone={() => { setShowPropose(false); setMapRefresh(v => v + 1) }} />
          )}
          <div className="mt-2">
            <VillageMapView key={mapRefresh} myeon={page?.myeon || tmyeon || ''} ri={page?.ri || tri || ''} />
          </div>
        </div>
      </div>
    </div>
  )
}
