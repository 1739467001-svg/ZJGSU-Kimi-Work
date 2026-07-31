import { create } from 'zustand'
import type {
  AgentStep, Booking, CameraFocus, ChatMessage, CreateBookingInput, CreateTicketInput,
  HeatMode, Room, SceneMode, TaskResult, Ticket,
} from '../lib/agentTypes'
import type { BakedBuilding } from '../lib/campusData'

type Panel = 'booking' | 'repair' | 'overview' | 'navigation' | 'tour' | 'empty'

let seq = 1
const nid = (p: string) => `${p}_${seq++}`

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
    cameraFocus: null, slicedBuildingId: null,

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
      if (r.buildingIds?.length) set({ highlightedBuildingIds: r.buildingIds })
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
    advanceTicket: (id) => set((s) => ({
      tickets: s.tickets.map((t) => (t.id === id ? { ...t, status: t.status === 'new' ? 'doing' : 'done' } : t)),
    })),
    selectBuilding: (selectedBuildingId) => set({ selectedBuildingId }),
    selectRoom: (selectedRoomId) => set({ selectedRoomId }),
    highlightBuildings: (highlightedBuildingIds) => set({ highlightedBuildingIds }),
    highlightRooms: (highlightedRoomIds) => set({ highlightedRoomIds }),
    triggerScan: () => set({ scanTrigger: Date.now() }),
    setAlarm: (alarmRoomId, alarmBuildingId) => set({ alarmRoomId, alarmBuildingId }),
    setActivePanel: (activePanel) => set({ activePanel }),
    setSceneMode: (sceneMode) => set({ sceneMode }),
    setHeatMode: (heatMode) => set({ heatMode }),
    focusCamera: (cameraFocus) => set({ cameraFocus }),
    setSlicedBuilding: (slicedBuildingId) => set({ slicedBuildingId }),
  }
})
