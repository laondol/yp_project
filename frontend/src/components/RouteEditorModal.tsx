import { useEffect, useMemo, useRef, useState } from 'react'
import type { PlanLike, RouteChain, RouteNode, RouteOption } from '../lib/routeChain'
import {
  buildChain,
  chainForOption,
  chainToSteps,
  computeTimes,
  formatClock,
  formatDuration,
  formatHM,
  legDuration,
  moveNode,
  narrativeOf,
  needsRecalc,
  placeLabel,
  samePlace,
  optionSummary,
  parseHM,
  placeholderLeg,
  removeNode,
  replaceLegWithSteps,
  replaceNode,
  insertNodeBetween,
} from '../lib/routeChain'

interface ScheduleProp {
  id: number | string
  title?: string
  location?: string
  return_location?: string
  departure_location?: string
  event_date?: string
  end_date?: string
  content?: string
  kind?: string
}

interface Props {
  schedule: ScheduleProp | null
  targetArrival?: string
  onClose: () => void
  onSaved: () => void
}

type RouteLegLike = RouteChain['legs'][number]

interface RoutePref {
  walk_max_min: number
  bike_enabled: boolean
  bike_brands: string[]
  mode_order: string[]
}

interface BikeBrand {
  id: string
  name: string
  region: string
  available: boolean
  operator?: string
  homepage?: string
  app?: string
  fee?: string
  note?: string
}

const ORDERABLE = ['버스', '지하철', '택시', '기차', '자전거']

interface PlaceResult {
  name: string
  address?: string
  lat?: number
  lng?: number
  category?: string
}

interface LineStop {
  name: string
  time_min?: number
  lat?: number
  lng?: number
}

interface LineMapData {
  mode: string
  line: string
  from: string
  to: string
  stops: LineStop[]
  time_min?: number
  station_count?: number
  source?: string
  note?: string
  cached?: boolean
}

interface LineMapState {
  loading: boolean
  error: string
  data: LineMapData | null
  board: number
  alight: number
}

const MODES = ['🚶 도보', '🚌 버스', '🚄 지하철', '🚄 기차', '🚕 택시', '🚲 자전거']

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : undefined
}

function timeOf(iso?: string): string {
  return iso && iso.length >= 16 ? iso.slice(11, 16) : ''
}

function parsePlan(content?: string): PlanLike | null {
  try {
    const p = JSON.parse(content || 'null')
    return p && typeof p === 'object' ? p : null
  } catch {
    return null
  }
}

function violationsOf(o: RouteOption): string[] {
  const v = (o as Record<string, unknown>).violations
  return Array.isArray(v) ? v.map(String) : []
}

function sourceBadge(src?: string): { text: string; cls: string } {
  const s = String(src || '')
  if (s === 'actual') return { text: '내 기록', cls: 'bg-primary' }
  if (s === 'walk') return { text: '도보', cls: 'bg-secondary' }
  if (s === 'taxi') return { text: '택시', cls: 'bg-warning text-dark' }
  if (s.startsWith('odsay') || ['seoul', 'yp_bus', 'train', 'yp_graph', 'transit', 'cache', 'estimate'].includes(s)) {
    return { text: '대중교통', cls: 'bg-success' }
  }
  return { text: '기타', cls: 'bg-secondary' }
}

