// 楼层布局引擎(M4 契约层)—— 真实感房间排布
// 设计:以楼宇 footprint 为边界,沿长轴生成中央走廊,房间按编号顺序
// 沿走廊两侧交替排布(奇数北侧/偶数南侧,仿真实教学楼);
// 紧凑型 footprint 退化为周边式布局。全部确定性(无随机),运行时计算。
import type { BakedBuilding } from './campusData'
import type { Room } from './agentTypes'

/** 单个房间在楼层平面中的单元格(局部坐标,原点=楼体中心,z 向南为正) */
export interface RoomCell {
  roomId: string
  /** 单元格中心与尺寸(米) */
  x: number
  z: number
  w: number
  d: number
  /** 门位置:靠走廊一侧边的中点 */
  door: { x: number; z: number }
  /** 位于走廊哪一侧(局部方位,north=-z / south=+z / west=-x / east=+x) */
  side: 'north' | 'south' | 'west' | 'east'
}

/** 楼层平面布局 */
export interface FloorLayout {
  floor: number
  /** 走廊条带(可能多段,L 形/一字形) */
  corridor: { x: number; z: number; w: number; d: number }[]
  /** 房间单元格(已按房间号顺序排布) */
  cells: RoomCell[]
  /** 楼电梯间(垂直交通核)位置 */
  cores: { x: number; z: number }[]
  /** 该层有效使用边界(内退墙体后的 bbox) */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

// ---------------------------------------------------------------------------
// 布局参数常量(导出供视图层/校验脚本复用)
// ---------------------------------------------------------------------------

/** 外墙内退(墙体厚度) */
export const WALL_INSET = 0.9
/** 中央走廊宽度 */
export const CORRIDOR_WIDTH = 2.4
/** 长条形判定:长宽比超过该值走一字形中央走廊,否则周边式 */
export const LINEAR_ASPECT = 1.6
/** 相邻单元格之间的隔墙缝 */
export const ROOM_GAP = 0.15
/** 房间面宽分档(按 capacity) */
export const FACE_WIDTH_SMALL = 3.6
export const FACE_WIDTH_MEDIUM = 7.2
export const FACE_WIDTH_LARGE = 10.8
/** 大空间判定:venue/报告厅或容量达到该值,允许独占端部区域 */
export const BIG_ROOM_CAPACITY = 120
/** 周边式布局的最大房间进深 */
export const MAX_ROOM_DEPTH = 9

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

interface Rect {
  x: number
  z: number
  w: number
  d: number
}
type Side = 'north' | 'south' | 'west' | 'east'
interface Bounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

/** capacity → 面宽分档:小 3.6m / 中 7.2m / 大 10.8m */
function faceWidth(capacity: number): number {
  if (capacity < 60) return FACE_WIDTH_SMALL
  if (capacity < 100) return FACE_WIDTH_MEDIUM
  return FACE_WIDTH_LARGE
}

function isBigRoom(r: Room): boolean {
  return r.type === 'venue' || r.capacity >= BIG_ROOM_CAPACITY
}

const CN_DIGIT: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 简易中文数字解析(支持 十/十二/二十 一类) */
function parseCnNum(s: string): number | null {
  if (!s) return null
  const ten = s.indexOf('十')
  if (ten < 0) return s.length === 1 && CN_DIGIT[s] != null ? CN_DIGIT[s] : null
  const hi = ten > 0 ? CN_DIGIT[s[0]] : 1
  const lo = ten < s.length - 1 ? CN_DIGIT[s[ten + 1]] : 0
  if (hi == null || lo == null) return null
  return hi * 10 + lo
}

/** 从房间名提取排序用数字:C302→302、九楼第二会议室→2;提取不到返回 null */
function roomNumber(name: string): number | null {
  const m = name.match(/\d+/)
  if (m) return parseInt(m[0], 10)
  let c = name.match(/第([一二两三四五六七八九十]+)/)
  if (c) {
    const n = parseCnNum(c[1])
    if (n != null) return n
  }
  c = name.match(/([一二两三四五六七八九十]+)楼/)
  if (c) {
    const n = parseCnNum(c[1])
    if (n != null) return n
  }
  return null
}

/** 确定性排序:按房间名数字序,其次名字符串码位,最后 id */
function sortRooms(rooms: Room[]): Room[] {
  return [...rooms].sort((a, b) => {
    const na = roomNumber(a.name)
    const nb = roomNumber(b.name)
    const ka = na == null ? Number.MAX_SAFE_INTEGER : na
    const kb = nb == null ? Number.MAX_SAFE_INTEGER : nb
    if (ka !== kb) return ka - kb
    if (a.name !== b.name) return a.name < b.name ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 大空间房间面宽:容量线性估算并限幅 */
function bigFaceWidth(capacity: number, totalLen: number): number {
  return clamp(capacity * 0.15, FACE_WIDTH_LARGE, totalLen * 0.35)
}

// ---------------------------------------------------------------------------
// 一字形中央走廊布局(长条形楼,长宽比 > LINEAR_ASPECT)
// 长轴为 x(horizontal=true)或 z;房间在走廊两侧进深排布,奇偶分侧。
// ---------------------------------------------------------------------------
function layoutLinear(
  bounds: Bounds,
  sorted: Room[],
  horizontal: boolean,
): Pick<FloorLayout, 'corridor' | 'cells' | 'cores'> {
  const { minX, maxX, minZ, maxZ } = bounds
  const W = maxX - minX
  const D = maxZ - minZ
  const CW = Math.min(CORRIDOR_WIDTH, Math.min(W, D))
  // 长轴/短轴参数化:axis ∈ [minA,maxA](走廊方向),cross ∈ [minC,maxC](进深方向)
  const minA = horizontal ? minX : minZ
  const maxA = horizontal ? maxX : maxZ
  const minC = horizontal ? minZ : minX
  const maxC = horizontal ? maxZ : maxX
  const L = maxA - minA
  const midC = (minC + maxC) / 2
  const depth = Math.max(1, (maxC - minC - CW) / 2)
  // 侧 A = 负向(north/west),侧 B = 正向(south/east)
  const sideName = (isA: boolean): Side =>
    horizontal ? (isA ? 'north' : 'south') : isA ? 'west' : 'east'
  // 由 长轴中心a/面宽w + 侧A? 构造单元格
  const mkCell = (
    room: Room,
    aCenter: number,
    w: number,
    isA: boolean,
    fullDepth: boolean,
  ): RoomCell => {
    const cCenter = fullDepth
      ? midC
      : isA
        ? minC + depth / 2
        : maxC - depth / 2
    const d = fullDepth ? maxC - minC : depth
    const doorC = isA ? midC - CW / 2 : midC + CW / 2
    const doorA = fullDepth ? aCenter - w / 2 : aCenter // 独占端部时门开在西侧
    const x = horizontal ? aCenter : cCenter
    const z = horizontal ? cCenter : aCenter
    return {
      roomId: room.id,
      x,
      z,
      w: horizontal ? w : d,
      d: horizontal ? d : w,
      door: fullDepth
        ? { x: horizontal ? doorA : midC, z: horizontal ? midC : doorA }
        : { x: horizontal ? doorA : doorC, z: horizontal ? doorC : doorA },
      side: fullDepth ? (horizontal ? 'east' : 'south') : sideName(isA),
    }
  }

  const big = sorted.filter(isBigRoom)
  const normal = sorted.filter((r) => !isBigRoom(r))
  const cells: RoomCell[] = []
  const order = new Map(sorted.map((r, i) => [r.id, i]))

  let corrEnd = maxA
  // 特例:整层只有一个大空间(剧院/报告厅/阅览室)→ 独占端部全进深区域
  if (sorted.length === 1 && big.length === 1) {
    const w = clamp(big[0].capacity * 0.15, FACE_WIDTH_LARGE, L * 0.75)
    const aCenter = maxA - w / 2
    corrEnd = maxA - w
    cells.push(mkCell(big[0], aCenter, w, true, true))
  } else {
    // 大空间房间:从走廊正端交替两侧、以加大面宽独占端部段落
    const bigCursor: [number, number] = [maxA, maxA]
    const hasBig: [boolean, boolean] = [false, false]
    big.forEach((r, i) => {
      const isA = i % 2 === 0
      const idx = isA ? 0 : 1
      const w = bigFaceWidth(r.capacity, L)
      const right = bigCursor[idx]
      bigCursor[idx] = right - w - ROOM_GAP
      hasBig[idx] = true
      cells.push(mkCell(r, right - w / 2, w, isA, false))
    })
    // 每侧可用右界:有大空间时为其左缘,否则为边界 maxA
    const limit: [number, number] = [
      hasBig[0] ? bigCursor[0] + ROOM_GAP : maxA,
      hasBig[1] ? bigCursor[1] + ROOM_GAP : maxA,
    ]
    // 普通房间:从走廊负端起,奇偶分侧交替排布;一侧排不下则顺延另一侧
    const nCursor: [number, number] = [minA, minA]
    normal.forEach((r, i) => {
      const num = roomNumber(r.name)
      const wantA = num != null ? num % 2 === 1 : i % 2 === 0
      const w0 = faceWidth(r.capacity)
      const fits = (isA: boolean, w: number) => {
        const idx = isA ? 0 : 1
        return nCursor[idx] + w <= limit[idx] + 1e-9
      }
      let side = wantA
      let w = w0
      if (!fits(side, w)) {
        if (fits(!side, w)) {
          side = !side
        } else {
          // 两侧都排不下:选剩余空间较多的一侧压缩面宽顺延(保底不丢房间)
          const remA = limit[0] - nCursor[0]
          const remB = limit[1] - nCursor[1]
          side = remA >= remB
          w = Math.max(1, Math.max(remA, remB))
        }
      }
      const idx = side ? 0 : 1
      cells.push(mkCell(r, nCursor[idx] + w / 2, w, side, false))
      nCursor[idx] += w + ROOM_GAP
    })
  }

  // 走廊:一字形,从负端走到正端(或大空间端部区边界)
  const corrLen = Math.max(CW, corrEnd - minA)
  const corrACenter = minA + corrLen / 2
  const corridor: Rect[] = [
    horizontal
      ? { x: corrACenter, z: midC, w: corrLen, d: CW }
      : { x: midC, z: corrACenter, w: CW, d: corrLen },
  ]
  const coreA1 = minA + Math.min(1.2, corrLen / 4)
  const coreA2 = minA + corrLen - Math.min(1.2, corrLen / 4)
  const cores = horizontal
    ? [{ x: coreA1, z: midC }, { x: coreA2, z: midC }]
    : [{ x: midC, z: coreA1 }, { x: midC, z: coreA2 }]

  cells.sort((a, b) => (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0))
  return { corridor, cells, cores }
}

// ---------------------------------------------------------------------------
// 周边式布局(紧凑型楼):房间沿四周外墙,走廊成环,中央留白作交通核
// ---------------------------------------------------------------------------
function layoutCompact(
  bounds: Bounds,
  sorted: Room[],
): Pick<FloorLayout, 'corridor' | 'cells' | 'cores'> {
  const { minX, maxX, minZ, maxZ } = bounds
  const W = maxX - minX
  const D = maxZ - minZ
  const m = Math.min(W, D)
  // 房间进深:保证中央交通核短边不小于走廊宽
  const rd = clamp((m - 3 * CORRIDOR_WIDTH) / 2, 2.5, MAX_ROOM_DEPTH)
  const CW = CORRIDOR_WIDTH
  const midX = (minX + maxX) / 2
  const midZ = (minZ + maxZ) / 2
  const innerW = W - 2 * (rd + CW)
  const innerD = D - 2 * (rd + CW)

  // 环形走廊:南北两条通长 + 东西两条连接
  const corridor: Rect[] = [
    { x: midX, z: minZ + rd + CW / 2, w: W, d: CW }, // north band
    { x: midX, z: maxZ - rd - CW / 2, w: W, d: CW }, // south band
    { x: minX + rd + CW / 2, z: midZ, w: CW, d: Math.max(CW, innerD) }, // west band
    { x: maxX - rd - CW / 2, z: midZ, w: CW, d: Math.max(CW, innerD) }, // east band
  ]
  const cores = [
    { x: midX - Math.max(0.6, innerW / 4), z: midZ },
    { x: midX + Math.max(0.6, innerW / 4), z: midZ },
  ]

  // 四条侧边带:start/len 为沿带方向的活动区间
  interface Band {
    side: Side
    start: number
    end: number
    cursor: number
    taken: boolean
    mk: (room: Room, aCenter: number, w: number) => RoomCell
  }
  const bands: Band[] = [
    {
      side: 'north',
      start: minX,
      end: maxX,
      cursor: minX,
      taken: false,
      mk: (room, a, w) => ({
        roomId: room.id,
        x: a,
        z: minZ + rd / 2,
        w,
        d: rd,
        door: { x: a, z: minZ + rd },
        side: 'north',
      }),
    },
    {
      side: 'east',
      start: minZ + rd + CW,
      end: maxZ - rd - CW,
      cursor: minZ + rd + CW,
      taken: false,
      mk: (room, a, w) => ({
        roomId: room.id,
        x: maxX - rd / 2,
        z: a,
        w: rd,
        d: w,
        door: { x: maxX - rd, z: a },
        side: 'east',
      }),
    },
    {
      side: 'south',
      start: minX,
      end: maxX,
      cursor: minX,
      taken: false,
      mk: (room, a, w) => ({
        roomId: room.id,
        x: a,
        z: maxZ - rd / 2,
        w,
        d: rd,
        door: { x: a, z: maxZ - rd },
        side: 'south',
      }),
    },
    {
      side: 'west',
      start: minZ + rd + CW,
      end: maxZ - rd - CW,
      cursor: minZ + rd + CW,
      taken: false,
      mk: (room, a, w) => ({
        roomId: room.id,
        x: minX + rd / 2,
        z: a,
        w: rd,
        d: w,
        door: { x: minX + rd, z: a },
        side: 'west',
      }),
    },
  ]

  const cells: RoomCell[] = []
  const order = new Map(sorted.map((r, i) => [r.id, i]))
  const big = sorted.filter(isBigRoom)
  const normal = sorted.filter((r) => !isBigRoom(r))

  // 大空间房间:独占整条侧边带(按 北→东→南→西 顺序)
  big.forEach((r, i) => {
    const band = bands[i % bands.length]
    band.taken = true
    cells.push(band.mk(r, (band.start + band.end) / 2, band.end - band.start))
  })

  // 普通房间:在未被独占的侧边带上轮转分配(仿周边式办公/学院楼)
  const avail = bands.filter((b) => !b.taken && b.end - b.start >= FACE_WIDTH_SMALL)
  const pool = avail.length > 0 ? avail : bands.filter((b) => !b.taken)
  normal.forEach((r, i) => {
    const w0 = faceWidth(r.capacity)
    let band: Band | undefined
    if (pool.length > 0) {
      for (let k = 0; k < pool.length; k++) {
        const cand = pool[(i + k) % pool.length]
        if (cand.cursor + w0 <= cand.end + 1e-9) {
          band = cand
          break
        }
      }
    }
    let w = w0
    if (!band) {
      // 全部排不下:选剩余最多的带压缩面宽(保底不丢房间)
      band = pool.length > 0
        ? pool.reduce((p, c) => (c.end - c.cursor > p.end - p.cursor ? c : p), pool[0])
        : bands[0]
      w = Math.max(1, band.end - band.cursor)
    }
    cells.push(band.mk(r, band.cursor + w / 2, w))
    band.cursor += w + ROOM_GAP
  })

  cells.sort((a, b) => (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0))
  return { corridor, cells, cores }
}

/** 计算某楼某层的平面布局(确定性;同一输入恒同输出) */
export function computeFloorLayout(
  building: BakedBuilding,
  rooms: Room[],
  floor: number,
): FloorLayout {
  const xs = building.footprint.map(([x]) => x - building.center[0])
  const zs = building.footprint.map(([, z]) => z - building.center[1])
  const bounds: Bounds = {
    minX: Math.min(...xs) + WALL_INSET,
    maxX: Math.max(...xs) - WALL_INSET,
    minZ: Math.min(...zs) + WALL_INSET,
    maxZ: Math.max(...zs) - WALL_INSET,
  }
  const W = bounds.maxX - bounds.minX
  const D = bounds.maxZ - bounds.minZ
  const floorRooms = sortRooms(rooms.filter((r) => r.floor === floor))

  if (W <= 0 || D <= 0) {
    return { floor, corridor: [], cells: [], cores: [], bounds }
  }

  const aspect = Math.max(W, D) / Math.min(W, D)
  const inner =
    aspect > LINEAR_ASPECT
      ? layoutLinear(bounds, floorRooms, W >= D)
      : layoutCompact(bounds, floorRooms)

  return { floor, corridor: inner.corridor, cells: inner.cells, cores: inner.cores, bounds }
}
