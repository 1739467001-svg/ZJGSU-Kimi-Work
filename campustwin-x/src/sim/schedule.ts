// schedule.ts —— 校园作息/潮汐/能耗曲线的纯函数库(无任何副作用,不依赖 store)
// 数据是假的,规律是真的:所有曲线按 PRD 作息锚点参数化。

/** 课程时段(HHmm,与 gen-simulation.mjs 生成课表严格一致) */
export interface ClassSlot { start: string; end: string }
export const CLASS_SLOTS: readonly ClassSlot[] = [
  { start: '0800', end: '0935' },
  { start: '0955', end: '1130' },
  { start: '1310', end: '1445' },
  { start: '1505', end: '1640' },
  { start: '1800', end: '2035' },
] as const

/** 5 条潮汐主干路径 id(FlowLines/CrowdSim 以此为准,勿改写) */
export const TIDAL_PATH_IDS = [
  'gate_south→teaching',
  'qianjiangwan→north_gate',
  'teaching→canteen_xingyun',
  'teaching→canteen_liushui',
  'teaching→library',
] as const
export type TidalPathId = (typeof TIDAL_PATH_IDS)[number]

/** 按楼宇功能的功率基线(kW,满负荷时段近似值) */
export const ENERGY_BASELINE_KW: Record<string, number> = {
  teaching: 160,
  college: 140,
  admin: 240,
  library: 300,
  venue: 180,
  sport: 150,
  dorm: 70,
  canteen: 110,
  service: 45,
  unknown: 25,
}

// ---------- 时间工具 ----------

/** 'HHmm' → 当日分钟数(0..1439) */
export function hhmmToMin(hhmm: string): number {
  const h = Number(hhmm.slice(0, 2))
  const m = Number(hhmm.slice(2, 4))
  return h * 60 + m
}

/** 当日分钟数 → 'HHmm'(零填充,可直接与课表字符串比较) */
export function minToHhmm(min: number): string {
  const mm = ((Math.floor(min) % 1440) + 1440) % 1440
  const h = Math.floor(mm / 60)
  const m = mm % 60
  return `${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}`
}

/** 仿真时钟(nowMs 本地时间)→ 当日分钟数 */
export function simMinutesOfDay(nowMs: number): number {
  const d = new Date(nowMs)
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60
}

/** 仿真时钟 → 'HHmm' */
export function simHhmm(nowMs: number): string {
  return minToHhmm(simMinutesOfDay(nowMs))
}

/** 当前是否处于课程时段内;是则返回该时段 */
export function activeClassSlot(min: number): ClassSlot | null {
  for (const s of CLASS_SLOTS) {
    if (min >= hhmmToMin(s.start) && min < hhmmToMin(s.end)) return s
  }
  return null
}

// ---------- 曲线基元 ----------

const gauss = (x: number, mu: number, sigma: number): number =>
  Math.exp(-((x - mu) * (x - mu)) / (2 * sigma * sigma))

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** 分段线性插值:pts 为 [分钟, 值] 升序序列 */
function piecewise(min: number, pts: readonly (readonly [number, number])[]): number {
  if (min <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (min <= pts[i][0]) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const t = (min - x0) / (x1 - x0)
      return y0 + (y1 - y0) * t
    }
  }
  return pts[pts.length - 1][1]
}

// ---------- 人流潮汐 ----------

/** 课程时段前 20 分钟通勤脉冲(上课人流) */
function classPulses(min: number, amp: number): number {
  let v = 0
  for (const s of CLASS_SLOTS) {
    v += gauss(min, hhmmToMin(s.start) - 15, 9) * amp
  }
  return v
}

/**
 * 潮汐路径人流密度 0..1。
 * - gate_south→teaching:课段前脉冲 + 早入校
 * - qianjiangwan→north_gate:生活区↔教学区通勤(早进晚出)
 * - teaching→canteen_*:午高峰 11:30–13:00 + 早/晚餐
 * - teaching→library:晚间高峰
 */
export function tidalDensity(pathId: TidalPathId, min: number): number {
  switch (pathId) {
    case 'gate_south→teaching':
      return clamp01(0.06 + classPulses(min, 0.9) + gauss(min, 7 * 60 + 40, 20) * 0.7)
    case 'qianjiangwan→north_gate':
      return clamp01(
        0.05 +
          gauss(min, 7 * 60 + 50, 25) * 0.85 + // 早通勤进校
          classPulses(min, 0.45) +
          gauss(min, 12 * 60 + 30, 40) * 0.3 + // 午间往返
          gauss(min, 20 * 60 + 50, 30) * 0.75, // 晚间回生活区
      )
    case 'teaching→canteen_xingyun':
    case 'teaching→canteen_liushui':
      return clamp01(
        0.04 +
          gauss(min, 7 * 60 + 20, 22) * 0.35 + // 早餐
          gauss(min, 12 * 60, 28) * 1.0 + // 午高峰 11:30–13:00
          gauss(min, 17 * 60 + 30, 35) * 0.6, // 晚餐
      )
    case 'teaching→library':
      return clamp01(
        0.05 +
          gauss(min, 9 * 60 + 30, 60) * 0.35 +
          gauss(min, 15 * 60, 90) * 0.4 +
          gauss(min, 19 * 60 + 30, 55) * 0.95, // 晚间高峰
      )
  }
}

