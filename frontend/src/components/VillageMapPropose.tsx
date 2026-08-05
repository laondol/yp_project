import { useState, useRef } from 'react'
import { api } from '../lib/api'
import type { VillagePlaceCategoryData, VillagePlaceMedia } from './VillageMapView'

interface Props {
  myeon: string
  ri: string
  categories: VillagePlaceCategoryData[]
  onDone: () => void
}

export default function VillageMapPropose({ myeon, ri, categories, onDone }: Props) {
  const [form, setForm] = useState({
    name: '', category_id: '' as string, address: '',
    open_hr: '', tel: '', website: '',
    description: '', story: '',
  })
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')
  const [media, setMedia] = useState<VillagePlaceMedia[]>([])
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    setUploading(true)
    try {
      for (const f of Array.from(files)) {
        const fd = new FormData()
        fd.append('file', f)
        const d = await api.upload<{ success: boolean; url: string; type: 'image' | 'video' }>('/api/village/map/upload', fd)
        if (d.success) {
          setMedia(prev => [...prev, { type: d.type, url: d.url }])
        }
      }
    } catch (err: any) {
      alert(err.message || '업로드 실패')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) { alert('위치를 사용할 수 없습니다.'); return }
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)) },
      () => alert('위치를 가져오지 못했습니다. 직접 좌표를 입력해 주세요.'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { alert('이름을 입력해 주세요.'); return }
    if (!lat || !lng) { alert('지도 위치를 설정해 주세요. (현재 위치 사용 버튼 클릭)'); return }
    setSubmitting(true)
    try {
      const d = await api.post<{ success: boolean; msg: string }>('/api/village/map/places', {
        myeon, ri,
        name: form.name.trim(),
        category_id: form.category_id ? Number(form.category_id) : null,
        address: form.address.trim(),
        latitude: parseFloat(lat), longitude: parseFloat(lng),
        open_hr: form.open_hr.trim(), tel: form.tel.trim(), website: form.website.trim(),
        description: form.description.trim(), story: form.story.trim(),
        media: JSON.stringify(media),
      })
      alert(d.msg || '제안이 접수되었습니다.')
      onDone()
    } catch (err: any) {
      alert(err.message || '제안 실패')
    } finally {
      setSubmitting(false)
    }
  }

  const removeMedia = (idx: number) => {
    setMedia(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <div className="card border-primary mt-2" style={{ borderRadius: 12 }}>
      <div className="card-body p-3">
        <h6 className="fw-bold mb-2">📍 장소/건물 제안하기</h6>
        <small className="text-muted d-block mb-2">
          우리 마을의 장소·건물 정보를 제안해 주세요. 마을지기의 확인 후 지도에 공개됩니다.
        </small>

        <div className="mb-2">
          <input className="form-control form-control-sm mb-1" placeholder="이름 * (예: 양평 노인복지회관)"
            value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          {categories.length > 0 && (
            <select className="form-select form-select-sm mb-1" value={form.category_id}
              onChange={e => setForm({ ...form, category_id: e.target.value })}>
              <option value="">카테고리 선택</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          )}
          <input className="form-control form-control-sm mb-1" placeholder="주소 (예: 양평읍 양근리 123)"
            value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        </div>

        <div className="mb-2">
          <div className="d-flex gap-2 align-items-center mb-1">
            <input className="form-control form-control-sm" style={{ maxWidth: 140 }} placeholder="위도"
              value={lat} onChange={e => setLat(e.target.value)} />
            <input className="form-control form-control-sm" style={{ maxWidth: 140 }} placeholder="경도"
              value={lng} onChange={e => setLng(e.target.value)} />
            <button className="btn btn-sm btn-outline-primary" onClick={useMyLocation}>📡 내 위치</button>
          </div>
        </div>

        <div className="d-flex gap-2 flex-wrap mb-2">
          <input className="form-control form-control-sm" style={{ maxWidth: 160 }} placeholder="운영시간"
            value={form.open_hr} onChange={e => setForm({ ...form, open_hr: e.target.value })} />
          <input className="form-control form-control-sm" style={{ maxWidth: 140 }} placeholder="전화"
            value={form.tel} onChange={e => setForm({ ...form, tel: e.target.value })} />
          <input className="form-control form-control-sm" style={{ flex: 1, minWidth: 160 }} placeholder="웹사이트"
            value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
        </div>

        <textarea className="form-control form-control-sm mb-1" rows={2} placeholder="소개 (이 장소가 어떤 곳인가요?)"
          value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
        <textarea className="form-control form-control-sm mb-2" rows={2} placeholder="이야기/역사 (건물의 사연, 마을 역사 등)"
          value={form.story} onChange={e => setForm({ ...form, story: e.target.value })} />

        <div className="mb-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => fileRef.current?.click()}>
            📷 사진·동영상 추가 ({media.length})
          </button>
          <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple
            style={{ display: 'none' }} onChange={handleFile} />
          {uploading && <span className="ms-2" style={{ fontSize: 12, color: '#666' }}>업로드 중...</span>}
          {media.length > 0 && (
            <div className="d-flex gap-2 flex-wrap mt-2">
              {media.map((m, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  {m.type === 'video'
                    ? <video src={m.url} controls preload="metadata" style={{ width: 90, height: 68, borderRadius: 8, objectFit: 'cover' }} />
                    : <img src={m.url} alt="" style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 8 }} />}
                  <button className="btn btn-sm py-0 px-1" style={{ position: 'absolute', top: -6, right: -6, background: '#dc3545', color: '#fff', borderRadius: '50%', fontSize: 10, lineHeight: 1 }}
                    onClick={() => removeMedia(i)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-primary" disabled={submitting || uploading} onClick={handleSubmit}>
            {submitting ? '제출 중...' : '제안하기'}
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={onDone}>취소</button>
        </div>
      </div>
    </div>
  )
}
