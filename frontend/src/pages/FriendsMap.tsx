import { useNavigate } from 'react-router-dom'
import LeafletMap from '../components/LeafletMap'

export default function FriendsMap() {
  const navigate = useNavigate()

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <button className="btn btn-sm btn-outline-secondary mb-3" onClick={() => navigate('/friends')}>← 벗관리로</button>
      <h4 className="fw-bold mb-3">벗 위치 지도</h4>
      <div className="card border-0 shadow-sm mb-3" style={{ borderRadius: 18, overflow: 'hidden' }}>
        <LeafletMap center={[37.5, 127.5]} zoom={11} style={{ height: 500 }} />
      </div>
      <div className="row g-3" id="friend-list" />
    </div>
  )
}
