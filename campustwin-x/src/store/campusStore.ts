import { create } from 'zustand'
import type {
  AgentStep, Booking, CameraFocus, ChatMessage, CreateBookingInput, CreateTicketInput,
  HeatMode, Room, SceneMode, TaskResult, Ticket,
} from '../lib/agentTypes'
import type { BakedBuilding } from '../lib/campusData'

type Panel = 'booking' | 'repair' | 'overview' | 'navigation' | 'tour' | 'empty'

let seq = 1
const nid = (p: string) => `${p}_${seq++}`

/** 楼宇高亮(青色轮廓)自动消退时长:避免指令执行完轮廓无限期挂在场景里 */
const HIGHLIGHT_TTL_MS = 15_000
let highlightTimer: ReturnType<typeof setTimeout> | null = null

/** Agent 引擎在集成时通过 registerCommandHandler 注入,UI 只调 submitCommand */
type CommandHandler = (text: string) => Promise<TaskResult>

interface CampusState {
  buildings: BakedBuilding[]
  rooms: Room[]
  bookings: Booking[]
  tickets: Ticket[]
  messages: ChatMessage[]
  agentSteps: AgentStep[]

  selectedBuildingId: string | null
  selectedRoomId: string | null
  highlightedBuildingIds: string[]
  highlightedRoomIds: string[]
  alarmRoomId: string | null
  alarmBuildingId: string | null
  scanTrigger: number
  activePanel: Panel
  sceneMode: SceneMode
  heatMode: HeatMode
  cameraFocus: CameraFocus | null
  slicedBuildingId: string | null
  /** 正在进行"点对点定位"运镜的房间 id(三段式运镜进行中非空,供 UI 显示"正在定位"态) */
  locatingRoomId: string | null

  setBuildings: (b: BakedBuilding[]) => void
  setRooms: (r: Room[]) => void
  registerCommandHandler: (h: CommandHandler) => void
  submitCommand: (text: string) => Promise<TaskResult | undefined>
  pushMessage: (m: Omit<ChatMessage, 'id' | 'ts'>) => void
  setAgentSteps: (s: AgentStep[]) => void
  patchAgentStep: (id: string, patch: Partial<AgentStep>) => void
  applyResult: (r: TaskResult) => void
  createBooking: (i: CreateBookingInput) => Booking
  createTicket: (i: CreateTicketInput) => Ticket
  advanceTicket: (id: string) => void
  selectBuilding: (id: string | null) => void
  selectRoom: (id: string | null) => void
  highlightBuildings: (ids: string[]) => void
  highlightRooms: (ids: string[]) => void
  triggerScan: () => void
  setAlarm: (roomId: string | null, buildingId: string | null) => void
  setActivePanel: (p: Panel) => void
  setSceneMode: (m: SceneMode) => void
  setHeatMode: (m: HeatMode) => void
  focusCamera: (f: CameraFocus | null) => void
  setSlicedBuilding: (id: string | null) => void
  setLocatingRoom: (id: string | null) => void
}

