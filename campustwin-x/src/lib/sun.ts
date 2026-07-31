// 昼夜循环核心:基于 suncalc 的太阳方位/相位计算
// 坐标约定:本地米制坐标系 x 向东、z 向南、y 向上(与 campusData 一致)
// 注意:依赖为 suncalc 2.x —— altitude/azimuth 单位均为「度」,方位角自正北起算顺时针。
import * as THREE from 'three'
import * as SunCalc from 'suncalc'

/** 浙江工商大学下沙校区(综合大楼原点) */
export const CAMPUS_LAT = 30.309378
export const CAMPUS_LNG = 120.388317

/** 黄昏过渡:太阳高度角 0° → -6°(民用暮光),杭州纬度下约 20~24 分钟 */
export const DUSK_START_DEG = 0
export const DUSK_END_DEG = -6

export type DayPhase = 'day' | 'dusk' | 'night'

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
const smoothstep = (t: number): number => {
  const x = clamp01(t)
  return x * x * (3 - 2 * x)
}

/** 太阳高度角(度,地平线上为正;suncalc 2.x 直接返回度数) */
export function sunAltitudeDeg(date: Date): number {
  return SunCalc.getPosition(date, CAMPUS_LAT, CAMPUS_LNG).altitude
}

/**
 * 从观察点指向太阳的单位方向向量。
 * suncalc 2.x 方位角为度数、自正北起算顺时针(0=N,90=E,180=S,270=W);
 * 映射到本地坐标:东=+x,南=+z。
 */
export function sunDirection(date: Date): THREE.Vector3 {
  const { altitude, azimuth } = SunCalc.getPosition(date, CAMPUS_LAT, CAMPUS_LNG)
  const alt = (altitude * Math.PI) / 180
  const az = (azimuth * Math.PI) / 180
  const cosAlt = Math.cos(alt)
  return new THREE.Vector3(
    Math.sin(az) * cosAlt, // 东为 +x
    Math.sin(alt),
    -Math.cos(az) * cosAlt, // 北为 -z(即南为 +z)
  ).normalize()
}

/** 夜晚程度 0(全白天)→ 1(全黑夜),黄昏区间平滑插值(≈20 分钟) */
export function nightFactor(date: Date): number {
  const alt = sunAltitudeDeg(date)
  return smoothstep((DUSK_START_DEG - alt) / (DUSK_START_DEG - DUSK_END_DEG))
}

export function dayPhase(date: Date): DayPhase {
  const nf = nightFactor(date)
  if (nf <= 0) return 'day'
  if (nf >= 1) return 'night'
  return 'dusk'
}

// ---------------------------------------------------------------------------
// 动态锁定时刻(TimeSwitch 按钮与 sceneHandler 指令共用,保证两处契约一致)
// ---------------------------------------------------------------------------

/** 当日日落时刻(suncalc getTimes,含大气折射修正);无日落的极端日期回退到当日 19:00 */
export function sunsetMs(date: Date = new Date()): number {
  const t = SunCalc.getTimes(date, CAMPUS_LAT, CAMPUS_LNG).sunset
  if (t && !Number.isNaN(t.getTime())) return t.getTime()
  const d = new Date(date)
  d.setHours(19, 0, 0, 0)
  return d.getTime()
}

/** 「黄昏」锁定偏移:日落前约 25 分钟(golden hour,太阳低垂 +4° 左右、长影、天空橙金) */
export const DUSK_BEFORE_SUNSET_MIN = 25

/** 「夜晚」锁定偏移:日落后约 90 分钟(暮光早已结束,全黑 + 全灯) */
export const NIGHT_AFTER_SUNSET_MIN = 90

/** 「黄昏」锁定时刻:当日日落前 DUSK_BEFORE_SUNSET_MIN 分钟 */
export function getDuskMs(date: Date = new Date()): number {
  return sunsetMs(date) - DUSK_BEFORE_SUNSET_MIN * 60_000
}

/** 「夜晚」锁定时刻:当日日落后 NIGHT_AFTER_SUNSET_MIN 分钟 */
export function getNightMs(date: Date = new Date()): number {
  return sunsetMs(date) + NIGHT_AFTER_SUNSET_MIN * 60_000
}