export default function RouteEditorModal({ schedule, targetArrival, onClose, onSaved }: Props) {
  const plan = useMemo(() => parsePlan(schedule?.content), [schedule?.content])

  const [origin, setOrigin] = useState<RouteNode>({ name: '출발지' })
  const [destination, setDestination] = useState<RouteNode>({ name: '도착지' })
  const [stage, setStage] = useState<'select' | 'edit'>('select')
  const [candidates, setCandidates] = useState<RouteOption[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [chain, setChain] = useState<RouteChain | null>(null)
  const [departure, setDeparture] = useState('09:00')
  const [target, setTarget] = useState('')
  const [banner, setBanner] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [activeNode, setActiveNode] = useState<number | null>(null)
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<PlaceResult[]>([])
  const [placeLoading, setPlaceLoading] = useState(false)
  const [placeError, setPlaceError] = useState('')
  const [pendingPlace, setPendingPlace] = useState<RouteNode | null>(null)
  const [prevOptions, setPrevOptions] = useState<RouteOption[]>([])
  const [nextOptions, setNextOptions] = useState<RouteOption[]>([])
  const [selectedPrev, setSelectedPrev] = useState<RouteOption | null>(null)
  const [selectedNext, setSelectedNext] = useState<RouteOption | null>(null)
  const [adjLoading, setAdjLoading] = useState(false)
  const [adjError, setAdjError] = useState('')

  const [activeLeg, setActiveLeg] = useState<number | null>(null)
  const [legOptions, setLegOptions] = useState<RouteOption[]>([])
  const [legLoading, setLegLoading] = useState(false)
  const [legError, setLegError] = useState('')
  const [lineMap, setLineMap] = useState<LineMapState | null>(null)
  const lineMapRef = useRef<HTMLDivElement>(null)
  const [manualMode, setManualMode] = useState(MODES[0])
  const [manualTime, setManualTime] = useState(0)
  const [manualDetail, setManualDetail] = useState('')
  const [editFrom, setEditFrom] = useState('')
  const [editTo, setEditTo] = useState('')
  const [endpointBusy, setEndpointBusy] = useState(false)

  const [pref, setPref] = useState<RoutePref>({ walk_max_min: 10, bike_enabled: false, bike_brands: [], mode_order: ['버스', '지하철', '택시'] })
  const [showPref, setShowPref] = useState(false)
  const [walkDraft, setWalkDraft] = useState(10)
  const [bikeDraft, setBikeDraft] = useState(false)
  const [brandDraft, setBrandDraft] = useState<string[]>([])
  const [orderDraft, setOrderDraft] = useState<string[]>(['버스', '지하철', '택시'])
  const [brands, setBrands] = useState<BikeBrand[]>([])
  const [bikeStatus, setBikeStatus] = useState<{ available: boolean; stations: number; reason: string } | null>(null)
  const [prefSaving, setPrefSaving] = useState(false)
  const [prefSaved, setPrefSaved] = useState('')
  const [originEdit, setOriginEdit] = useState('')
  const [destEdit, setDestEdit] = useState('')
  const [endpointOpen, setEndpointOpen] = useState<'origin' | 'dest' | null>(null)
  const [nearStops, setNearStops] = useState<any[]>([])
  const [nearBusy, setNearBusy] = useState(false)

  const [addAfter, setAddAfter] = useState<number | null>(null)
  const [addQuery, setAddQuery] = useState('')
  const [addResults, setAddResults] = useState<PlaceResult[]>([])
  const [addLoading, setAddLoading] = useState(false)

  const times = chain ? computeTimes(chain, departure) : null
  const targetMin = parseHM(target)
  const lateMin = times && targetMin !== null ? times.arrivalMin - targetMin : 0

  function endpointsOf(s: ScheduleProp, p: PlanLike | null): { origin: RouteNode; destination: RouteNode } {
    const steps = p?.steps || []
    const o: RouteNode = {
      name: s.departure_location || String(steps[0]?.from || '') || '출발지',
      lat: num(p?.from_lat), lng: num(p?.from_lng),
    }
    const d: RouteNode = {
      name: s.return_location || s.location || String(steps[steps.length - 1]?.to || '') || '도착지',
      lat: num(p?.to_lat), lng: num(p?.to_lng),
    }
    return { origin: o, destination: d }
  }

  async function geocode(q: string): Promise<RouteNode | null> {
    const name = (q || '').trim()
    if (!name) return null
    try {
      const r = await fetch(`/api/geocode?q=${encodeURIComponent(name)}`, { credentials: 'include' }).then(x => x.json())
      const lat = num(r?.lat)
      const lng = num(r?.lng)
      if (lat !== undefined && lng !== undefined) {
        return { name: r?.address || name, lat, lng }
      }
    } catch {
      // ignore
    }
    return null
  }

  async function searchPlaces(q: string, setter: (items: PlaceResult[]) => void, setBusy: (v: boolean) => void) {
    setBusy(true)
    try {
      const params = new URLSearchParams()
      params.set('q', q || '')
      if (origin.lat !== undefined && origin.lng !== undefined) {
        params.set('lat', String(origin.lat))
        params.set('lng', String(origin.lng))
      }
      const d = await fetch(`/api/bot/place/search?${params.toString()}`, { credentials: 'include' }).then(r => r.json())
      if (d?.error) {
        setter([])
      } else {
        setter((d?.items || []).map((it: PlaceResult) => ({
          ...it,
          lat: num(it.lat),
          lng: num(it.lng),
        })))
      }
    } catch {
      setter([])
    } finally {
      setBusy(false)
    }
  }

  async function loadCandidates(s: ScheduleProp, o: RouteNode, d: RouteNode, p: PlanLike | null) {
    setLoading(true)
    setLoadError('')
    let oo = { ...o }
    let dd = { ...d }
    if (oo.lat === undefined && oo.name) {
      const g = await geocode(oo.name)
      if (g) oo = { ...oo, lat: g.lat, lng: g.lng }
    }
    if (dd.lat === undefined && dd.name) {
      const g = await geocode(dd.name)
      if (g) dd = { ...dd, lat: g.lat, lng: g.lng }
    }
    setOrigin(oo)
    setDestination(dd)
    setChain(buildChain(p, oo, dd))

    if (oo.lat === undefined || oo.lng === undefined || dd.lat === undefined || dd.lng === undefined) {
      setCandidates([])
      setLoadError('출발지·도착지 좌표를 찾지 못했습니다. 현재 경로로 직접 편집할 수 있습니다.')
      setLoading(false)
      return
    }

    try {
      const arrival = targetArrival || p?.arrival || timeOf(s.end_date) || timeOf(s.event_date) || '09:00'
      const r = await fetch('/api/bot/route/segment-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          from_name: oo.name, from_lat: oo.lat, from_lng: oo.lng,
          to_name: dd.name, to_lat: dd.lat, to_lng: dd.lng,
          arrival,
          date: (s.event_date || '').slice(0, 10),
        }),
      }).then(x => x.json())
      if (r?.error) {
        setLoadError(r.error)
        setCandidates([])
      } else {
        setCandidates(Array.isArray(r?.items) ? r.items : [])
        if (!(r?.items || []).length) setLoadError('경로 후보를 찾지 못했습니다. 직접 편집할 수 있습니다.')
      }
    } catch {
      setLoadError('경로 후보를 불러오지 못했습니다. 직접 편집할 수 있습니다.')
      setCandidates([])
    } finally {
      setLoading(false)
    }
  }

  async function loadPrefs() {
    try {
      const d = await fetch('/api/bot/route/preferences', { credentials: 'include' }).then(r => r.json())
      const pf = d?.pref
      if (pf) {
        setPref(pf)
        setWalkDraft(Number(pf.walk_max_min) || 10)
        setBikeDraft(!!pf.bike_enabled)
        setBrandDraft(Array.isArray(pf.bike_brands) ? pf.bike_brands : [])
        setOrderDraft(Array.isArray(pf.mode_order) && pf.mode_order.length ? pf.mode_order : ['버스', '지하철', '택시'])
      }
    } catch {
      // ignore
    }
  }

  async function loadBikeInfo() {
    try {
      const d = await fetch('/api/bot/bike/near', { credentials: 'include' }).then(r => r.json())
      setBrands(Array.isArray(d?.brands) ? d.brands : [])
      setBikeStatus(d?.status || null)
    } catch {
      // ignore
    }
  }

  async function savePrefs() {
    setPrefSaving(true)
    setPrefSaved('')
    try {
      const res = await fetch('/api/bot/route/preferences', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          walk_max_min: Number(walkDraft) || 10,
          bike_enabled: bikeDraft,
          bike_brands: brandDraft,
          mode_order: orderDraft,
        }),
      }).then(r => r.json())
      if (res?.pref) {
        setPref(res.pref)
        setPrefSaved('설정을 저장했습니다. 후보를 다시 불러옵니다.')
        if (schedule) {
          const p = parsePlan(schedule.content)
          void loadCandidates(schedule, origin, destination, p)
        }
      } else {
        setPrefSaved('설정 저장에 실패했습니다.')
      }
    } catch {
      setPrefSaved('설정 저장에 실패했습니다.')
    } finally {
      setPrefSaving(false)
    }
  }

  function toggleOrder(mode: string) {
    setOrderDraft(prev => prev.includes(mode) ? prev.filter(m => m !== mode) : [...prev, mode])
  }

  function moveOrder(mode: string, dir: -1 | 1) {
    setOrderDraft(prev => {
      const i = prev.indexOf(mode)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      next[i] = next[j]
      next[j] = mode
      return next
    })
  }

  useEffect(() => {
    void loadPrefs()
    void loadBikeInfo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.id])

  useEffect(() => {
    if (!schedule) return
    const p = parsePlan(schedule.content)
    const ends = endpointsOf(schedule, p)
    setStage('select')
    setCandidates([])
    setLoadError('')
    setBanner('')
    setSaveError('')
    setActiveNode(null)
    setActiveLeg(null)
    setLineMap(null)
    setAddAfter(null)
    setPendingPlace(null)
    setPrevOptions([])
    setNextOptions([])
    setSelectedPrev(null)
    setSelectedNext(null)
    setTarget(targetArrival || p?.arrival || timeOf(schedule.end_date) || '')
    setDeparture(p?.departure || timeOf(schedule.event_date) || '09:00')
    setOrigin(ends.origin)
    setDestination(ends.destination)
    setChain(buildChain(p, ends.origin, ends.destination))
    void loadCandidates(schedule, ends.origin, ends.destination, p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.id])

  useEffect(() => {
    if (activeNode === null) return
    setPlaceLoading(true)
    void searchPlaces('', setPlaceResults, setPlaceLoading)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNode])

  useEffect(() => {
    if (activeLeg === null) return
    void loadLegOptions(activeLeg)
    void loadNearStops(activeLeg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLeg])

  async function loadNearStops(i: number) {
    if (!chain) return
    const leg = chain.legs[i]
    if (!leg) return
    let lat = leg.from_lat
    let lng = leg.from_lng
    if (lat === undefined || lng === undefined) {
      const g = await geocode(leg.from)
      lat = g?.lat
      lng = g?.lng
    }
    if (lat === undefined || lng === undefined) {
      setNearStops([])
      return
    }
    setNearBusy(true)
    try {
      const d = await fetch(`/api/bot/bus/near?lat=${lat}&lng=${lng}&radius=900&limit=3`,
        { credentials: 'include' }).then(r => r.json())
      setNearStops(Array.isArray(d?.stops) ? d.stops : [])
    } catch {
      setNearStops([])
    } finally {
      setNearBusy(false)
    }
  }

  useEffect(() => {
    if (lineMap?.data) lineMapRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [lineMap?.data])

  function selectOption(opt: RouteOption) {
    const c = chainForOption(opt, origin, destination)
    setChain(c)
    if (opt.departure) setDeparture(String(opt.departure).slice(0, 5))
    setStage('edit')
    setBanner('')
  }

  function directEdit() {
    if (plan?.steps?.length) {
      setChain(buildChain(plan, origin, destination))
    } else {
      setChain({ origin, destination, legs: [] })
    }
    setStage('edit')
    setBanner('')
  }

  function openNode(k: number) {
    if (!chain) return
    const prev = chain.legs[k - 1]
    const next = chain.legs[k]
    const nodeName = prev?.to || ''
    const currentPlace: RouteNode = {
      name: nodeName,
      lat: prev?.to_lat ?? next?.from_lat,
      lng: prev?.to_lng ?? next?.from_lng,
    }
    setActiveNode(k)
    setActiveLeg(null)
    setLineMap(null)
    setAddAfter(null)
    setPlaceQuery(nodeName)
    setPlaceResults([])
    setPlaceError('')
    setPendingPlace(currentPlace)
    setPrevOptions([])
    setNextOptions([])
    setSelectedPrev(null)
    setSelectedNext(null)
    setAdjError('')
    // 장소를 바꾸지 않아도 현재 앞/뒤 구간의 대안을 바로 볼 수 있게 한다.
    void loadAdjacent(chain, k, currentPlace)
  }

  async function choosePlace(it: PlaceResult) {
    let place: RouteNode = { name: it.name, lat: num(it.lat), lng: num(it.lng) }
    if (place.lat === undefined || place.lng === undefined) {
      const g = await geocode(place.name)
      if (g) place = g
    }
    setPendingPlace(place)
    setSelectedPrev(null)
    setSelectedNext(null)
    if (activeNode !== null && chain) void loadAdjacent(chain, activeNode, place)
  }

  async function loadAdjacent(c: RouteChain, k: number, place: RouteNode) {
    setAdjLoading(true)
    setAdjError('')
    setPrevOptions([])
    setNextOptions([])
    setSelectedPrev(null)
    setSelectedNext(null)

    const prevLeg = c.legs[k - 1]
    const nextLeg = c.legs[k]
    if (!prevLeg || !nextLeg) {
      setAdjError('앞뒤 구간을 확인할 수 없습니다.')
      setAdjLoading(false)
      return
    }
    let from: RouteNode = { name: prevLeg.from, lat: prevLeg.from_lat, lng: prevLeg.from_lng }
    let to: RouteNode = { name: nextLeg.to, lat: nextLeg.to_lat, lng: nextLeg.to_lng }
    if (from.lat === undefined && from.name) {
      const g = await geocode(from.name)
      if (g) from = { ...from, ...g }
    }
    if (to.lat === undefined && to.name) {
      const g = await geocode(to.name)
      if (g) to = { ...to, ...g }
    }
    if (from.lat === undefined || from.lng === undefined || to.lat === undefined || to.lng === undefined || place.lat === undefined || place.lng === undefined) {
      setAdjError('좌표를 찾지 못해 앞뒤 구간을 자동 계산할 수 없습니다. 구간을 직접 입력해 주세요.')
      setAdjLoading(false)
      return
    }

    const ts = computeTimes(c, departure)
    const prevArrival = formatHM(ts.legs[k - 1]?.end ?? ts.departureMin)
    const nextArrival = formatHM(ts.legs[k]?.end ?? ts.departureMin)
    try {
      const [a, b] = await Promise.all([
        fetch('/api/bot/route/segment-options', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            from_name: from.name, from_lat: from.lat, from_lng: from.lng,
            to_name: place.name, to_lat: place.lat, to_lng: place.lng,
            arrival: prevArrival, date: (schedule?.event_date || '').slice(0, 10),
          }),
        }).then(r => r.json()).catch(() => ({})),
        fetch('/api/bot/route/segment-options', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({
            from_name: place.name, from_lat: place.lat, from_lng: place.lng,
            to_name: to.name, to_lat: to.lat, to_lng: to.lng,
            arrival: nextArrival, date: (schedule?.event_date || '').slice(0, 10),
          }),
        }).then(r => r.json()).catch(() => ({})),
      ])
      setPrevOptions(Array.isArray(a?.items) ? a.items : [])
      setNextOptions(Array.isArray(b?.items) ? b.items : [])
    } catch {
      setAdjError('앞뒤 구간 후보를 불러오지 못했습니다.')
    } finally {
      setAdjLoading(false)
    }
  }

  function adjPreview(o: RouteOption, side: 'prev' | 'next'): RouteChain | null {
    if (!chain || activeNode === null) return null
    const prev = chain.legs[activeNode - 1]
    const next = chain.legs[activeNode]
    if (!prev || !next) return null
    const place: RouteNode = {
      name: pendingPlace?.name || prev.to,
      lat: pendingPlace?.lat ?? prev.to_lat ?? next.from_lat,
      lng: pendingPlace?.lng ?? prev.to_lng ?? next.from_lng,
    }
    if (side === 'prev') {
      return buildChain(
        { steps: o.steps },
        { name: prev.from, lat: prev.from_lat, lng: prev.from_lng },
        place,
        false,
      )
    }
    return buildChain(
      { steps: o.steps },
      place,
      { name: next.to, lat: next.to_lat, lng: next.to_lng },
      false,
    )
  }

  async function applyNode() {
    if (!chain || activeNode === null) return
    const current = chain.legs[activeNode - 1]?.to
    const typed = placeQuery.trim()
    let place: RouteNode | null = null
    if (pendingPlace && (!typed || typed === pendingPlace.name)) {
      place = pendingPlace
    } else if (typed) {
      const g = await geocode(typed)
      place = g || { name: typed }
    }
    if (!place) {
      setPlaceError('장소명을 입력해 주세요.')
      return
    }
    if (place.name === current && !selectedPrev && !selectedNext) {
      setActiveNode(null)
      return
    }
    const hasCoords = place.lat !== undefined && place.lng !== undefined
    setChain(replaceNode(chain, activeNode, place, selectedPrev?.steps || null, selectedNext?.steps || null))
    setActiveNode(null)
    setPendingPlace(null)
    setBanner(hasCoords ? '' : '장소 좌표를 찾지 못했습니다. 해당 구간을 직접 입력해 주세요.')
  }

  async function openLeg(i: number) {
    if (!chain) return
    const leg = chain.legs[i]
    if (!leg) return
    setActiveNode(null)
    setAddAfter(null)
    setActiveLeg(i)
    setLineMap(null)
    setManualMode(leg.mode || MODES[0])
    setManualTime(Number(leg.time_min) || 0)
    setManualDetail(leg.detail || '')
    setEditFrom(leg.from || '')
    setEditTo(leg.to || '')
    if (leg.mode.includes('지하철')) void openLineMap(i, 'subway')
    else if (leg.mode.includes('버스')) void openLineMap(i, 'bus')
  }

  async function loadLegOptions(i: number, override?: RouteLegLike) {
    if (!chain) return
    const leg = override || chain.legs[i]
    if (!leg) return
    setLegLoading(true)
    setLegError('')
    setLegOptions([])
    let from: RouteNode = { name: leg.from, lat: leg.from_lat, lng: leg.from_lng }
    let to: RouteNode = { name: leg.to, lat: leg.to_lat, lng: leg.to_lng }
    if (from.lat === undefined && from.name) {
      const g = await geocode(from.name)
      if (g) from = { ...from, ...g }
    }
    if (to.lat === undefined && to.name) {
      const g = await geocode(to.name)
      if (g) to = { ...to, ...g }
    }
    if (from.lat === undefined || from.lng === undefined || to.lat === undefined || to.lng === undefined) {
      setLegError('좌표를 찾지 못했습니다. 아래에서 직접 입력해 주세요.')
      setLegLoading(false)
      return
    }
    const ts = computeTimes(chain, departure)
    const arrival = formatHM(ts.legs[i]?.end ?? ts.arrivalMin)
    try {
      const r = await fetch('/api/bot/route/segment-options', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({
          from_name: from.name, from_lat: from.lat, from_lng: from.lng,
          to_name: to.name, to_lat: to.lat, to_lng: to.lng,
          arrival, date: (schedule?.event_date || '').slice(0, 10),
        }),
      }).then(x => x.json())
      setLegOptions(Array.isArray(r?.items) ? r.items : [])
      if (r?.error) setLegError(r.error)
    } catch {
      setLegError('구간 후보를 불러오지 못했습니다.')
    } finally {
      setLegLoading(false)
    }
  }

  async function applyEndpoint(which: 'origin' | 'dest') {
    if (!chain) return
    const typed = (which === 'origin' ? originEdit : destEdit).trim()
    if (!typed) return
    const g = await geocode(typed)
    const node: RouteNode = g ? { name: typed, lat: g.lat, lng: g.lng } : { name: typed }
    const legs = chain.legs.map(l => ({ ...l }))
    if (legs.length) {
      if (which === 'origin') {
        legs[0] = { ...legs[0], from: node.name, from_lat: node.lat, from_lng: node.lng, needs_recalc: true }
      } else {
        const last = legs.length - 1
        legs[last] = { ...legs[last], to: node.name, to_lat: node.lat, to_lng: node.lng, needs_recalc: true }
      }
    }
    const nextChain: RouteChain = which === 'origin'
      ? { ...chain, origin: node, legs }
      : { ...chain, destination: node, legs }
    setChain(nextChain)
    if (which === 'origin') setOrigin(node)
    else setDestination(node)
    setEndpointOpen(null)
    setBanner(g ? '출발/도착 장소를 변경했습니다. 구간을 눌러 경로를 다시 선택하세요.'
      : '좌표를 찾지 못했습니다. 구간을 직접 입력해 주세요.')
  }

  async function applyLegEndpoints() {
    if (!chain || activeLeg === null) return
    const leg = chain.legs[activeLeg]
    if (!leg) return
    const fromName = editFrom.trim() || leg.from
    const toName = editTo.trim() || leg.to
    if (!fromName || !toName) return
    setEndpointBusy(true)
    try {
      let from = { name: fromName, lat: leg.from_lat, lng: leg.from_lng }
      if (!samePlace(fromName, leg.from) || from.lat === undefined || from.lng === undefined) {
        const g = await geocode(fromName)
        from = { name: fromName, lat: g?.lat, lng: g?.lng }
      }
      let to = { name: toName, lat: leg.to_lat, lng: leg.to_lng }
      if (!samePlace(toName, leg.to) || to.lat === undefined || to.lng === undefined) {
        const g = await geocode(toName)
        to = { name: toName, lat: g?.lat, lng: g?.lng }
      }
      const legs = chain.legs.map(l => ({ ...l }))
      legs[activeLeg] = {
        ...legs[activeLeg],
        from: from.name, from_lat: from.lat, from_lng: from.lng,
        to: to.name, to_lat: to.lat, to_lng: to.lng,
        needs_recalc: true,
      }
      if (activeLeg > 0) {
        legs[activeLeg - 1] = {
          ...legs[activeLeg - 1],
          to: from.name, to_lat: from.lat, to_lng: from.lng,
        }
      }
      if (activeLeg < legs.length - 1) {
        legs[activeLeg + 1] = {
          ...legs[activeLeg + 1],
          from: to.name, from_lat: to.lat, from_lng: to.lng,
        }
      }
      setChain({ ...chain, legs })
      setLineMap(null)
      setBanner(from.lat === undefined || to.lat === undefined
        ? '좌표를 찾지 못했습니다. 이동 수단과 시간을 직접 입력해 주세요.'
        : '구간 장소를 변경했습니다. 아래 후보에서 이동 방법을 선택하거나 직접 입력하세요.')
      await loadLegOptions(activeLeg, legs[activeLeg])
    } finally {
      setEndpointBusy(false)
    }
  }

  function lineModeOf(leg: RouteLegLike, selectedMode: string): 'subway' | 'bus' | null {
    const m = `${selectedMode} ${leg.mode}`
    if (m.includes('버스')) return 'bus'
    if (m.includes('지하철')) return 'subway'
    return null
  }

  function lineHintOf(leg: RouteLegLike, mode: 'subway' | 'bus', extra: string): string {
    if (mode === 'subway') {
      if (leg.subway_name) return leg.subway_name
      const m = (leg.detail || '').match(/([가-힣0-9]+선)/)
      return m ? m[1] : ''
    }
    if (leg.bus_no) return String(leg.bus_no).replace(/번$/, '').trim()
    const m = (leg.detail || '').match(/(\d{1,4}(?:-\d{1,3})?)\s*번/)
    if (m) return m[1]
    const m2 = (extra || '').match(/(\d{1,4}(?:-\d{1,3})?)\s*번/)
    return m2 ? m2[1] : ''
  }

  async function openLineMap(legIndexArg?: number, modeArg?: 'subway' | 'bus') {
    const legIndex = legIndexArg ?? activeLeg
    if (!chain || legIndex === null) return
    const leg = chain.legs[legIndex]
    if (!leg) return
    const mode = modeArg ?? lineModeOf(leg, manualMode)
    if (!mode) return
    const line = lineHintOf(leg, mode, manualDetail)
    setLineMap({ loading: true, error: '', data: null, board: 0, alight: 0 })
    try {
      const d = await fetch('/api/bot/route/line-map', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode, line,
          from_name: leg.from, to_name: leg.to,
          time_min: Number(leg.time_min) || 0,
          detail: leg.detail || '',
        }),
      }).then(r => r.json())
      if (d?.error) {
        setLineMap({ loading: false, error: d.error, data: null, board: 0, alight: 0 })
        return
      }
      const stops: LineStop[] = Array.isArray(d?.stops) ? d.stops : []
      if (stops.length < 2) {
        setLineMap({ loading: false, error: '노선도 정류장 정보가 없습니다.', data: null, board: 0, alight: 0 })
        return
      }
      let board = stops.findIndex(s => samePlace(s.name, leg.from))
      let alight = stops.findIndex(s => samePlace(s.name, leg.to))
      if (legIndex === 0) board = 0
      if (board < 0) board = 0
      if (legIndex === chain.legs.length - 1) alight = stops.length - 1
      if (alight < 0 || alight <= board) alight = stops.length - 1
      setLineMap({ loading: false, error: '', data: d, board, alight })
    } catch {
      setLineMap({ loading: false, error: '노선도를 불러오지 못했습니다.', data: null, board: 0, alight: 0 })
    }
  }

  function selectLineStop(idx: number) {
    if (!lineMap?.data || !chain || activeLeg === null) return
    const stops = lineMap.data.stops
    if (idx < 0 || idx >= stops.length) return
    const allowBoard = activeLeg > 0
    const allowAlight = activeLeg < chain.legs.length - 1
    if (idx <= lineMap.board) {
      if (allowBoard) setLineMap({ ...lineMap, board: idx, alight: Math.max(idx + 1, lineMap.alight) })
    } else if (allowAlight) {
      setLineMap({ ...lineMap, alight: idx })
    }
  }

  async function applyLineMap() {
    if (!chain || !lineMap?.data || activeLeg === null) return
    const stops = lineMap.data.stops
    const old = chain.legs[activeLeg]
    if (!old || !stops.length) return
    let board = lineMap.board
    let alight = lineMap.alight
    if (activeLeg === 0) board = 0
    if (activeLeg === chain.legs.length - 1) alight = stops.length - 1
    if (board < 0 || alight >= stops.length || board >= alight) {
      setLineMap({ ...lineMap, error: '승차역과 하차역을 확인해 주세요.' })
      return
    }
    const count = alight - board
    const t1 = stops[board].time_min
    const t2 = stops[alight].time_min
    const time = (t1 !== undefined && t2 !== undefined && t2 > t1)
      ? Math.max(1, Math.round(t2 - t1))
      : Math.max(1, Math.round((Number(old.time_min) || 1) * count / Math.max(1, stops.length - 1)))

    let fromNode: RouteNode = activeLeg === 0
      ? { name: old.from, lat: old.from_lat, lng: old.from_lng }
      : { name: stops[board].name, lat: stops[board].lat, lng: stops[board].lng }
    let toNode: RouteNode = activeLeg === chain.legs.length - 1
      ? { name: old.to, lat: old.to_lat, lng: old.to_lng }
      : { name: stops[alight].name, lat: stops[alight].lat, lng: stops[alight].lng }
    if (fromNode.lat === undefined || fromNode.lng === undefined) {
      const g = await geocode(fromNode.name)
      if (g) fromNode = { ...fromNode, lat: g.lat, lng: g.lng }
    }
    if (toNode.lat === undefined || toNode.lng === undefined) {
      const g = await geocode(toNode.name)
      if (g) toNode = { ...toNode, lat: g.lat, lng: g.lng }
    }

    const mode = lineMap.data.mode === 'bus' ? '🚌 버스' : '🚄 지하철'
    const line = lineMap.data.line || ''
    const detail = `${line ? line + ' ' : ''}${fromNode.name}→${toNode.name} (${time}분, ${count}정거장)`
    const legs = chain.legs.map(l => ({ ...l }))
    legs[activeLeg] = {
      ...old,
      mode,
      from: fromNode.name, from_lat: fromNode.lat, from_lng: fromNode.lng,
      to: toNode.name, to_lat: toNode.lat, to_lng: toNode.lng,
      time_min: time,
      detail,
      needs_recalc: false,
      subway_name: mode.includes('지하철') ? (line || old.subway_name) : old.subway_name,
      bus_no: mode.includes('버스') ? (line || old.bus_no) : old.bus_no,
    }
    let adjacentChanged = false
    if (activeLeg > 0 && !samePlace(old.from, fromNode.name)) {
      legs[activeLeg - 1] = {
        ...legs[activeLeg - 1],
        to: fromNode.name, to_lat: fromNode.lat, to_lng: fromNode.lng,
        needs_recalc: true,
      }
      adjacentChanged = true
    }
    if (activeLeg < legs.length - 1 && !samePlace(old.to, toNode.name)) {
      legs[activeLeg + 1] = {
        ...legs[activeLeg + 1],
        from: toNode.name, from_lat: toNode.lat, from_lng: toNode.lng,
        needs_recalc: true,
      }
      adjacentChanged = true
    }
    setChain({ ...chain, legs })
    setLineMap(null)
    setManualMode(mode)
    setManualTime(time)
    setManualDetail(detail)
    setBanner(adjacentChanged
      ? '노선도 구간을 적용했습니다. 앞뒤 구간이 바뀌어 다시 선택해야 합니다.'
      : '노선도 구간을 적용했습니다.')
  }

  function applyLegOption(opt: RouteOption) {
    if (!chain || activeLeg === null) return
    const steps = opt.steps || []
    if (!steps.length) return
    setChain(replaceLegWithSteps(chain, activeLeg, steps))
    setActiveLeg(null)
    setLineMap(null)
    setBanner('')
  }

  function applyManualLeg() {
    if (!chain || activeLeg === null) return
    const legs = [...chain.legs]
    const leg = { ...legs[activeLeg] }
    leg.mode = manualMode
    leg.time_min = Math.max(0, Number(manualTime) || 0)
    leg.detail = manualDetail.trim() || `${manualMode} ${leg.time_min}분`
    leg.needs_recalc = false
    if (!manualMode.includes('버스')) leg.bus_no = undefined
    if (!manualMode.includes('지하철') && !manualMode.includes('기차')) leg.subway_name = undefined
    legs[activeLeg] = leg
    setChain({ ...chain, legs })
    setActiveLeg(null)
    setLineMap(null)
    setBanner('')
  }

  function openAdd(legIndex: number) {
    setActiveNode(null)
    setActiveLeg(null)
    setLineMap(null)
    setAddAfter(legIndex)
    setAddQuery('')
    setAddResults([])
    void searchPlaces('', setAddResults, setAddLoading)
  }

  async function pickAddPlace(it: PlaceResult) {
    if (!chain || addAfter === null) return
    let place: RouteNode = { name: it.name, lat: num(it.lat), lng: num(it.lng) }
    if (place.lat === undefined || place.lng === undefined) {
      const g = await geocode(place.name)
      if (g) place = g
    }
    const newChain = insertNodeBetween(chain, addAfter, place)
    setChain(newChain)
    const newNodeIndex = Math.min(addAfter + 1, newChain.legs.length - 1)
    setAddAfter(null)
    setActiveNode(newNodeIndex)
    setPlaceQuery(place.name)
    setPendingPlace(place)
    await loadAdjacent(newChain, newNodeIndex, place)
  }

  function deleteNode(k: number) {
    if (!chain) return
    if (!window.confirm('이 장소를 삭제할까요? 앞뒤 구간은 다시 선택해야 합니다.')) return
    setChain(removeNode(chain, k))
    setActiveNode(null)
    setBanner('장소를 삭제했습니다. 합쳐진 구간을 눌러 경로를 선택해 주세요.')
  }

  function reorderNode(k: number, dir: -1 | 1) {
    if (!chain) return
    const r = moveNode(chain, k, dir)
    if (!r.changed) return
    setChain(r.chain)
    setActiveNode(null)
    setBanner(r.chain.legs.some(l => l.needs_recalc)
      ? '순서가 바뀌었습니다. 미정 구간을 눌러 경로를 선택해 주세요.'
      : '')
  }

  function earlierDeparture() {
    if (!times || lateMin <= 0) return
    setDeparture(formatHM(times.departureMin - lateMin))
    setSaveError('')
  }

  async function save() {
    if (!schedule || !chain) return
    if (!chain.legs.length) {
      setSaveError('경로 구간이 없습니다. 경유지를 추가하거나 경로를 선택해 주세요.')
      return
    }
    if (needsRecalc(chain)) {
      setSaveError('미정 구간이 있습니다. 해당 구간을 눌러 경로를 선택해 주세요.')
      return
    }
    if (chain.legs.some(l => !String(l.from || '').trim() || !String(l.to || '').trim())) {
      setSaveError('장소명이 비어 있는 구간이 있습니다.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const steps = chainToSteps(chain)
      const total = legDuration(chain.legs)
      const ts = computeTimes(chain, departure)
      const res = await fetch(`/api/bot/route/${schedule.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          steps,
          total_min: total,
          distance_km: num(plan?.distance_km) ?? 0,
          departure,
          arrival: formatHM(ts.departureMin + total),
          from_lat: origin.lat,
          from_lng: origin.lng,
          to_lat: destination.lat,
          to_lng: destination.lng,
          narrative: narrativeOf(chain),
        }),
      }).then(x => x.json())
      if (!res?.success) {
        setSaveError(res?.error || '저장에 실패했습니다.')
        return
      }
      onSaved()
      onClose()
    } catch {
      setSaveError('서버 연결에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  async function resetAuto() {
    if (!schedule) return
    if (!window.confirm('수정한 경로를 버리고 자동 경로로 되돌릴까요?')) return
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch(`/api/bot/route/${schedule.id}/reset`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(x => x.json())
      if (!res?.success) {
        setSaveError(res?.error || '자동 경로 재생성에 실패했습니다.')
        return
      }
      onSaved()
      onClose()
    } catch {
      setSaveError('서버 연결에 실패했습니다.')
    } finally {
      setSaving(false)
    }
  }

  if (!schedule) return null

  const chainPreview = (c: RouteChain) => {
    let lastShown = c.origin.name
    return (
      <div className="small">
        <div className="fw-bold">{c.origin.name}</div>
        {c.legs.map((l, i) => {
          const isLast = i === c.legs.length - 1
          const label = isLast ? c.destination.name : l.to
          const showPlace = !isLast && !samePlace(label, lastShown)
          if (!isLast) lastShown = label
          return (
            <div key={l.id} className="ms-1">
              <div className="text-muted" style={{ borderLeft: '2px solid #ced4da', paddingLeft: 8, marginLeft: 4 }}>
                <span className="fw-semibold text-dark">
                  {l.departure ? `${l.departure}${l.arrival ? `~${l.arrival}` : ''} ` : ''}
                </span>
                {l.needs_recalc ? '❓' : l.mode} {l.bus_no ? `${l.bus_no} ` : ''}{formatDuration(l.time_min)}
                {l.detail && <span className="ms-1" style={{ fontSize: 11 }}>· {l.detail}</span>}
              </div>
              {(isLast || showPlace) && (
                <div className="fw-semibold" style={{ paddingLeft: 8, marginLeft: 4 }}>{label}</div>
              )}
            </div>
          )
        })}
        {!c.legs.length && <div className="text-muted">경로 구간이 없습니다.</div>}
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
      <div style={{ background: '#fff', borderRadius: 16, width: 720, maxWidth: '100%', maxHeight: '92vh', overflow: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
        <div className="d-flex justify-content-between align-items-center p-3 border-bottom sticky-top bg-white" style={{ zIndex: 2 }}>
          <div>
            <div className="fw-bold">✏️ 경로 수정</div>
            <div className="small text-muted">
              {origin.name} → {destination.name}
              {target ? ` · 도착 희망 ${target}` : ''}
            </div>
          </div>
          <div className="d-flex gap-1">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowPref(v => !v)}>⚙️ 대중교통 설정</button>
            <button className="btn btn-sm btn-light" onClick={onClose}>✕</button>
          </div>
        </div>

        <div className="p-3">
          {banner && <div className="alert alert-info py-2 small">{banner}</div>}
          {saveError && <div className="alert alert-danger py-2 small">{saveError}</div>}

          {showPref && (
            <div className="border rounded p-2 mb-2" style={{ background: '#f8f9fa' }}>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-bold">⚙️ 대중교통 설정</div>
                <button className="btn btn-sm btn-light" onClick={() => setShowPref(false)}>닫기</button>
              </div>

              <div className="row g-2">
                <div className="col-6">
                  <label className="small fw-bold d-block">도보 최대 시간</label>
                  <div className="input-group input-group-sm">
                    <input type="number" min={1} max={60} className="form-control" value={walkDraft}
                      onChange={e => setWalkDraft(Number(e.target.value) || 0)} />
                    <span className="input-group-text">분</span>
                  </div>
                  <div className="small text-muted mt-1">이 시간을 넘는 경로는 빨간색으로 표시합니다.</div>
                </div>

                <div className="col-6">
                  <label className="small fw-bold d-block">공공자전거 (복수 선택)</label>
                  <div className="form-check form-switch">
                    <input className="form-check-input" type="checkbox" id="bikeOn" checked={bikeDraft}
                      onChange={e => setBikeDraft(e.target.checked)} />
                    <label className="form-check-label small" htmlFor="bikeOn">자전거 경로 포함</label>
                  </div>
                  <div className="mt-1">
                    {brands.map(b => (
                      <div className="form-check" key={b.id}>
                        <input className="form-check-input" type="checkbox" id={`brand-${b.id}`}
                          disabled={!bikeDraft || !b.available}
                          checked={brandDraft.includes(b.id)}
                          onChange={e => setBrandDraft(prev => e.target.checked
                            ? [...prev, b.id] : prev.filter(x => x !== b.id))} />
                        <label className={`form-check-label small ${bikeDraft ? '' : 'text-muted'}`} htmlFor={`brand-${b.id}`}>
                          {b.name} <span className="text-muted">({b.region})</span>
                          {!b.available && <span className="badge bg-secondary ms-1" style={{ fontSize: 9 }}>위치 조회 미지원</span>}
                        </label>
                      </div>
                    ))}
                    {!brands.length && <div className="small text-muted">브랜드 정보를 불러오는 중...</div>}
                  </div>
                  {bikeStatus && (
                    <div className={`small ${bikeStatus.available ? 'text-success' : 'text-danger'}`}>
                      {bikeStatus.available
                        ? `대여소 ${bikeStatus.stations}곳 실시간 조회 가능`
                        : `대여소 조회 불가: ${bikeStatus.reason}`}
                    </div>
                  )}
                  <a className="small" href="/guide/public-bike" target="_blank" rel="noreferrer">
                    공공자전거 이용 방법 보기 →
                  </a>
                </div>
              </div>

              <div className="mt-2">
                <label className="small fw-bold d-block">이동 수단 선호 순서</label>
                <div className="small text-muted mb-1">체크한 수단만 추천하고, 위에서부터 우선합니다.</div>
                {ORDERABLE.map(m => (
                  <div key={m} className="d-flex align-items-center gap-1 mb-1">
                    <div className="form-check mb-0">
                      <input className="form-check-input" type="checkbox" id={`ord-${m}`}
                        checked={orderDraft.includes(m)} onChange={() => toggleOrder(m)} />
                      <label className="form-check-label small" htmlFor={`ord-${m}`}>{m}</label>
                    </div>
                    {orderDraft.includes(m) && (
                      <>
                        <span className="badge bg-success">{orderDraft.indexOf(m) + 1}순위</span>
                        <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => moveOrder(m, -1)}>▲</button>
                        <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => moveOrder(m, 1)}>▼</button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              {prefSaved && <div className="small text-success mt-1">{prefSaved}</div>}
              <div className="d-flex gap-2 mt-2">
                <button className="btn btn-sm btn-success" onClick={() => void savePrefs()} disabled={prefSaving}>
                  {prefSaving ? '저장 중...' : '설정 저장'}
                </button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowPref(false)}>닫기</button>
              </div>
            </div>
          )}

          {stage === 'select' && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="fw-bold">전체 경로 후보</div>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => {
                  if (!schedule) return
                  const p = parsePlan(schedule.content)
                  void loadCandidates(schedule, origin, destination, p)
                }} disabled={loading}>다시 찾기</button>
              </div>

              {plan && (plan.steps || []).length > 0 && (() => {
                const savedChain = buildChain(plan, origin, destination)
                const savedTotal = legDuration(savedChain.legs) || Number(plan.total_min) || 0
                return (
                  <div className="border border-success rounded p-2 mb-2" style={{ background: '#f4fff8' }}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="small">
                        <div className="fw-bold">
                          내가 저장한 경로 · {formatDuration(savedTotal)}
                          <span className="badge bg-success ms-1" style={{ fontSize: 10 }}>직접 작성</span>
                          {schedule?.kind === 'custom_route' && (
                            <span className="badge bg-primary ms-1" style={{ fontSize: 10 }}>자동 재계산 제외</span>
                          )}
                        </div>
                        <div className="text-muted">
                          구간 {savedChain.legs.length}개 · 저장된 출발 {plan.departure || '-'} / 도착 {plan.arrival || '-'}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-success" onClick={() => {
                        setChain(savedChain)
                        if (plan.departure) setDeparture(String(plan.departure).slice(0, 5))
                        if (plan.arrival) setTarget(String(plan.arrival).slice(0, 5))
                        setStage('edit')
                        setBanner('저장해 둔 경로를 불러왔습니다. 구간을 눌러 수정하거나 그대로 저장할 수 있습니다.')
                      }}>이 경로 수정</button>
                    </div>
                    <div className="mt-2 pt-2 border-top">{chainPreview(savedChain)}</div>
                  </div>
                )
              })()}

              {loading && <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-success" /></div>}
              {!loading && loadError && <div className="alert alert-warning py-2 small">{loadError}</div>}

              {!loading && candidates.map((o, i) => {
                const c = chainForOption(o, origin, destination)
                const s = optionSummary(o)
                const badge = sourceBadge(o.source)
                const bad = violationsOf(o).length > 0
                return (
                  <div key={i} className={`border rounded p-2 mb-2 ${bad ? 'border-danger' : ''}`}
                    style={bad ? { background: '#fff5f5' } : undefined}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="small">
                        <div className="fw-bold">
                          {o.label || `후보 ${i + 1}`} · {formatDuration(s.total)}
                          <span className={`badge ${badge.cls} ms-1`} style={{ fontSize: 10 }}>{badge.text}</span>
                          {(o.source === 'yp_graph' || o.source === 'yp_bus')
                            ? <span className="badge bg-info text-dark ms-1" style={{ fontSize: 10 }}>시간표</span>
                            : (o.estimated ? <span className="badge bg-warning text-dark ms-1" style={{ fontSize: 10 }}>추정</span> : null)}
                        </div>
                        <div className="text-muted">
                          환승 {s.transfers} · 도보{' '}
                          <span className={s.walk > pref.walk_max_min ? 'text-danger fw-bold' : undefined}>{s.walk}분</span>
                        </div>
                        {violationsOf(o).map((v, k) => (
                          <div key={k} className="text-danger" style={{ fontSize: 11 }}>⚠ {v}</div>
                        ))}
                      </div>
                      <button className="btn btn-sm btn-success" onClick={() => selectOption(o)}>이 경로 선택</button>
                    </div>
                    <div className="mt-2 pt-2 border-top">{chainPreview(c)}</div>
                  </div>
                )
              })}

              <div className="d-flex gap-2 mt-3">
                <button className="btn btn-sm btn-outline-success flex-fill" onClick={directEdit}>직접 만들기 / 현재 경로 편집</button>
                <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>닫기</button>
              </div>
            </>
          )}

          {stage === 'edit' && chain && times && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-1">
                <div className="small">
                  <span className="fw-bold">출발 {departure} 고정</span>
                  <span className="text-muted ms-2">도착 {formatClock(times.departureMin + times.total)}</span>
                  <span className="text-muted ms-2">총 {formatDuration(times.total)}</span>
                </div>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setStage('select')}>후보 다시 보기</button>
              </div>

              {lateMin > 0 && (
                <div className="alert alert-warning py-2 small d-flex justify-content-between align-items-center gap-2 flex-wrap">
                  <span>⚠ 일정 시작({target})보다 <b>{lateMin}분</b> 늦습니다.</span>
                  <button className="btn btn-sm btn-outline-dark" onClick={earlierDeparture}>출발을 {lateMin}분 앞당기기</button>
                </div>
              )}
              {lateMin <= 0 && target && (
                <div className="alert alert-light py-1 small">일정 시작까지 {Math.abs(lateMin)}분 여유가 있습니다.</div>
              )}

              <div className="border rounded p-2 mb-2">
                <div className="d-flex justify-content-between align-items-center">
                  <div className="fw-bold">🚩 {origin.name}</div>
                  <div className="d-flex gap-1 align-items-center">
                    <span className="badge bg-light text-dark">출발</span>
                    <button className="btn btn-sm btn-outline-secondary py-0"
                      onClick={() => { setEndpointOpen(endpointOpen === 'origin' ? null : 'origin'); setOriginEdit(origin.name) }}>
                      변경
                    </button>
                  </div>
                </div>
                {endpointOpen === 'origin' && (
                  <div className="d-flex gap-1 mt-2">
                    <input className="form-control form-control-sm" value={originEdit}
                      onChange={e => setOriginEdit(e.target.value)} placeholder="출발 장소/주소" />
                    <button className="btn btn-sm btn-success" onClick={() => void applyEndpoint('origin')}>적용</button>
                  </div>
                )}
              </div>

              {!chain.legs.length && (
                <div className="text-center my-2">
                  <button className="btn btn-sm btn-outline-primary"
                    onClick={() => setChain({ ...chain, legs: [placeholderLeg(origin, destination)] })}>
                    + 출발→도착 구간 추가
                  </button>
                </div>
              )}

              <div className="text-center my-1">
                <button className="btn btn-sm btn-outline-success py-0" onClick={() => openAdd(0)}>+ 경유지 추가</button>
              </div>

              {chain.legs.map((leg, i) => (
                <div key={leg.id}>
                  <div className={`border rounded p-2 mb-1 ${leg.needs_recalc ? 'border-warning bg-warning-subtle' : ''}`}
                    style={{ background: activeLeg === i ? '#eefaf2' : undefined }}>
                    <div className="d-flex justify-content-between align-items-start gap-2">
                      <div className="small">
                        <div className="fw-semibold">
                          {leg.needs_recalc ? '❓ 미정 구간' : leg.mode}
                          {leg.bus_no ? ` ${leg.bus_no}` : ''}
                          {typeof leg.eta_min === 'number' ? ` (${leg.eta_min}분 후)` : ''}
                          {!leg.bus_no && leg.subway_name ? ` ${leg.subway_name}` : ''}
                          {' · '}{formatDuration(leg.time_min)}
                          {leg.departure && (
                            <span className="badge bg-light text-dark ms-1" style={{ fontSize: 10 }}>
                              🕐 {leg.departure}{leg.arrival ? `~${leg.arrival}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-muted">
                          {placeLabel(leg.from, leg.to)}
                          {leg.detail ? ` · ${leg.detail}` : ''}
                        </div>
                        {leg.departure && (leg.mode.includes('버스') || leg.mode.includes('지하철') || leg.mode.includes('전철')) && (
                          <div style={{ fontSize: 11, borderLeft: `3px solid ${typeof leg.slack_min === 'number' && leg.slack_min < 10 ? '#dc3545' : '#0d6efd'}`, paddingLeft: 6 }}
                            className="mt-1">
                            🚏 {leg.from}에서 {leg.departure} 탑승 → {leg.to} {leg.arrival ? `${leg.arrival} 하차` : ''}
                            {leg.ready_at && (
                              <span className={typeof leg.slack_min === 'number' && leg.slack_min < 10 ? 'text-danger ms-1' : 'text-primary ms-1'}>
                                (정류장 도착 {leg.ready_at} · 여유 {leg.slack_min ?? 0}분{typeof leg.slack_min === 'number' && leg.slack_min < 10 ? ' ⚠10분 권장' : ''})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <button className="btn btn-sm btn-outline-secondary py-0" onClick={() => void openLeg(i)}>구간 변경</button>
                    </div>

                    {activeLeg === i && (
                      <div className="mt-2 pt-2 border-top">
                        {legLoading && <div className="text-center py-2"><div className="spinner-border spinner-border-sm text-success" /></div>}
                        {legError && <div className="small text-danger mb-1">{legError}</div>}
                        {!legLoading && legOptions.map((o, k) => {
                          const os = optionSummary(o)
                          return (
                            <div key={k} className={`border rounded p-1 mb-1 ${violationsOf(o).length ? 'border-danger' : ''}`}>
                              <div className="d-flex justify-content-between align-items-start gap-2">
                                <div className="small">
                                  <b>{o.label || `대안 ${k + 1}`}</b> · {formatDuration(os.total)}
                                  <div className="text-muted">
                                    환승 {os.transfers} · 도보{' '}
                                    <span className={os.walk > pref.walk_max_min ? 'text-danger fw-bold' : undefined}>{os.walk}분</span>
                                  </div>
                                  {violationsOf(o).map((v, vi) => (
                                    <div key={vi} className="text-danger" style={{ fontSize: 11 }}>⚠ {v}</div>
                                  ))}
                                  <div className="mt-1">{chainPreview(buildChain({ steps: o.steps }, { name: leg.from, lat: leg.from_lat, lng: leg.from_lng }, { name: leg.to, lat: leg.to_lat, lng: leg.to_lng }))}</div>
                                </div>
                                <button className="btn btn-sm btn-success py-0" onClick={() => applyLegOption(o)}>적용</button>
                              </div>
                            </div>
                          )
                        })}
                        {!legLoading && !legOptions.length && !legError && <div className="small text-muted mb-1">이 구간의 대안이 없습니다. 직접 입력하세요.</div>}

                        <div className="border-top pt-2 mt-2">
                          <div className="small fw-bold mb-1">🚏 주변 정류장 실시간</div>
                          {nearBusy && <div className="small text-muted">조회 중...</div>}
                          {!nearBusy && !nearStops.length && (
                            <div className="small text-muted">이 위치 주변에 등록된 정류장이 없습니다.</div>
                          )}
                          {!nearBusy && nearStops.map((b, bi) => (
                            <div key={bi} className="small border-bottom pb-1 mb-1">
                              <div className="d-flex justify-content-between">
                                <span className="fw-semibold">{b.name}</span>
                                <span className="text-muted">도보 {b.distance_m}m</span>
                              </div>
                              {(b.realtime || []).length > 0 ? (
                                <div className="text-success">
                                  {(b.realtime || []).slice(0, 3).map((r: any, ri: number) => (
                                    <span key={ri} className="me-2">
                                      🚌 {r.route} <b>{r.min}분 후</b>{r.stops_left ? ` (${r.stops_left}정류장 전)` : ''}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-muted">
                                  {(b.routes || []).length
                                    ? `경유 노선: ${(b.routes || []).join(', ')} · 실시간 정보 없음`
                                    : '실시간 정보 없음'}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>

                        <div className="border-top pt-2 mt-2">
                          <div className="small fw-bold mb-1">장소 직접 입력</div>
                          <div className="row g-1">
                            <div className="col-5">
                              <input className="form-control form-control-sm" value={editFrom}
                                onChange={e => setEditFrom(e.target.value)} placeholder="출발 장소" />
                            </div>
                            <div className="col-2 text-center small text-muted pt-1">→</div>
                            <div className="col-5">
                              <input className="form-control form-control-sm" value={editTo}
                                onChange={e => setEditTo(e.target.value)} placeholder="도착 장소" />
                            </div>
                          </div>
                          <div className="d-flex gap-1 mt-1">
                            <button className="btn btn-sm btn-outline-success flex-fill" onClick={() => void applyLegEndpoints()} disabled={endpointBusy}>
                              {endpointBusy ? '찾는 중...' : '이 장소로 구간 다시 찾기'}
                            </button>
                          </div>
                        </div>

                        <div className="border-top pt-2 mt-2">
                          <div className="small fw-bold mb-1">이동 수단 직접 입력</div>
                          <div className="row g-1">
                            <div className="col-5">
                              <select className="form-select form-select-sm" value={manualMode}
                                onChange={e => {
                                  const v = e.target.value
                                  setManualMode(v)
                                  setLineMap(null)
                                  if (activeLeg !== null && (v.includes('지하철') || v.includes('버스'))) {
                                    void openLineMap(activeLeg, v.includes('버스') ? 'bus' : 'subway')
                                  }
                                }}>
                                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </div>
                            <div className="col-3">
                              <input type="number" min={0} className="form-control form-control-sm" value={manualTime}
                                onChange={e => setManualTime(Number(e.target.value) || 0)} placeholder="분" />
                            </div>
                            <div className="col-4">
                              <button className="btn btn-sm btn-success w-100" onClick={applyManualLeg}>적용</button>
                            </div>
                          </div>
                          <input className="form-control form-control-sm mt-1" value={manualDetail}
                            onChange={e => setManualDetail(e.target.value)} placeholder="노선/상세 (예: 경의중앙선, 3정거장)" />
                        </div>

                        {(manualMode.includes('지하철') || manualMode.includes('버스')) && (
                          <div className="border-top pt-2 mt-2">
                            <div className="d-flex justify-content-between align-items-center gap-2">
                              <div className="small fw-bold">🗺️ 노선도에서 구간 선택</div>
                              <button className="btn btn-sm btn-outline-primary py-0" onClick={() => void openLineMap()}>
                                {lineMap ? '다시 불러오기' : '노선도 보기'}
                              </button>
                            </div>
                            <div className="small text-muted">
                              승차역과 하차역을 노선도에서 선택할 수 있습니다.
                            </div>

                            {lineMap && (
                              <div ref={lineMapRef} className="border rounded p-2 mt-2 bg-white">
                                {lineMap.loading && (
                                  <div className="text-center py-2"><div className="spinner-border spinner-border-sm text-success" /></div>
                                )}
                                {lineMap.error && <div className="small text-danger">{lineMap.error}</div>}
                                {lineMap.data && (() => {
                                  const d = lineMap.data
                                  const stops = d.stops || []
                                  const allowBoard = activeLeg > 0
                                  const allowAlight = !!chain && activeLeg < chain.legs.length - 1
                                  const fromSel = activeLeg === 0 ? 0 : lineMap.board
                                  const toSel = chain && activeLeg === chain.legs.length - 1 ? stops.length - 1 : lineMap.alight
                                  const t1 = stops[fromSel]?.time_min
                                  const t2 = stops[toSel]?.time_min
                                  const segTime = (t1 !== undefined && t2 !== undefined && (t2 as number) > (t1 as number))
                                    ? Math.max(1, Math.round((t2 as number) - (t1 as number)))
                                    : Math.max(1, Math.round((Number(leg.time_min) || 1) * Math.max(1, toSel - fromSel) / Math.max(1, stops.length - 1)))
                                  const srcLabel = d.source === 'odsay' ? '실시간 노선'
                                    : d.source === 'yp_bus' ? '양평 버스 시간표'
                                    : d.source === 'odsay_bus' ? '버스 노선 정보'
                                    : '현재 구간'
                                  return (
                                    <>
                                      <div className="d-flex justify-content-between align-items-center flex-wrap gap-1">
                                        <div className="small fw-bold">{d.line || (d.mode === 'bus' ? '버스' : '지하철')}</div>
                                        <span className="badge bg-light text-dark" style={{ fontSize: 10 }}>{srcLabel}</span>
                                      </div>
                                      {d.note && <div className="small text-muted">{d.note}</div>}
                                      {stops.length === 2 && (d.station_count || 0) > 1 && (
                                        <div className="small text-muted">
                                          중간 {Math.max(0, (d.station_count || 2) - 1)}개 역/정류장이 더 있습니다.
                                        </div>
                                      )}

                                      <div className="row g-1 mt-1">
                                        <div className="col-6">
                                          <label className="small text-muted d-block">승차역</label>
                                          <select className="form-select form-select-sm" value={fromSel} disabled={!allowBoard}
                                            onChange={e => {
                                              const v = Number(e.target.value)
                                              setLineMap({ ...lineMap, board: Math.max(0, Math.min(v, lineMap.alight - 1)) })
                                            }}>
                                            {stops.map((s, idx) => <option key={idx} value={idx}>{s.name}</option>)}
                                          </select>
                                        </div>
                                        <div className="col-6">
                                          <label className="small text-muted d-block">하차역</label>
                                          <select className="form-select form-select-sm" value={toSel} disabled={!allowAlight}
                                            onChange={e => {
                                              const v = Number(e.target.value)
                                              setLineMap({ ...lineMap, alight: Math.max(lineMap.board + 1, v) })
                                            }}>
                                            {stops.map((s, idx) => <option key={idx} value={idx}>{s.name}</option>)}
                                          </select>
                                        </div>
                                      </div>

                                      <div className="mt-2" style={{ position: 'relative', maxHeight: 270, overflow: 'auto', paddingLeft: 22 }}>
                                        <div style={{ position: 'absolute', left: 9, top: 8, bottom: 8, width: 2, background: '#ced4da' }} />
                                        {stops.map((s, idx) => {
                                          const inRange = idx >= fromSel && idx <= toSel
                                          const isEnd = idx === fromSel || idx === toSel
                                          return (
                                            <div key={idx} onClick={() => selectLineStop(idx)}
                                              style={{
                                                position: 'relative', display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '3px 0', cursor: 'pointer', opacity: inRange ? 1 : 0.45,
                                              }}>
                                              <span style={{
                                                position: 'absolute', left: -18, width: 12, height: 12, borderRadius: '50%',
                                                border: '2px solid', borderColor: isEnd ? '#198754' : '#adb5bd',
                                                background: isEnd ? '#198754' : '#fff',
                                              }} />
                                              <span className="small" style={{ fontWeight: isEnd ? 700 : 400 }}>{s.name}</span>
                                              <span className="small text-muted ms-auto">
                                                {s.time_min !== undefined ? `${s.time_min}분` : ''}
                                              </span>
                                            </div>
                                          )
                                        })}
                                      </div>

                                      <div className="small text-muted mt-1">
                                        선택 구간: <b>{stops[fromSel]?.name}</b> → <b>{stops[toSel]?.name}</b>
                                        {' '}· {segTime}분 · {Math.max(0, toSel - fromSel)}정거장
                                        {!allowBoard || !allowAlight ? ' (출발/도착이 고정된 구간은 한쪽만 변경됩니다)' : ''}
                                      </div>

                                      <div className="d-flex gap-1 mt-2">
                                        <button className="btn btn-sm btn-success flex-fill" onClick={() => void applyLineMap()}>
                                          이 구간 적용
                                        </button>
                                        <button className="btn btn-sm btn-outline-secondary" onClick={() => setLineMap(null)}>닫기</button>
                                      </div>
                                    </>
                                  )
                                })()}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-end mt-1">
                          <button className="btn btn-sm btn-link py-0 px-0" onClick={() => setActiveLeg(null)}>닫기</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {i < chain.legs.length - 1 && (
                    <>
                      <div className="border rounded p-2 mb-1" style={{ background: activeNode === i + 1 ? '#eefaf2' : undefined }}>
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <div className="small">
                            <div className="fw-bold">📍 {chain.legs[i].to}</div>
                            <div className="text-muted">장소 {i + 1}</div>
                          </div>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => reorderNode(i + 1, -1)} title="위로">▲</button>
                            <button className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={() => reorderNode(i + 1, 1)} title="아래로">▼</button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => deleteNode(i + 1)} title="삭제">🗑️</button>
                            <button className="btn btn-sm btn-outline-success py-0" onClick={() => openNode(i + 1)}>장소 변경</button>
                          </div>
                        </div>

                        {activeNode === i + 1 && (
                          <div className="mt-2 pt-2 border-top">
                            <div className="small fw-bold mb-1">장소 검색</div>
                            <div className="d-flex gap-1 mb-1">
                              <input className="form-control form-control-sm" value={placeQuery}
                                onChange={e => setPlaceQuery(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') void searchPlaces(placeQuery, setPlaceResults, setPlaceLoading) }}
                                placeholder="장소명/주소" />
                              <button className="btn btn-sm btn-outline-secondary" onClick={() => void searchPlaces(placeQuery, setPlaceResults, setPlaceLoading)}>검색</button>
                            </div>
                            {placeLoading && <div className="text-center py-1"><div className="spinner-border spinner-border-sm text-success" /></div>}
                            {placeError && <div className="small text-danger">{placeError}</div>}
                            <div className="border rounded mb-2" style={{ maxHeight: 180, overflow: 'auto' }}>
                              {placeResults.map((it, k) => (
                                <button key={k} className="btn btn-sm btn-light w-100 text-start border-bottom rounded-0 py-1"
                                  onClick={() => void choosePlace(it)}>
                                  <span className="small fw-semibold">{it.name}</span>
                                  {it.address && <span className="small text-muted ms-1">· {it.address}</span>}
                                </button>
                              ))}
                              {!placeLoading && !placeResults.length && <div className="small text-muted p-2">검색 결과가 없습니다. 직접 입력 후 아래 ‘이 장소로 변경’을 누르세요.</div>}
                            </div>

                            {pendingPlace && (
                              <div className="small mb-1">
                                선택: <b>{pendingPlace.name}</b>
                                {pendingPlace.lat === undefined ? ' (좌표 없음)' : ''}
                              </div>
                            )}

                            {adjLoading && <div className="text-center py-2"><div className="spinner-border spinner-border-sm text-success" /></div>}
                            {adjError && <div className="small text-danger mb-1">{adjError}</div>}
                            {!adjLoading && !adjError && !prevOptions.length && !nextOptions.length && (
                              <div className="small text-muted mb-1">앞뒤 구간의 자동 대안이 없습니다. 현재 구간을 유지하거나 구간 변경에서 직접 입력하세요.</div>
                            )}

                            {!adjLoading && (prevOptions.length > 0 || nextOptions.length > 0) && (
                              <div className="mb-2">
                                <div className="small fw-bold">이전 구간 (앞 장소 → 여기)</div>
                                {prevOptions.slice(0, 4).map((o, k) => {
                                  const os = optionSummary(o)
                                  const pv = adjPreview(o, 'prev')
                                  return (
                                    <div key={`p${k}`} className="d-flex justify-content-between align-items-start border rounded p-1 mb-1 gap-2">
                                      <div className="small">
                                        <b>{o.label || `대안 ${k + 1}`}</b> · {formatDuration(os.total)}
                                        <div className="text-muted">환승 {os.transfers} · 도보 {os.walk}분</div>
                                        {pv && <div className="mt-1">{chainPreview(pv)}</div>}
                                      </div>
                                      <button className={`btn btn-sm py-0 ${selectedPrev === o ? 'btn-success' : 'btn-outline-success'}`}
                                        onClick={() => setSelectedPrev(selectedPrev === o ? null : o)}>
                                        {selectedPrev === o ? '선택됨' : '선택'}
                                      </button>
                                    </div>
                                  )
                                })}
                                <div className="small fw-bold mt-2">다음 구간 (여기 → 다음 장소)</div>
                                {nextOptions.slice(0, 4).map((o, k) => {
                                  const os = optionSummary(o)
                                  const nx = adjPreview(o, 'next')
                                  return (
                                    <div key={`n${k}`} className="d-flex justify-content-between align-items-start border rounded p-1 mb-1 gap-2">
                                      <div className="small">
                                        <b>{o.label || `대안 ${k + 1}`}</b> · {formatDuration(os.total)}
                                        <div className="text-muted">환승 {os.transfers} · 도보 {os.walk}분</div>
                                        {nx && <div className="mt-1">{chainPreview(nx)}</div>}
                                      </div>
                                      <button className={`btn btn-sm py-0 ${selectedNext === o ? 'btn-success' : 'btn-outline-success'}`}
                                        onClick={() => setSelectedNext(selectedNext === o ? null : o)}>
                                        {selectedNext === o ? '선택됨' : '선택'}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            <div className="d-flex gap-2">
                              <button className="btn btn-sm btn-success flex-fill" onClick={applyNode}>이 장소로 변경</button>
                              <button className="btn btn-sm btn-outline-secondary" onClick={() => { setActiveNode(null); setPendingPlace(null) }}>취소</button>
                            </div>
                          </div>
                        )}
                      </div>

                      {i < chain.legs.length - 2 && (
                        <div className="text-center my-1">
                          <button className="btn btn-sm btn-outline-success py-0" onClick={() => openAdd(i + 1)}>+ 경유지 추가</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}

              {!!chain.legs.length && (
                <div className="text-center my-1">
                  <button className="btn btn-sm btn-outline-success py-0" onClick={() => openAdd(chain.legs.length - 1)}>+ 도착 전 경유지 추가</button>
                </div>
              )}

              <div className="border rounded p-2 mb-2">
                <div className="d-flex justify-content-between align-items-center">
                  <div className="fw-bold">🏁 {destination.name}</div>
                  <div className="d-flex gap-1 align-items-center">
                    <span className="badge bg-light text-dark">도착</span>
                    <button className="btn btn-sm btn-outline-secondary py-0"
                      onClick={() => { setEndpointOpen(endpointOpen === 'dest' ? null : 'dest'); setDestEdit(destination.name) }}>
                      변경
                    </button>
                  </div>
                </div>
                {endpointOpen === 'dest' && (
                  <div className="d-flex gap-1 mt-2">
                    <input className="form-control form-control-sm" value={destEdit}
                      onChange={e => setDestEdit(e.target.value)} placeholder="도착 장소/주소" />
                    <button className="btn btn-sm btn-success" onClick={() => void applyEndpoint('dest')}>적용</button>
                  </div>
                )}
              </div>

              {addAfter !== null && (
                <div className="border rounded p-2 mb-2 bg-light">
                  <div className="small fw-bold mb-1">새 경유지 장소 검색</div>
                  <div className="d-flex gap-1 mb-1">
                    <input className="form-control form-control-sm" value={addQuery}
                      onChange={e => setAddQuery(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void searchPlaces(addQuery, setAddResults, setAddLoading) }}
                      placeholder="장소명/주소" />
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => void searchPlaces(addQuery, setAddResults, setAddLoading)}>검색</button>
                  </div>
                  {addLoading && <div className="text-center py-1"><div className="spinner-border spinner-border-sm text-success" /></div>}
                  <div className="border rounded" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {addResults.map((it, k) => (
                      <button key={k} className="btn btn-sm btn-light w-100 text-start border-bottom rounded-0 py-1"
                        onClick={() => void pickAddPlace(it)}>
                        <span className="small fw-semibold">{it.name}</span>
                        {it.address && <span className="small text-muted ms-1">· {it.address}</span>}
                      </button>
                    ))}
                    {!addLoading && !addResults.length && <div className="small text-muted p-2">검색 결과가 없습니다.</div>}
                  </div>
                  <div className="text-end mt-1">
                    <button className="btn btn-sm btn-link py-0 px-0" onClick={() => setAddAfter(null)}>취소</button>
                  </div>
                </div>
              )}

              <div className="d-flex gap-2 mt-3 flex-wrap">
                <button className="btn btn-sm btn-success flex-fill" onClick={() => void save()} disabled={saving}>
                  {saving ? '저장 중...' : '저장'}
                </button>
                {schedule.kind === 'custom_route' && (
                  <button className="btn btn-sm btn-outline-danger" onClick={() => void resetAuto()} disabled={saving}>
                    자동 경로로 되돌리기
                  </button>
                )}
                <button className="btn btn-sm btn-outline-secondary" onClick={onClose}>취소</button>
              </div>
              <div className="small text-muted mt-1">
                출발 시각은 고정입니다. 도착 시각은 구간 변경에 따라 자동으로 계산됩니다.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
