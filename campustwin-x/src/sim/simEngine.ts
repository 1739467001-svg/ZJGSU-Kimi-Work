// simEngine.ts —— 校园生命体仿真引擎
// startSimEngine():以 simStore.simClock(speed 倍速)推进仿真时钟,
// 每个 tick 计算房间占用/楼宇占用率/能耗累计/潮汐人流/食堂排队/图书馆占座,
// 经 useSimStore.setSnapshot 写入;天气修正读 uiStore.weather(雨:户外人流 ×0.7)。
// 动画规范:仅用 requestAnimationFrame,无 setInterval;返回停止函数。

import type { BakedBuilding } from '../lib/campusData'
import type { CanteenCrowd, EventItem, LibrarySeat, Room } from '../lib/agentTypes'
import { loadRooms } from '../lib/rooms'
import { useCampusStore } from '../store/campusStore'
import { useSimStore } from '../store/simStore'
import { useUIStore } from '../store/uiStore'
import {
  ENERGY_BASELINE_KW,
  TIDAL_PATH_IDS,
  baselineOccupancy,
  canteenLevel,
  energyCurve,
  librarySeatRatio,
  simHhmm,
  simMinutesOfDay,
  tidalDensity,
  weatherCrowdFactor,
} from './schedule'

// ---------- 仿真数据文件形状(public/data/sim/*.json,由 gen-simulation.mjs 生成) ----------
interface CanteenInfo {
  placeId: string
  buildingId: string
  name: string
  seats: number
  floors: number
}
interface LibraryInfo {
  buildingId: string
  name: string
  floors: { floor: number; seats: number }[]
}
interface CanteenFile { canteens: CanteenInfo[] }
interface EventsFile { events: EventItem[] }