export const useCampusStore = create<CampusState>()((set, get) => {
  let handler: CommandHandler | null = null
  return {
    buildings: [], rooms: [], bookings: [], tickets: [],
    messages: [], agentSteps: [],
    selectedBuildingId: null, selectedRoomId: null,
    highlightedBuildingIds: [], highlightedRoomIds: [],
    alarmRoomId: null, alarmBuildingId: null, scanTrigger: 0,
    activePanel: 'empty', sceneMode: 'idle', heatMode: 'none',
    cameraFocus: null, slicedBuildingId: null, locatingRoomId: null,

    setBuildings: (buildings) => set({ buildings }),
    setRooms: (rooms) => set({ rooms }),
    registerCommandHandler: (h) => { handler = h },
    submitCommand: async (text) => {
      get().pushMessage({ role: 'user', text })
      if (!handler) {
        get().pushMessage({ role: 'agent', text: 'Agent 引擎尚未接入。' })
        return undefined
      }
      const r = await handler(text)
      get().pushMessage({ role: 'agent', text: r.message })
      get().applyResult(r)
      return r
    },
    pushMessage: (m) => set((s) => ({ messages: [...s.messages, { ...m, id: nid('msg'), ts: Date.now() }] })),
    setAgentSteps: (agentSteps) => set({ agentSteps }),
    patchAgentStep: (id, patch) => set((s) => ({ agentSteps: s.agentSteps.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    applyResult: (r) => {
      if (r.buildingIds?.length) {
        set({ highlightedBuildingIds: r.buildingIds })
        // 楼宇高亮仅作瞬时视觉反馈,到时自动清除;房间高亮是面板数据(BookingPanel 依赖),不清
        if (highlightTimer) clearTimeout(highlightTimer)
        highlightTimer = setTimeout(() => {
          highlightTimer = null
          set({ highlightedBuildingIds: [] })
        }, HIGHLIGHT_TTL_MS)
      }
      if (r.roomIds?.length) set({ highlightedRoomIds: r.roomIds })
      if (r.type === 'booking_candidates') set({ activePanel: 'booking', sceneMode: 'booking' })
      if (r.type === 'ticket_created') set({ activePanel: 'repair', sceneMode: 'repair' })
      if (r.type === 'overview') set({ activePanel: 'overview', sceneMode: 'overview', heatMode: 'occupancy' })
      if (r.type === 'navigation') set({ activePanel: 'navigation', sceneMode: 'navigation' })
      if (r.type === 'tour_started') set({ activePanel: 'tour', sceneMode: 'tour' })
    },
    createBooking: (i) => {
      const b: Booking = { ...i, id: nid('bk'), status: 'ok', createdAt: new Date().toISOString() }
      set((s) => ({ bookings: [...s.bookings, b] }))
      return b
    },
    createTicket: (i) => {
      const t: Ticket = { ...i, id: nid('tk'), status: 'new', assignee: '后勤值班', createdAt: new Date().toISOString() }
      set((s) => ({ tickets: [...s.tickets, t] }))
      return t
    },
    advanceTicket: (id) =>
      set((s) => {
        const target = s.tickets.find((t) => t.id === id)
        const tickets = s.tickets.map((t) =>
          t.id === id ? { ...t, status: t.status === 'new' ? ('doing' as const) : ('done' as const) } : t,
        )
        // 工单办结时:若它就是当前红色告警的来源,同步撤下 3D 场景中的告警标志
        const justDone = target && target.status === 'doing'
        const clearAlarm = justDone && target.roomId === s.alarmRoomId && s.alarmRoomId !== null
        return clearAlarm
          ? { tickets, alarmRoomId: null, alarmBuildingId: null }
          : { tickets }
      }),
    selectBuilding: (selectedBuildingId) => set({ selectedBuildingId }),
    selectRoom: (selectedRoomId) => set({ selectedRoomId }),
    highlightBuildings: (highlightedBuildingIds) => set({ highlightedBuildingIds }),
    highlightRooms: (highlightedRoomIds) => set({ highlightedRoomIds }),
    triggerScan: () => set({ scanTrigger: Date.now() }),
    setAlarm: (alarmRoomId, alarmBuildingId) => set({ alarmRoomId, alarmBuildingId }),
    setActivePanel: (activePanel) => set({ activePanel }),
    setSceneMode: (sceneMode) => set({ sceneMode }),
    setHeatMode: (heatMode) => set({ heatMode }),
    focusCamera: (cameraFocus) =>
      set({
        cameraFocus,
        // 房间级定位 → 进入"正在定位"态;清空/切其他类型 → 退出
        locatingRoomId:
          cameraFocus && cameraFocus.type === 'room' && cameraFocus.id ? cameraFocus.id : null,
      }),
    setSlicedBuilding: (slicedBuildingId) => set({ slicedBuildingId }),
    setLocatingRoom: (locatingRoomId) => set({ locatingRoomId }),
  }
})
