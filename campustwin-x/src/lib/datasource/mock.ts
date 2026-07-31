// Mock 数据源:行为与现状一致 —— 房源取 /data/sim/rooms.json,检索走 rooms.ts 本地过滤,
// 态势优先读仿真快照(simStore 切片,由调用方注入),仿真未启动时退化为静态排期统计。
import type { Booking, CreateBookingInput, CreateTicketInput, Room, Ticket } from '../agentTypes'
import type { RoomQuery } from '../rooms'
import { loadRooms, searchRooms } from '../rooms'
import type {
  BookingDataSource,
  CampusDataSource,
  OverviewDataSource,
  OverviewSnapshot,
  RepairDataSource,
} from './types'

/** 与 campusStore 的 nid 同款:进程内自增短 id */
let seq = 1
const nid = (p: string) => `${p}_${seq++}`

export interface MockDataSourceOptions {
  /**
   * 读取仿真快照(simStore.getState() 的切片)。
   * 由装配方注入,保持本层不直接依赖 store;不注入则态势恒走静态排期兜底。
   */
  getSimSnapshot?: () => {
    buildingOccupancy: Record<string, number>
    buildingEnergy: Record<string, number>
  }
}

/** 房源缓存:rooms.json 是构建期生成的静态文件,会话内只需加载一次 */
let roomsCache: Room[] | null = null
async function cachedRooms(): Promise<Room[]> {
  if (!roomsCache) roomsCache = await loadRooms()
  return roomsCache
}

export function createMockBookingDataSource(): BookingDataSource {
  return {
    listRooms: cachedRooms,
    async searchRooms(query: RoomQuery): Promise<Room[]> {
      return searchRooms(await cachedRooms(), query)
    },
    // 与 campusStore.createBooking 行为一致:本地生成、即时成功
    async createBooking(input: CreateBookingInput): Promise<Booking> {
      return { ...input, id: nid('bk'), status: 'ok', createdAt: new Date().toISOString() }
    },
  }
}

export function createMockRepairDataSource(): RepairDataSource {
  return {
    listRooms: cachedRooms,
    // 与 campusStore.createTicket 行为一致:本地生成、派单给后勤值班
    async createTicket(input: CreateTicketInput): Promise<Ticket> {
      return { ...input, id: nid('tk'), status: 'new', assignee: '后勤值班', createdAt: new Date().toISOString() }
    },
  }
}

export function createMockOverviewDataSource(opts?: MockDataSourceOptions): OverviewDataSource {
  return {
    async getOverview(): Promise<OverviewSnapshot> {
      // ① 仿真快照可用:直接透传(对应现状 overviewHandler 的主路径)
      const sim = opts?.getSimSnapshot?.()
      if (sim && Object.keys(sim.buildingOccupancy).length) {
        return {
          buildingOccupancy: sim.buildingOccupancy,
          buildingEnergy: sim.buildingEnergy,
          origin: 'sim',
        }
      }
      // ② 仿真未启动:按房间静态排期估算楼宇占用率(对应现状的兜底路径)
      const rooms = await cachedRooms()
      const byBuilding = new Map<string, { total: number; busy: number }>()
      for (const r of rooms) {
        const e = byBuilding.get(r.buildingId) ?? { total: 0, busy: 0 }
        e.total += 1
        if (r.status === 'busy') e.busy += 1
        byBuilding.set(r.buildingId, e)
      }
      const buildingOccupancy: Record<string, number> = {}
      for (const [id, v] of byBuilding) {
        buildingOccupancy[id] = v.total ? v.busy / v.total : 0
      }
      return { buildingOccupancy, buildingEnergy: {}, origin: 'static' }
    },
  }
}

export function createMockDataSource(opts?: MockDataSourceOptions): CampusDataSource {
  return {
    booking: createMockBookingDataSource(),
    repair: createMockRepairDataSource(),
    overview: createMockOverviewDataSource(opts),
  }
}