interface EngineData {
  rooms: Room[]
  buildings: BakedBuilding[]
  canteens: CanteenInfo[]
  library: LibraryInfo | null
  events: EventItem[]
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function loadEngineData(): Promise<EngineData> {
  const [rooms, canteenFile, libraryFile, eventsFile] = await Promise.all([
    loadRooms(),
    fetchJson<CanteenFile>('/data/sim/canteen.json'),
    fetchJson<LibraryInfo>('/data/sim/library.json'),
    fetchJson<EventsFile>('/data/sim/events.json'),
  ])
  // 楼宇数据优先取已加载的 campusStore,否则自行拉取
  let buildings = useCampusStore.getState().buildings
  if (buildings.length === 0) {
    const b = await fetchJson<{ buildings: BakedBuilding[] }>('/data/campus/buildings.json')
    buildings = b?.buildings ?? []
  }
  return {
    rooms,
    buildings,
    canteens: canteenFile?.canteens ?? [],
    library: libraryFile,
    events: eventsFile?.events ?? [],
  }
}

/** placeId → 稳定的 0..1 抖动(各家食堂拥挤度微差,可复现) */
function hashJitter(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0
  return ((h >>> 0) % 1000) / 1000
}

/**
 * 启动仿真引擎。
 * @returns stop() 停止函数(组件卸载/热更新时调用)
 */
export function startSimEngine(): () => void {
  let raf = 0
  let stopped = false
  let data: EngineData | null = null
  let lastRealMs = performance.now()
  let lastSnapshotMs = 0
  /** buildingId -> 今日累计 kWh */
  const energyAcc = new Map<string, number>()
  /** 上一次快照的仿真时间(能耗按仿真时长积分) */
  let lastSimMs: number | null = null

  void loadEngineData().then((d) => {
    data = d
    for (const b of d.buildings) energyAcc.set(b.id, 0)
  })

  const roomOccupied = (room: Room, hhmm: string): boolean => {
    if (room.status === 'busy') return true
    return room.schedule.some((s) => s.start <= hhmm && hhmm < s.end)
  }

  const computeSnapshot = (simNowMs: number): void => {
    if (!data) return
    const min = simMinutesOfDay(simNowMs)
    const hhmm = simHhmm(simNowMs)
    const weather = useUIStore.getState().weather
    const crowdFactor = weatherCrowdFactor(weather)

    // 1) 房间占用
    const occupancy: Record<string, boolean> = {}
    for (const r of data.rooms) occupancy[r.id] = roomOccupied(r, hhmm)

    // 2) 楼宇占用率(有房间按房间统计,无房间按功能兜底曲线)
    const roomStats = new Map<string, { total: number; busy: number }>()
    for (const r of data.rooms) {
      const st = roomStats.get(r.buildingId) ?? { total: 0, busy: 0 }
      st.total += 1
      if (occupancy[r.id]) st.busy += 1
      roomStats.set(r.buildingId, st)
    }
    const buildingOccupancy: Record<string, number> = {}
    for (const b of data.buildings) {
      const st = roomStats.get(b.id)
      if (st && st.total > 0) {
        buildingOccupancy[b.id] = st.busy / st.total
      } else {
        buildingOccupancy[b.id] = baselineOccupancy(b.feature ?? 'unknown', min)
      }
    }

    // 3) 能耗累计:基线功率 × 时段曲线 × 仿真时长(小时)
    if (lastSimMs != null) {
      let dtSimMs = simNowMs - lastSimMs
      if (dtSimMs < 0) dtSimMs = 0 // 时钟回拨不计
      if (dtSimMs > 10 * 60 * 1000) dtSimMs = 10 * 60 * 1000 // 防跳变灌入
      const dtH = dtSimMs / 3600000
      for (const b of data.buildings) {
        const kw = (ENERGY_BASELINE_KW[b.feature ?? 'unknown'] ?? ENERGY_BASELINE_KW.unknown) *
          energyCurve(b.feature ?? 'unknown', min)
        energyAcc.set(b.id, (energyAcc.get(b.id) ?? 0) + kw * dtH)
      }
    }
    const buildingEnergy: Record<string, number> = {}
    for (const [id, kwh] of energyAcc) buildingEnergy[id] = Math.round(kwh * 100) / 100

    // 4) 潮汐路径人流(雨 ×0.7 等天气修正)
    const pathCrowd: Record<string, number> = {}
    for (const pid of TIDAL_PATH_IDS) {
      pathCrowd[pid] = Math.min(1, Math.max(0, tidalDensity(pid, min) * crowdFactor))
    }

    // 5) 食堂排队(午高峰 11:30–13:00 由 canteenLevel 曲线驱动)
    const canteenCrowd: CanteenCrowd[] = data.canteens.map((c) => {
      const level = Math.min(1, Math.max(0, canteenLevel(min) * (0.9 + hashJitter(c.placeId) * 0.2)))
      return {
        placeId: c.placeId,
        name: c.name,
        level: Math.round(level * 100) / 100,
        waitMin: Math.round(level * 14),
      }
    })

    // 6) 图书馆占座(晚间高峰;低楼层先坐满)
    const librarySeats: LibrarySeat[] = (data.library?.floors ?? []).map((f) => {
      const ratio = Math.min(1, Math.max(0, librarySeatRatio(min) * (1.08 - 0.04 * f.floor)))
      return { floor: f.floor, total: f.seats, used: Math.round(f.seats * ratio) }
    })

    useSimStore.getState().setSnapshot({
      occupancy,
      buildingOccupancy,
      buildingEnergy,
      pathCrowd,
      canteenCrowd,
      librarySeats,
      events: data.events,
    })
    lastSimMs = simNowMs
  }

  const loop = (realMs: number): void => {
    if (stopped) return
    const dtRealMs = Math.max(0, realMs - lastRealMs)
    lastRealMs = realMs

    const sim = useSimStore.getState()
    const clock = sim.simClock
    // 推进仿真时钟(locked 时冻结)
    const simNowMs = clock.locked ? clock.nowMs : clock.nowMs + dtRealMs * clock.speed
    if (!clock.locked) sim.tick(simNowMs)

    // 快照每 500ms 真实时间重算一次
    if (realMs - lastSnapshotMs >= 500) {
      lastSnapshotMs = realMs
      computeSnapshot(simNowMs)
    }
    raf = requestAnimationFrame(loop)
  }

  raf = requestAnimationFrame(loop)

  return () => {
    stopped = true
    cancelAnimationFrame(raf)
  }
}
