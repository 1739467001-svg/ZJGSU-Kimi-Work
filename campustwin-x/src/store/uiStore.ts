import { create } from 'zustand'

export type UIMode = 'immersive' | 'workbench'
export type Quality = 'high' | 'medium' | 'low'
export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow' | 'fog'
export type Season = 'spring' | 'summer' | 'autumn' | 'winter'
export type CameraMode = 'orbit' | 'cruise' | 'walk'

interface UIState {
  mode: UIMode
  quality: Quality
  autoQuality: boolean
  weather: Weather
  season: Season
  cameraMode: CameraMode
  labelsVisible: boolean
  openingPlayed: boolean
  setMode: (m: UIMode) => void
  setQuality: (q: Quality) => void
  setAutoQuality: (b: boolean) => void
  setWeather: (w: Weather) => void
  setSeason: (s: Season) => void
  setCameraMode: (m: CameraMode) => void
  setLabelsVisible: (b: boolean) => void
  setOpeningPlayed: (b: boolean) => void
}

export const useUIStore = create<UIState>()((set) => ({
  mode: 'immersive',
  // 移动端默认低档(dpr≤1、无后处理),桌面维持 medium 不变;用户可随时手切,autoQuality 仍可自动降档
  quality:
    typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      ? 'low'
      : 'medium',
  autoQuality: true,
  weather: 'clear',
  season: 'summer',
  cameraMode: 'orbit',
  labelsVisible: true,
  openingPlayed: false,
  setMode: (mode) => set({ mode }),
  setQuality: (quality) => set({ quality }),
  setAutoQuality: (autoQuality) => set({ autoQuality }),
  setWeather: (weather) => set({ weather }),
  setSeason: (season) => set({ season }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  setLabelsVisible: (labelsVisible) => set({ labelsVisible }),
  setOpeningPlayed: (openingPlayed) => set({ openingPlayed }),
}))
