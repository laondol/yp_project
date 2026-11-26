// 경로 편집용: 기존 content.steps ↔ 장소(노드)/구간(legs) 변환 및 시각 계산
export interface PlanStep {
  mode?: string
  from?: string
  to?: string
  time_min?: number
  detail?: string
  from_lat?: number
  from_lng?: number
  to_lat?: number
  to_lng?: number
  bus_no?: string
  subway_name?: string
  car_advice?: string
  [key: string]: unknown
}

export interface PlanLike {
  steps?: PlanStep[]
  total_min?: number
  departure?: string
  arrival?: string
  from_lat?: number
  from_lng?: number
  to_lat?: number
  to_lng?: number
  distance_km?: number
  [key: string]: unknown
}

export interface RouteNode {
  name: string
  lat?: number
  lng?: number
}

export interface RouteLeg {
  id: string
  mode: string
  from: string
  to: string
  time_min: number
  detail: string
  from_lat?: number
  from_lng?: number
  to_lat?: number
  to_lng?: number
  bus_no?: string
  subway_name?: string
  car_advice?: string
  departure?: string
  arrival?: string
  eta_min?: number
  ready_at?: string
  slack_min?: number
  board_alts?: Array<{ route: string; min: number; dest?: string }>
  needs_recalc?: boolean
}

export interface RouteChain {
  origin: RouteNode
  destination: RouteNode
  legs: RouteLeg[]
}

export interface RouteOption {
  source?: string
  label?: string
  total_min?: number
  transfers?: number
  walk_min?: number
  steps?: PlanStep[]
  estimated?: boolean
  departure?: string
  arrival?: string
  from_name?: string
  to_name?: string
  [key: string]: unknown
}

let seq = 0
function legId(): string {
  seq += 1
  return `leg-${Date.now()}-${seq}`
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : undefined
}

function norm(name?: string): string {
  return String(name || '').replace(/\s+/g, '').trim()
}

export function stepTime(st: PlanStep): number {
  return Math.max(0, Math.round(num(st.time_min) ?? 0))
}

export function parseHM(hm?: string): number | null {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (h < 0 || h > 47 || min < 0 || min > 59) return null
  return h * 60 + min
}

