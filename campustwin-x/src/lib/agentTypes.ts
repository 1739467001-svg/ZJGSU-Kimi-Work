// Agent / 业务 / 场景共享类型契约 —— 所有模块只准引用本文件与 campusData.ts 的类型
export type IntentName =
  | 'book_room' | 'find_free_classroom' | 'repair' | 'navigate' | 'admin_overview'
  | 'campus_tour' | 'tour_control' | 'ask_knowledge' | 'scene_director' | 'set_quality'
  | 'canteen_crowd' | 'library_seat' | 'emergency_drill' | 'event_info' | 'unknown'

export type AgentName = '调度Agent' | '预约Agent' | '报修Agent' | '导航Agent'
  | '态势Agent' | '导游Agent' | '仿真Agent' | '场景导演Agent'

export interface Intent {
  intent: IntentName
  slots: {
    time?: string; start?: string; end?: string
    capacity?: number; equipment?: string[]
    building?: string; buildingId?: string; room?: string; floor?: number
    device?: string; target?: string; targetId?: string
    scene?: 'day' | 'night' | 'dusk' | 'rain' | 'snow' | 'fog' | 'spring' | 'summer' | 'autumn' | 'winter'
    quality?: 'high' | 'medium' | 'low'
    poi?: string
  }
  agent: AgentName
  confidence: number
  rawText: string
}

export interface AgentStep {
  id: string
  agent: AgentName
  title: string
  detail: string
  status: 'waiting' | 'running' | 'done' | 'error'
}

export interface TaskResult {
  type: 'booking_candidates' | 'booking_done' | 'ticket_created' | 'overview' | 'navigation'
      | 'tour_started' | 'knowledge' | 'scene_changed' | 'canteen' | 'library' | 'drill' | 'events' | 'unknown'
  message: string
  roomIds?: string[]
  buildingIds?: string[]
  bookingId?: string
  ticketId?: string
}

export type RoomType = 'meeting' | 'classroom' | 'venue' | 'lab'
export type RoomStatus = 'free' | 'busy' | 'repair'
export type DeviceType = 'projector' | 'ac' | 'light' | 'mic' | 'screen'

export interface ScheduleItem { start: string; end: string; by: string; title?: string }

export interface Room {
  id: string
  buildingId: string
  name: string
  floor: number
  type: RoomType
  capacity: number
  equipment: DeviceType[]
  status: RoomStatus
  schedule: ScheduleItem[]
  /** 相对楼体中心的局部偏移(用于 3D 浮出标记) */
  positionHint?: [number, number, number]
}

export interface Booking {
  id: string; roomId: string; user: string; start: string; end: string
  status: 'ok' | 'cancelled'; createdAt: string
}
export type TicketStatus = 'new' | 'doing' | 'done'
export interface Ticket {
  id: string; roomId: string; deviceId?: string; desc: string
  status: TicketStatus; assignee: string; createdAt: string
}
export interface CreateBookingInput { roomId: string; user: string; start: string; end: string }
export interface CreateTicketInput { roomId: string; deviceId?: string; desc: string }

export type SceneMode = 'idle' | 'searching' | 'booking' | 'repair' | 'overview' | 'navigation' | 'tour'
export type HeatMode = 'none' | 'energy' | 'traffic' | 'occupancy'
export interface CameraFocus { type: 'campus' | 'building' | 'room' | 'route'; id?: string }

export interface ChatMessage { id: string; role: 'user' | 'agent'; text: string; ts: number }

// 仿真契约(simStore 的字段形状,sim 引擎写入,其他模块只读)
export interface CanteenCrowd { placeId: string; name: string; level: number; waitMin: number }
export interface LibrarySeat { floor: number; total: number; used: number }
export interface EventItem { id: string; venueId: string; title: string; start: string; end: string; crowd: number }
export interface SimClock { nowMs: number; speed: number; locked: boolean }
