// 巡游状态:校训巡礼逐站 waypoint 巡航。
// 镜头侧由 TourCruise 消费(逐站阻尼飞行),面板侧由 TourPanel 消费(进度+讲稿),
// 指令侧由 tourHandler 写入/控制(startTour / tour_control)。
import { create } from 'zustand'

/** 巡游途径点:地标 + 一句讲稿 */
export interface TourWaypoint {
  id: string
  name: string
  position: [number, number]
  script: string
}

/** 播放状态:idle = 未开始/已结束 */
export type TourStatus = 'idle' | 'playing' | 'paused'

/** 每站停留时长(秒):到位后讲稿展示时间,5~7s 区间取中 */
export const TOUR_DWELL_SEC = 6

interface TourState {
  waypoints: TourWaypoint[]
  currentIndex: number
  status: TourStatus
  /** 每站停留时长(秒) */
  dwellSec: number

  start: (wps: TourWaypoint[]) => void
  next: () => void
  prev: () => void
  pause: () => void
  resume: () => void
  stop: () => void
}

export const useTourStore = create<TourState>()((set) => ({
  waypoints: [], currentIndex: 0, status: 'idle', dwellSec: TOUR_DWELL_SEC,

  start: (waypoints) => {
    if (waypoints.length) set({ waypoints, currentIndex: 0, status: 'playing' })
  },
  // 跳转即续游:上/下一站同时把暂停态拉回播放,镜头随即飞向目标站
  next: () => set((s) => (s.waypoints.length
    ? { currentIndex: Math.min(s.currentIndex + 1, s.waypoints.length - 1), status: 'playing' as TourStatus }
    : {})),
  prev: () => set((s) => (s.waypoints.length
    ? { currentIndex: Math.max(s.currentIndex - 1, 0), status: 'playing' as TourStatus }
    : {})),
  pause: () => set((s) => (s.status === 'playing' ? { status: 'paused' as TourStatus } : {})),
  resume: () => set((s) => (s.status === 'paused' ? { status: 'playing' as TourStatus } : {})),
  // 结束:保留 waypoints 供面板显示「已结束」状态;镜头返校由 TourCruise 负责
  stop: () => set({ status: 'idle', currentIndex: 0 }),
}))
