import { create } from 'zustand'
import type { CanteenCrowd, EventItem, LibrarySeat, SimClock } from '../lib/agentTypes'

interface SimState {
  simClock: SimClock
  /** roomId -> occupied(当前时段) */
  occupancy: Record<string, boolean>
  canteenCrowd: CanteenCrowd[]
  librarySeats: LibrarySeat[]
  events: EventItem[]
  /** buildingId -> 0..1 占用率(态势/热力用) */
  buildingOccupancy: Record<string, number>
  /** buildingId -> kWh(今日累计) */
  buildingEnergy: Record<string, number>
  /** 路径 id -> 0..1 人流密度(FlowLines/CrowdSim 用) */
  pathCrowd: Record<string, number>
  tick: (nowMs: number) => void
  setSimClock: (c: Partial<SimClock>) => void
  setSnapshot: (s: Partial<Pick<SimState, 'occupancy' | 'canteenCrowd' | 'librarySeats' | 'events' | 'buildingOccupancy' | 'buildingEnergy' | 'pathCrowd'>>) => void
}

export const useSimStore = create<SimState>()((set) => ({
  simClock: { nowMs: Date.now(), speed: 60, locked: false },
  occupancy: {},
  canteenCrowd: [],
  librarySeats: [],
  events: [],
  buildingOccupancy: {},
  buildingEnergy: {},
  pathCrowd: {},
  tick: (nowMs) => set((s) => ({ simClock: { ...s.simClock, nowMs } })),
  setSimClock: (c) => set((s) => ({ simClock: { ...s.simClock, ...c } })),
  setSnapshot: (s) => set(s),
}))
