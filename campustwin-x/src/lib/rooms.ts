import type { DeviceType, Room, RoomType } from './agentTypes'
import { DEPLOY_BASE } from './deployBase'

/** 加载仿真房间数据(public/data/sim/rooms.json,由 gen-simulation.mjs 生成) */
export async function loadRooms(): Promise<Room[]> {
  const res = await fetch(`${DEPLOY_BASE}data/sim/rooms.json`)
  if (!res.ok) return []
  const data = await res.json()
  return data.rooms as Room[]
}

// ---------- 懒加载缓存:rooms.json(~344KB)只在首次需要时才请求 ----------
// 触发点:首次剖切 / 首次房间选中 / AI 涉及房间的指令 / 预约等业务面板首次打开。
// 幂等:多次调用共享同一个 Promise,只 fetch 一次;失败时清空缓存允许下次重试。
let roomsPromise: Promise<Room[]> | null = null

/** 带缓存的幂等加载:返回同一个 Promise,不会重复请求 rooms.json */
export function ensureRoomsLoaded(): Promise<Room[]> {
  if (!roomsPromise) {
    roomsPromise = loadRooms().catch(() => {
      roomsPromise = null // 失败不缓存,下次调用可重试
      return []
    })
  }
  return roomsPromise
}

export interface RoomQuery {
  type?: RoomType
  capacity?: number
  equipment?: DeviceType[]
  buildingId?: string
  floor?: number
  /** 要求该时间段空闲(HHmm-HHmm);省略则查当前状态 */
  slot?: { start: string; end: string }
}

const overlap = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart < bEnd && bStart < aEnd

export function searchRooms(rooms: Room[], q: RoomQuery): Room[] {
  return rooms.filter((r) => {
    if (q.type && r.type !== q.type) return false
    if (q.capacity && r.capacity < q.capacity) return false
    if (q.buildingId && r.buildingId !== q.buildingId) return false
    if (q.floor != null && r.floor !== q.floor) return false
    if (q.equipment?.length && !q.equipment.every((e) => r.equipment.includes(e))) return false
    if (r.status === 'repair') return false
    if (q.slot && r.schedule.some((s) => overlap(q.slot!.start, q.slot!.end, s.start, s.end))) return false
    return true
  })
}

/** 中文设备词 → DeviceType */
export const DEVICE_WORDS: Record<string, DeviceType> = {
  投影: 'projector', 投影仪: 'projector', 空调: 'ac', 灯: 'light', 灯光: 'light',
  麦克: 'mic', 麦克风: 'mic', 话筒: 'mic', 屏幕: 'screen', 大屏: 'screen', 显示器: 'screen',
}
export const DEVICE_NAME: Record<DeviceType, string> = {
  projector: '投影', ac: '空调', light: '灯光', mic: '麦克风', screen: '屏幕',
}