// ---------- 食堂 / 图书馆 ----------

/** 食堂拥挤度 0..1(午高峰 11:30–13:00 最高) */
export function canteenLevel(min: number): number {
  return clamp01(
    0.05 +
      gauss(min, 7 * 60 + 20, 25) * 0.45 +
      gauss(min, 12 * 60 + 5, 32) * 1.0 +
      gauss(min, 17 * 60 + 35, 40) * 0.7 +
      gauss(min, 21 * 60, 30) * 0.15,
  )
}

/** 图书馆上座率 0..1(晚间高峰,21:30 后闭馆渐熄) */
export function librarySeatRatio(min: number): number {
  return clamp01(
    piecewise(min, [
      [0, 0.01],
      [420, 0.02], // 07:00
      [480, 0.35], // 08:00
      [540, 0.55], // 09:00
      [720, 0.5], // 12:00
      [780, 0.45], // 13:00
      [900, 0.62], // 15:00
      [1080, 0.7], // 18:00
      [1150, 0.9], // 19:10 晚间高峰
      [1290, 0.88], // 21:30
      [1320, 0.35], // 22:00 闭馆
      [1350, 0.05], // 22:30
      [1440, 0.01],
    ]),
  )
}

// ---------- 能耗 ----------

/** 按楼宇功能的时段能耗系数 0..1(× ENERGY_BASELINE_KW = 当前功率 kW) */
export function energyCurve(feature: string, min: number): number {
  switch (feature) {
    case 'teaching':
      return piecewise(min, [
        [0, 0.12], [450, 0.15], [480, 0.85], [600, 1], [700, 0.75],
        [790, 0.95], [1000, 0.9], [1080, 0.75], [1230, 0.7], [1260, 0.2], [1440, 0.12],
      ])
    case 'college':
      return piecewise(min, [
        [0, 0.18], [470, 0.25], [510, 0.75], [720, 0.7], [800, 0.85],
        [1050, 0.8], [1110, 0.45], [1260, 0.3], [1440, 0.18],
      ])
    case 'admin':
      return piecewise(min, [
        [0, 0.12], [480, 0.2], [520, 0.85], [720, 0.8], [800, 0.9],
        [1080, 0.85], [1140, 0.3], [1440, 0.12],
      ])
    case 'library':
      return piecewise(min, [
        [0, 0.15], [440, 0.25], [480, 0.8], [720, 0.85], [1150, 0.95],
        [1320, 0.85], [1360, 0.3], [1440, 0.15],
      ])
    case 'venue':
      return piecewise(min, [
        [0, 0.15], [540, 0.3], [720, 0.45], [1080, 0.5], [1140, 0.75], [1230, 0.6], [1440, 0.15],
      ])
    case 'sport':
      return piecewise(min, [
        [0, 0.1], [390, 0.4], [540, 0.35], [900, 0.6], [1080, 0.85], [1230, 0.6], [1440, 0.1],
      ])
    case 'dorm':
      return piecewise(min, [
        [0, 0.85], [400, 0.9], [450, 0.5], [540, 0.35], [720, 0.3],
        [1020, 0.45], [1080, 0.7], [1200, 0.9], [1380, 1], [1440, 0.85],
      ])
    case 'canteen':
      return clamp01(
        0.2 +
          gauss(min, 7 * 60, 30) * 0.8 +
          gauss(min, 11 * 60 + 30, 45) * 1.0 +
          gauss(min, 17 * 60, 45) * 0.85,
      )
    case 'service':
      return 0.35
    default:
      return 0.25
  }
}

/** 无房间数据的楼宇占用率兜底曲线 0..1 */
export function baselineOccupancy(feature: string, min: number): number {
  switch (feature) {
    case 'dorm':
      return piecewise(min, [
        [0, 0.95], [450, 0.9], [540, 0.35], [720, 0.25], [1080, 0.4],
        [1200, 0.75], [1320, 0.95], [1440, 0.95],
      ])
    case 'canteen':
      return canteenLevel(min)
    case 'sport':
      return clamp01(0.05 + gauss(min, 16 * 60, 120) * 0.6 + gauss(min, 20 * 60, 90) * 0.7)
    case 'venue':
      return clamp01(0.1 + gauss(min, 19 * 60 + 30, 90) * 0.7)
    case 'service':
      return 0.3
    default:
      return 0.15
  }
}

// ---------- 天气修正 ----------

/** 天气对户外人流的修正系数(雨 −30%) */
export function weatherCrowdFactor(weather: string): number {
  switch (weather) {
    case 'rain': return 0.7
    case 'snow': return 0.75
    case 'fog': return 0.9
    case 'cloudy': return 0.95
    default: return 1
  }
}