export function formatHM(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function dayOffset(minutes: number): number {
  return Math.floor(minutes / 1440)
}

export function formatClock(minutes: number): string {
  const off = dayOffset(minutes)
  return `${off > 0 ? `+${off}일 ` : ''}${formatHM(minutes)}`
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}분`
  return `${Math.floor(m / 60)}시간 ${m % 60}분`
}

export function legDuration(legs: RouteLeg[]): number {
  return legs.reduce((a, l) => a + (Number(l.time_min) || 0), 0)
}

export function needsRecalc(chain: RouteChain): boolean {
  return chain.legs.some(l => l.needs_recalc)
}


const STATION_SUFFIX = /(역|정류장|정류소|출구)$/

/** 표시용 정규화: 괄호·공백 제거 */
function coreName(name?: string): string {
  return String(name || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').trim()
}

/** 같은 장소로 볼지 판단 (양수역 = 양수, 국회의사당 = 국회의사당) */
export function samePlace(a?: string, b?: string): boolean {
  const x = coreName(a)
  const y = coreName(b)
  if (!x || !y) return x === y
  if (x === y) return true
  const xs = STATION_SUFFIX.test(x)
  const ys = STATION_SUFFIX.test(y)
  const xb = x.replace(STATION_SUFFIX, '')
  const yb = y.replace(STATION_SUFFIX, '')
  if (!xs && !ys) return false
  if (xs && !ys) return xb === y
  if (!xs && ys) return x === yb
  // 둘 다 접미사가 있으면 접미사 종류가 같을 때만
  return x === y || (xb === yb && x.slice(-1) === y.slice(-1))
}

/** 같은 장소면 더 구체적인 표기를 하나만 */
export function canonicalPlace(a?: string, b?: string): string {
  const x = String(a || '').trim()
  const y = String(b || '').trim()
  if (!x) return y
  if (!y) return x
  if (!samePlace(x, y)) return x
  return y.length > x.length ? y : x
}

/** 구간 표기: 같은 장소면 한 번만 */
export function placeLabel(from?: string, to?: string): string {
  if (!to) return String(from || '')
  if (!from) return String(to)
  return samePlace(from, to) ? canonicalPlace(from, to) : `${from} → ${to}`
}

/** 단계 배열의 빈 from/to/좌표를 앞뒤 문맥으로 보강 */
export function normalizeSteps(
  raw: PlanStep[] | undefined,
  origin: RouteNode,
  destination: RouteNode,
): PlanStep[] {
  const steps = (raw || []).map(s => ({ ...s }))
  if (!steps.length) return steps

  // 1) 이름 보강
  for (let i = 0; i < steps.length; i++) {
    if (!String(steps[i].from || '').trim()) {
      steps[i].from = i > 0 ? String(steps[i - 1].to || '').trim() || origin.name : origin.name
    }
    if (!String(steps[i].to || '').trim()) {
      const nextFrom = i < steps.length - 1 ? String(steps[i + 1].from || '').trim() : ''
      steps[i].to = nextFrom || destination.name
    }
  }
  if (!String(steps[steps.length - 1].to || '').trim()) steps[steps.length - 1].to = destination.name

  // 2) 좌표 보강 (앞에서 뒤로, 뒤에서 앞으로)
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]
    if (num(st.from_lat) === undefined || num(st.from_lng) === undefined) {
      const prev = i > 0 ? steps[i - 1] : null
      const lat = num(prev?.to_lat) ?? origin.lat
      const lng = num(prev?.to_lng) ?? origin.lng
      if (lat !== undefined && lng !== undefined) {
        st.from_lat = lat; st.from_lng = lng
      }
    }
    if (num(st.to_lat) === undefined || num(st.to_lng) === undefined) {
      const next = i < steps.length - 1 ? steps[i + 1] : null
      const lat = num(next?.from_lat) ?? destination.lat
      const lng = num(next?.from_lng) ?? destination.lng
      if (lat !== undefined && lng !== undefined) {
        st.to_lat = lat; st.to_lng = lng
      }
    }
  }
  return steps
}

export function legFromStep(st: PlanStep, fallbackFrom: string, fallbackTo: string): RouteLeg {
  return {
    id: legId(),
    mode: String(st.mode || '🚶 도보'),
    from: String(st.from || fallbackFrom),
    to: String(st.to || fallbackTo),
    time_min: stepTime(st),
    detail: String(st.detail || ''),
    from_lat: num(st.from_lat),
    from_lng: num(st.from_lng),
    to_lat: num(st.to_lat),
    to_lng: num(st.to_lng),
    bus_no: st.bus_no ? String(st.bus_no) : undefined,
    subway_name: st.subway_name ? String(st.subway_name) : undefined,
    car_advice: st.car_advice ? String(st.car_advice) : undefined,
    departure: st.departure ? String(st.departure).slice(0, 5) : undefined,
    arrival: st.arrival ? String(st.arrival).slice(0, 5) : undefined,
    eta_min: typeof st.eta_min === 'number' ? st.eta_min : undefined,
    ready_at: st.ready_at ? String(st.ready_at).slice(0, 5) : undefined,
    slack_min: typeof st.slack_min === 'number' ? st.slack_min : undefined,
    board_alts: Array.isArray(st.board_alts)
      ? (st.board_alts as Array<{ route: string; min: number; dest?: string }>)
      : undefined,
  }
}

export function placeholderLeg(from: RouteNode, to: RouteNode): RouteLeg {
  return {
    id: legId(),
    mode: '❓ 미정',
    from: from.name,
    to: to.name,
    time_min: 0,
    detail: '구간을 다시 선택하세요.',
    from_lat: from.lat,
    from_lng: from.lng,
    to_lat: to.lat,
    to_lng: to.lng,
    needs_recalc: true,
  }
}

/** 기존 steps + 출발/도착 정보를 편집용 체인으로 변환 */
export function buildChain(
  plan: PlanLike | null | undefined,
  origin: RouteNode,
  destination: RouteNode,
  addMissing = true,
): RouteChain {
  const steps = normalizeSteps(plan?.steps, origin, destination)
  const legs: RouteLeg[] = []
  let prevName = origin.name

  for (let i = 0; i < steps.length; i++) {
    const st = steps[i]
    let fromName = String(st.from || prevName)
    if (norm(fromName) !== norm(prevName)) {
      if (addMissing) {
        legs.push(placeholderLeg(
          { name: prevName, lat: legs.length ? legs[legs.length - 1].to_lat : origin.lat, lng: legs.length ? legs[legs.length - 1].to_lng : origin.lng },
          { name: fromName, lat: num(st.from_lat), lng: num(st.from_lng) },
        ))
      } else {
        fromName = prevName
      }
    }
    const toName = String(st.to || (i === steps.length - 1 ? destination.name : prevName))
    legs.push(legFromStep(st, fromName, toName))
    prevName = toName
  }

  // 경계 장소 표기 통일 (양수역 / 양수 같이 다르게 표기된 같은 장소)
  for (let i = 0; i < legs.length - 1; i++) {
    if (samePlace(legs[i].to, legs[i + 1].from)) {
      const c = canonicalPlace(legs[i].to, legs[i + 1].from)
      legs[i].to = c
      legs[i + 1].from = c
    }
  }

  if (legs.length) {
    legs[0].from = origin.name
    if (origin.lat !== undefined && origin.lng !== undefined) {
      legs[0].from_lat = origin.lat
      legs[0].from_lng = origin.lng
    }
    legs[legs.length - 1].to = destination.name
    if (destination.lat !== undefined && destination.lng !== undefined) {
      legs[legs.length - 1].to_lat = destination.lat
      legs[legs.length - 1].to_lng = destination.lng
    }
  }
  if (addMissing && legs.length && norm(prevName) !== norm(destination.name)) {
    const lastNode = { name: prevName, lat: legs[legs.length - 1].to_lat, lng: legs[legs.length - 1].to_lng }
    legs.push(placeholderLeg(lastNode, destination))
  }

  return { origin, destination, legs }
}

/** 편집용 체인 → 저장용 steps */
export function chainToSteps(chain: RouteChain): PlanStep[] {
  return chain.legs.map((l, i) => ({
    mode: l.mode,
    from: i === 0 ? chain.origin.name : l.from,
    to: i === chain.legs.length - 1 ? chain.destination.name : l.to,
    time_min: Number(l.time_min) || 0,
    detail: l.detail || '',
    ...(l.from_lat !== undefined ? { from_lat: l.from_lat } : {}),
    ...(l.from_lng !== undefined ? { from_lng: l.from_lng } : {}),
    ...(l.to_lat !== undefined ? { to_lat: l.to_lat } : {}),
    ...(l.to_lng !== undefined ? { to_lng: l.to_lng } : {}),
    ...(l.bus_no ? { bus_no: l.bus_no } : {}),
    ...(l.subway_name ? { subway_name: l.subway_name } : {}),
    ...(l.car_advice ? { car_advice: l.car_advice } : {}),
    ...(l.departure ? { departure: l.departure } : {}),
    ...(l.arrival ? { arrival: l.arrival } : {}),
  }))
}

/** 각 구간의 시작/도착 시각 계산 (출발 고정) */
export function computeTimes(chain: RouteChain, departure: string) {
  const dep = parseHM(departure) ?? 0
  let cursor = dep
  const legs = chain.legs.map(l => {
    const start = cursor
    const end = start + (Number(l.time_min) || 0)
    cursor = end
    return { start, end }
  })
  return {
    departureMin: dep,
    legs,
    total: cursor - dep,
    arrivalMin: cursor,
    arrival: formatClock(cursor),
  }
}

export function narrativeOf(chain: RouteChain): string {
  const parts = chain.legs.map(l => `${l.from}에서 ${l.mode} ${Number(l.time_min) || 0}분 이동하여 ${placeLabel(l.from, l.to) === l.from ? '' : l.to}`.replace(/이동하여 $/, '이동'))
  return parts.length ? `${parts.join(', ')} 도착합니다.` : ''
}

/** 한 구간을 대안 경로(여러 step)로 교체 */
export function replaceLegWithSteps(chain: RouteChain, legIndex: number, steps: PlanStep[]): RouteChain {
  const leg = chain.legs[legIndex]
  if (!leg || !steps?.length) return chain
  const from: RouteNode = { name: leg.from, lat: leg.from_lat, lng: leg.from_lng }
  const to: RouteNode = { name: leg.to, lat: leg.to_lat, lng: leg.to_lng }
  const mini = buildChain({ steps }, from, to, false)
  const legs = [...chain.legs]
  legs.splice(legIndex, 1, ...mini.legs)
  return { ...chain, legs }
}

/** 장소(중간 노드) 변경: 앞뒤 구간의 끝점을 갱신하고, 선택한 대안이 있으면 교체 */
export function replaceNode(
  chain: RouteChain,
  nodeIndex: number,
  place: RouteNode,
  prevSteps?: PlanStep[] | null,
  nextSteps?: PlanStep[] | null,
): RouteChain {
  const legs = [...chain.legs]
  if (nodeIndex <= 0 || nodeIndex >= legs.length) return chain

  const prev = { ...legs[nodeIndex - 1] }
  const next = { ...legs[nodeIndex] }

  let prevLegs: RouteLeg[]
  if (prevSteps?.length) {
    const mini = buildChain(
      { steps: prevSteps },
      { name: prev.from, lat: prev.from_lat, lng: prev.from_lng },
      place,
      false,
    )
    prevLegs = mini.legs
  } else {
    prev.to = place.name; prev.to_lat = place.lat; prev.to_lng = place.lng
    prevLegs = [prev]
  }

  let nextLegs: RouteLeg[]
  if (nextSteps?.length) {
    const mini = buildChain(
      { steps: nextSteps },
      place,
      { name: next.to, lat: next.to_lat, lng: next.to_lng },
      false,
    )
    nextLegs = mini.legs
  } else {
    next.from = place.name; next.from_lat = place.lat; next.from_lng = place.lng
    nextLegs = [next]
  }

  legs.splice(nodeIndex - 1, 2, ...prevLegs, ...nextLegs)
  return { ...chain, legs }
}

/** 한 구간 사이에 새 경유지 삽입 (기존 구간을 두 개의 미정 구간으로 교체) */
export function insertNodeBetween(chain: RouteChain, legIndex: number, place: RouteNode): RouteChain {
  const legs = [...chain.legs]
  if (!legs.length) {
    return { ...chain, legs: [placeholderLeg(chain.origin, place), placeholderLeg(place, chain.destination)] }
  }
  const idx = Math.max(0, Math.min(legIndex, legs.length - 1))
  const leg = legs[idx]
  const a: RouteNode = { name: leg.from, lat: leg.from_lat, lng: leg.from_lng }
  const b: RouteNode = { name: leg.to, lat: leg.to_lat, lng: leg.to_lng }
  legs.splice(idx, 1, placeholderLeg(a, place), placeholderLeg(place, b))
  return { ...chain, legs }
}

/** 중간 장소 삭제: 앞뒤 두 구간을 하나의 미정 구간으로 합침 */
export function removeNode(chain: RouteChain, nodeIndex: number): RouteChain {
  const legs = [...chain.legs]
  if (nodeIndex <= 0 || nodeIndex >= legs.length) return chain
  const prev = legs[nodeIndex - 1]
  const next = legs[nodeIndex]
  const a: RouteNode = { name: prev.from, lat: prev.from_lat, lng: prev.from_lng }
  const b: RouteNode = { name: next.to, lat: next.to_lat, lng: next.to_lng }
  legs.splice(nodeIndex - 1, 2, placeholderLeg(a, b))
  return { ...chain, legs }
}

/** 중간 장소 순서 변경 (연결이 맞는 기존 구간은 유지, 아니면 미정 구간) */
export function moveNode(chain: RouteChain, nodeIndex: number, dir: -1 | 1): { chain: RouteChain; changed: boolean } {
  const legs = chain.legs
  const nodes: RouteNode[] = [chain.origin]
  for (let i = 0; i < legs.length - 1; i++) {
    nodes.push({ name: legs[i].to, lat: legs[i].to_lat, lng: legs[i].to_lng })
  }
  nodes.push(chain.destination)

  const target = nodeIndex + dir
  if (nodeIndex <= 0 || nodeIndex >= nodes.length - 2 || target <= 0 || target >= nodes.length - 1) {
    return { chain, changed: false }
  }
  const swapped = [...nodes]
  ;[swapped[nodeIndex], swapped[target]] = [swapped[target], swapped[nodeIndex]]

  const existing = new Map<string, RouteLeg>()
  for (const l of legs) existing.set(`${norm(l.from)}|${norm(l.to)}`, l)

  const newLegs: RouteLeg[] = []
  for (let i = 0; i < swapped.length - 1; i++) {
    const a = swapped[i]
    const b = swapped[i + 1]
    const keep = existing.get(`${norm(a.name)}|${norm(b.name)}`)
    newLegs.push(keep ? { ...keep } : placeholderLeg(a, b))
  }
  return { chain: { ...chain, legs: newLegs }, changed: true }
}

/** 옵션에 포함된 전체 경로를 후보 카드용으로 변환 */
export function chainForOption(option: RouteOption, origin: RouteNode, destination: RouteNode): RouteChain {
  return buildChain(
    {
      steps: option.steps,
      from_lat: origin.lat, from_lng: origin.lng,
      to_lat: destination.lat, to_lng: destination.lng,
    },
    origin,
    destination,
    false,
  )
}

export function optionSummary(option: RouteOption): { total: number; transfers: number; walk: number } {
  const steps = option.steps || []
  const total = num(option.total_min) ?? steps.reduce((a, s) => a + stepTime(s), 0)
  let transit = 0
  let walk = 0
  for (const s of steps) {
    const m = String(s.mode || '')
    if (m.includes('도보')) walk += stepTime(s)
    else if (m) transit += 1
  }
  const transfers = num(option.transfers) ?? Math.max(0, transit - 1)
  return { total, transfers, walk: num(option.walk_min) ?? walk }
}
