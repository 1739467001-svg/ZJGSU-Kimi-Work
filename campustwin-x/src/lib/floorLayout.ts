// 楼层布局引擎(M4 契约层)—— 真实感房间排布
// 设计:以楼宇 footprint 为边界,沿长轴生成中央走廊,房间按编号顺序
// 沿走廊两侧交替排布(奇数北侧/偶数南侧,仿真实教学楼);
// 紧凑型 footprint 退化为周边式布局;
// 明显非矩形的弧形楼(综合大楼/图书馆)走弧形布局:识别内弧凹链,
// 沿内弧向内偏移出走廊折线,房间沿弧线排在走廊外侧;
// 所有楼的 cell 最后经"多边形落位合法化"后处理,保证四角收进 footprint。
// 全部确定性(无随机),运行时计算。
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

/** 弧形楼布局统计(仅弧形/非矩形楼携带,供验收脚本与调试输出) */
export interface ArcLayoutStats {
  /** 贴合弧线的走廊折线段数 */
  corridorSegs: number
  /** 落在外弧侧(走廊与外墙之间)的房间数 */
  roomsOuter: number
  /** 外侧空间不足、补位到内弧侧的房间数 */
  roomsInner: number
  /** 收缩面宽兜底落位的房间数 */
  roomsFallback: number
  /** 因越出轮廓/重叠被裁掉的候选格位数 */
  slotsSkipped: number
}

/** 楼层平面布局 */
export interface FloorLayout {
  floor: number
  /** 走廊条带(可能多段,L 形/一字形/弧形折线) */
  corridor: { x: number; z: number; w: number; d: number }[]
  /** 房间单元格(已按房间号顺序排布) */
  cells: RoomCell[]
  /** 楼电梯间(垂直交通核)位置 */
  cores: { x: number; z: number }[]
  /** 该层有效使用边界(内退墙体后的 bbox) */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  /** 弧形布局统计(仅弧形楼存在;矩形楼无此字段,保证旧输出逐字节一致) */
  arc?: ArcLayoutStats
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
// 多边形几何工具(弧形楼布局与落位合法化后处理共用;纯几何自实现,无外部依赖)
// 约定:多边形为局部坐标(原点=楼体中心),闭合顶点数组(首尾可重复)。
// ---------------------------------------------------------------------------
type Pt = [number, number]

/** 鞋带公式求带符号面积(>0 为逆时针 CCW) */
function polySignedArea(poly: Pt[]): number {
  let a = 0
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]
  }
  return a / 2
}

/** 射线法:点是否在多边形内(边上点的归属由调用方用距离判定兜底) */
function pointInPolygon(poly: Pt[], x: number, z: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i]
    const [xj, zj] = poly[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

/** 点到线段的最小距离 */
function distPointToSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const l2 = dx * dx + dz * dz
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0
  t = clamp(t, 0, 1)
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}

/** 点到多边形边的最小距离(逐边取 min) */
function pointToPolyEdgeDist(poly: Pt[], x: number, z: number): number {
  let m = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    m = Math.min(m, distPointToSeg(x, z, poly[j][0], poly[j][1], poly[i][0], poly[i][1]))
  }
  return m
}

/**
 * 房间矩形落位是否合法:
 * 四角均在 footprint 内、每个角到多边形边的最小距离 ≥ clearance,
 * 且四条边中点也在多边形内(防凹口从两角之间切入),整体不越出 bounds。
 */
function cellLegalInPolygon(
  poly: Pt[],
  bounds: Bounds,
  x: number,
  z: number,
  w: number,
  d: number,
  clearance: number,
): boolean {
  const l = x - w / 2
  const r = x + w / 2
  const t = z - d / 2
  const b = z + d / 2
  if (l < bounds.minX || r > bounds.maxX || t < bounds.minZ || b > bounds.maxZ) return false
  const corners: Pt[] = [
    [l, t],
    [r, t],
    [l, b],
    [r, b],
  ]
  for (const [cx, cz] of corners) {
    if (!pointInPolygon(poly, cx, cz)) return false
    if (pointToPolyEdgeDist(poly, cx, cz) < clearance) return false
  }
  const mids: Pt[] = [
    [x, t],
    [x, b],
    [l, z],
    [r, z],
  ]
  for (const [mx, mz] of mids) {
    if (!pointInPolygon(poly, mx, mz)) return false
  }
  return true
}

/** 验收断言口径:cell 四角均在 footprint 内(角点在多边形外但距边 ≤0.04m 视为容差通过) */
function cellPassesContainment(poly: Pt[], c: RoomCell): boolean {
  const corners: Pt[] = [
    [c.x - c.w / 2, c.z - c.d / 2],
    [c.x + c.w / 2, c.z - c.d / 2],
    [c.x - c.w / 2, c.z + c.d / 2],
    [c.x + c.w / 2, c.z + c.d / 2],
  ]
  return corners.every(
    ([cx, cz]) => pointInPolygon(poly, cx, cz) || pointToPolyEdgeDist(poly, cx, cz) <= 0.04,
  )
}

/** 两矩形是否重叠(带容差;供落位排他检测) */
function rectsOverlap(
  ax: number, az: number, aw: number, ad: number,
  bx: number, bz: number, bw: number, bd: number,
  eps: number,
): boolean {
  const ox = Math.min(ax + aw / 2, bx + bw / 2) - Math.max(ax - aw / 2, bx - bw / 2)
  const oz = Math.min(az + ad / 2, bz + bd / 2) - Math.max(az - ad / 2, bz - bd / 2)
  return ox > eps && oz > eps
}

// ---------------------------------------------------------------------------
// 弧形/非矩形楼判定:顶点数多 且 bbox 面积 / 实际多边形面积 > 2
// (综合大楼 30 顶点/填充率 0.25、图书馆 45 顶点/0.49 命中;
//  其余矩形/近矩形楼不命中,布局输出保持逐字节一致)
// ---------------------------------------------------------------------------
/** 弧形楼最少顶点数 */
export const ARC_MIN_VERTICES = 12
/** 弧形楼 bbox 面积 / 实际面积阈值(越大越不像矩形) */
export const ARC_BBOX_FILL_RATIO = 2.0

function isArcFootprint(poly: Pt[]): boolean {
  if (poly.length < ARC_MIN_VERTICES) return false
  const xs = poly.map(([x]) => x)
  const zs = poly.map(([, z]) => z)
  const bboxArea =
    (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs))
  const area = Math.abs(polySignedArea(poly))
  return area > 0 && bboxArea / area > ARC_BBOX_FILL_RATIO
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

// ---------------------------------------------------------------------------
// 弧形布局(弧形/非矩形楼):识别"内弧边链"(最长连续凹顶点段),
// 沿内弧向内偏移出走廊中线,走廊用贴合弧线的阶梯折线条带表示;
// 房间沿弧线排在走廊外侧(外弧与走廊之间),外侧放不下再向内弧侧补位,
// 仍不行则收缩面宽整链重扫兜底。落位一律过 cellLegalInPolygon 判定。
// ---------------------------------------------------------------------------

/** 弧形布局用:沿内弧偏移出的走廊脊线(折线 + 各顶点外向单位向量) */
interface ArcSpine {
  /** 走廊中线折线顶点(已向内偏移) */
  pts: Pt[]
  /** 每个顶点对应的"外弧方向"单位向量(房间内推方向) */
  dirs: Pt[]
  /** 折线累计弧长 */
  cum: number[]
  /** 折线总长 */
  total: number
}

/** 最长连续凹顶点链(环状扫描),两端各外扩 1 个顶点作为链端;无凹顶点返回 null */
function longestReflexChain(poly: Pt[]): Pt[] | null {
  const n = poly.length
  const sgn = Math.sign(polySignedArea(poly)) || 1
  const reflex: boolean[] = []
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[(i - 1 + n) % n]
    const [bx, bz] = poly[i]
    const [cx, cz] = poly[(i + 1) % n]
    const cross = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx)
    reflex.push(cross * sgn < -1e-9)
  }
  // 环状最长连续 run:复制一倍线性扫
  let bestStart = -1
  let bestLen = 0
  let cur = 0
  for (let i = 0; i < 2 * n; i++) {
    if (reflex[i % n]) {
      cur++
      if (cur > bestLen && cur <= n) {
        bestLen = cur
        bestStart = i - cur + 1
      }
    } else {
      cur = 0
    }
  }
  if (bestStart < 0) return null
  // 两端各外扩一个(凸)顶点,让走廊脊线延伸到弧线端部
  const from = (bestStart - 1 + n) % n
  const count = bestLen + 2
  const chain: Pt[] = []
  for (let k = 0; k < count; k++) chain.push(poly[(from + k) % n])
  return chain
}

/** 由凹链构造走廊脊线:每个顶点沿角平分线的内侧法向偏移(方向以点在多边形内判定) */
function buildArcSpine(poly: Pt[], chain: Pt[]): ArcSpine {
  const CW = CORRIDOR_WIDTH
  const pts: Pt[] = []
  const dirs: Pt[] = []
  for (let i = 0; i < chain.length; i++) {
    const [px, pz] = chain[i]
    // 角平分线(端点退化为单边法向)
    const norm = (vx: number, vz: number): Pt => {
      const l = Math.hypot(vx, vz)
      return l > 1e-9 ? [vx / l, vz / l] : [0, 0]
    }
    const perp = (vx: number, vz: number): Pt => [-vz, vx]
    let bx = 0
    let bz = 0
    if (i > 0) {
      const e = norm(px - chain[i - 1][0], pz - chain[i - 1][1])
      const n1 = perp(e[0], e[1])
      bx += n1[0]
      bz += n1[1]
    }
    if (i < chain.length - 1) {
      const e = norm(chain[i + 1][0] - px, chain[i + 1][1] - pz)
      const n2 = perp(e[0], e[1])
      bx += n2[0]
      bz += n2[1]
    }
    const bl = Math.hypot(bx, bz)
    if (bl < 1e-9) {
      const e = norm(chain[Math.min(i + 1, chain.length - 1)][0] - px, chain[Math.min(i + 1, chain.length - 1)][1] - pz)
      const np = perp(e[0], e[1])
      bx = np[0]
      bz = np[1]
    } else {
      bx /= bl
      bz /= bl
    }
    // 内外判定:两侧各探 1m,取在多边形内且离边更远的一侧为"内"
    const probe = (sx: number) => {
      const qx = px + bx * sx
      const qz = pz + bz * sx
      return pointInPolygon(poly, qx, qz) ? pointToPolyEdgeDist(poly, qx, qz) : -Infinity
    }
    const dirSign = probe(1) >= probe(-1) ? 1 : -1
    const dx = bx * dirSign
    const dz = bz * dirSign
    dirs.push([dx, dz])
    // 偏移量:从大到小试,取偏移点仍在多边形内且离边足够远者
    let q: Pt = [px + dx * (WALL_INSET + CW / 2), pz + dz * (WALL_INSET + CW / 2)]
    for (const off of [WALL_INSET + CW / 2 + 0.6, WALL_INSET + CW / 2, WALL_INSET + CW / 2 - 0.5]) {
      const cand: Pt = [px + dx * off, pz + dz * off]
      if (pointInPolygon(poly, cand[0], cand[1]) && pointToPolyEdgeDist(poly, cand[0], cand[1]) >= Math.min(off, 1.8) * 0.7) {
        q = cand
        break
      }
    }
    pts.push(q)
  }
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
  }
  return { pts, dirs, cum, total: cum[cum.length - 1] ?? 0 }
}

/** 脊线弧长 s 处取样:位置、切向单位向量、外向单位向量(取最近折线顶点的外向) */
function spineAt(sp: ArcSpine, s: number): { p: Pt; tan: Pt; dir: Pt } {
  const t = clamp(s, 0, sp.total)
  let i = 0
  while (i < sp.cum.length - 2 && sp.cum[i + 1] < t) i++
  const segLen = Math.max(sp.cum[i + 1] - sp.cum[i], 1e-9)
  const f = (t - sp.cum[i]) / segLen
  const a = sp.pts[i]
  const b = sp.pts[i + 1]
  const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const tan: Pt = [(b[0] - a[0]) / tl, (b[1] - a[1]) / tl]
  const dir = f < 0.5 ? sp.dirs[i] : sp.dirs[Math.min(i + 1, sp.dirs.length - 1)]
  return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], tan, dir }
}

/** 弧形楼布局主流程 */
function layoutArc(
  poly: Pt[],
  bounds: Bounds,
  sorted: Room[],
): Pick<FloorLayout, 'corridor' | 'cells' | 'cores' | 'arc'> {
  const CW = CORRIDOR_WIDTH
  const stats: ArcLayoutStats = {
    corridorSegs: 0,
    roomsOuter: 0,
    roomsInner: 0,
    roomsFallback: 0,
    slotsSkipped: 0,
  }
  const chain = longestReflexChain(poly)
  // 极端兜底:没有凹链(理论上弧形楼必有)时退回周边式,由合法化后处理收边
  if (!chain || chain.length < 2) {
    const inner = layoutCompact(bounds, sorted)
    return { ...inner, arc: stats }
  }
  const sp = buildArcSpine(poly, chain)

  // 走廊:贴合弧线的阶梯折线条带(相邻中线点的 bbox 外扩半廊宽)
  const corridor: Rect[] = []
  for (let i = 0; i < sp.pts.length - 1; i++) {
    const [ax, az] = sp.pts[i]
    const [bx, bz] = sp.pts[i + 1]
    corridor.push({
      x: (ax + bx) / 2,
      z: (az + bz) / 2,
      w: Math.abs(ax - bx) + CW,
      d: Math.abs(az - bz) + CW,
    })
  }
  stats.corridorSegs = corridor.length

  // 交通核:脊线 30% / 70% 处(避开弧线端部),收进 bounds
  const cores = [0.3, 0.7].map((f) => {
    const { p } = spineAt(sp, sp.total * f)
    return {
      x: clamp(p[0], bounds.minX + 1, bounds.maxX - 1),
      z: clamp(p[1], bounds.minZ + 1, bounds.maxZ - 1),
    }
  })

  const cells: RoomCell[] = []
  const order = new Map(sorted.map((r, i) => [r.id, i]))

  /**
   * 在脊线弧长 sCenter 处尝试落一间房:
   * side=1 沿外向(外弧与走廊之间),side=-1 沿内弧侧补位;
   * 房间面宽沿切向主轴、进深沿外推方向逐档缩小试探,
   * 合法(四角在 footprint 内且留够墙体内退)且不与已放房间重叠时落位。
   */
  const tryPlace = (
    room: Room,
    w: number,
    sCenter: number,
    side: 1 | -1,
  ): { cell: RoomCell; spur: Rect } | null => {
    const { p, tan, dir } = spineAt(sp, sCenter)
    const ox = dir[0] * side
    const oz = dir[1] * side
    const horiz = Math.abs(tan[0]) >= Math.abs(tan[1])
    // 切向主轴对应的外推分量太弱(≈45° 拐角段)时跳过,避免房间压上走廊
    const depths = side === 1 ? [8.5, 7.4, 6.3, 5.2, 4.1, 3.0, 2.6] : [6.0, 5.0, 4.0, 3.0, 2.6]
    for (const dep of depths) {
      let cell: RoomCell
      let spur: Rect
      if (horiz) {
        if (Math.abs(oz) < 0.25) return null
        const sz = oz >= 0 ? 1 : -1
        const cx = p[0]
        const cz = p[1] + sz * (CW / 2 + dep / 2)
        if (!cellLegalInPolygon(poly, bounds, cx, cz, w, dep, WALL_INSET - 0.02)) continue
        if (cells.some((c) => rectsOverlap(cx, cz, w, dep, c.x, c.z, c.w, c.d, 0.005))) continue
        const doorX = clamp(p[0], cx - w / 2, cx + w / 2)
        const doorZ = cz - sz * dep / 2
        const spurW = Math.min(CW, w)
        cell = {
          roomId: room.id, x: cx, z: cz, w, d: dep,
          door: { x: doorX, z: doorZ },
          side: sz < 0 ? 'north' : 'south',
        }
        // 连接支廊:从门边中线拉回走廊脊线(与带形走廊自然连成一片)
        const spurX = w > spurW ? clamp(p[0], cx - w / 2 + spurW / 2, cx + w / 2 - spurW / 2) : cx
        spur = { x: spurX, z: (doorZ + p[1]) / 2, w: spurW, d: Math.abs(p[1] - doorZ) }
      } else {
        if (Math.abs(ox) < 0.25) return null
        const sx = ox >= 0 ? 1 : -1
        const cx = p[0] + sx * (CW / 2 + dep / 2)
        const cz = p[1]
        if (!cellLegalInPolygon(poly, bounds, cx, cz, dep, w, WALL_INSET - 0.02)) continue
        if (cells.some((c) => rectsOverlap(cx, cz, dep, w, c.x, c.z, c.w, c.d, 0.005))) continue
        const doorX = cx - sx * dep / 2
        const doorZ = clamp(p[1], cz - w / 2, cz + w / 2)
        const spurD = Math.min(CW, w)
        cell = {
          roomId: room.id, x: cx, z: cz, w: dep, d: w,
          door: { x: doorX, z: doorZ },
          side: sx < 0 ? 'west' : 'east',
        }
        const spurZ = w > spurD ? clamp(p[1], cz - w / 2 + spurD / 2, cz + w / 2 - spurD / 2) : cz
        spur = { x: (doorX + p[0]) / 2, z: spurZ, w: Math.abs(p[0] - doorX), d: spurD }
      }
      return { cell, spur }
    }
    stats.slotsSkipped++
    return null
  }

  // 房间整体沿弧线居中:先算总面宽,再把外侧游标起点放到脊线中段,
  // 避免小房间全挤在弧线端部
  const totalFace = sorted.reduce(
    (acc, r, i) =>
      acc + (isBigRoom(r) ? bigFaceWidth(r.capacity, sp.total) : faceWidth(r.capacity)) + (i > 0 ? ROOM_GAP : 0),
    0,
  )
  let outerCursor = Math.max(0, (sp.total - totalFace) / 2)
  let innerCursor = Math.max(0, (sp.total - totalFace) / 2)
  for (const room of sorted) {
    const w0 = isBigRoom(room) ? bigFaceWidth(room.capacity, sp.total) : faceWidth(room.capacity)
    let placed: { cell: RoomCell; spur: Rect } | null = null
    // ① 外弧侧:从当前游标起,小幅平移尝试
    for (const ds of [0, 0.8, 1.6, 2.4]) {
      const s = outerCursor + ds
      if (s + w0 > sp.total + 1e-9) break
      placed = tryPlace(room, w0, s + w0 / 2, 1)
      if (placed) {
        outerCursor = s + w0 + ROOM_GAP
        stats.roomsOuter++
        break
      }
    }
    // ② 内弧侧补位
    if (!placed) {
      for (const ds of [0, 0.8, 1.6, 2.4]) {
        const s = innerCursor + ds
        if (s + w0 > sp.total + 1e-9) break
        placed = tryPlace(room, w0, s + w0 / 2, -1)
        if (placed) {
          innerCursor = s + w0 + ROOM_GAP
          stats.roomsInner++
          break
        }
      }
    }
    // ③ 收缩面宽兜底:整根脊线重扫(先外后内)
    if (!placed) {
      const w2 = Math.max(3.0, w0 * 0.55)
      for (let s = 0; s + w2 <= sp.total + 1e-9 && !placed; s += 0.75) {
        placed = tryPlace(room, w2, s + w2 / 2, 1) ?? tryPlace(room, w2, s + w2 / 2, -1)
      }
      if (placed) stats.roomsFallback++
    }
    // ④ 仍失败:放在脊线中点外侧(交由多边形合法化后处理搬迁,保证不丢房间)
    if (!placed) {
      const { p, tan, dir } = spineAt(sp, sp.total / 2)
      const horiz = Math.abs(tan[0]) >= Math.abs(tan[1])
      const sz = dir[horiz ? 1 : 0] >= 0 ? 1 : -1
      const cx = horiz ? p[0] : p[0] + sz * (CW / 2 + 1.3)
      const cz = horiz ? p[1] + sz * (CW / 2 + 1.3) : p[1]
      const w = horiz ? w0 : 2.6
      const d = horiz ? 2.6 : w0
      cells.push({
        roomId: room.id, x: cx, z: cz, w, d,
        door: horiz ? { x: cx, z: cz - sz * d / 2 } : { x: cx - sz * w / 2, z: cz },
        side: horiz ? (sz < 0 ? 'north' : 'south') : sz < 0 ? 'west' : 'east',
      })
      stats.slotsSkipped++
      continue
    }
    cells.push(placed.cell)
    corridor.push(placed.spur)
  }

  cells.sort((a, b) => (order.get(a.roomId) ?? 0) - (order.get(b.roomId) ?? 0))
  return { corridor, cells, cores, arc: stats }
}

// ---------------------------------------------------------------------------
// 多边形落位合法化后处理(所有楼通用):
// 一字/周边式布局按 bbox 内退,非矩形楼(斜边/凹口/切角)的 cell 可能越出
// footprint。这里把越界 cell 沿走廊边平移吸附到合法位置(优先保持原尺寸,
// 找不到再按比例收缩),门随走廊侧边重算;已合法的 cell 原样保留,
// 因此对本身就在轮廓内的楼输出逐字节不变。
// ---------------------------------------------------------------------------
function legalizeCellsToPolygon(
  poly: Pt[],
  bounds: Bounds,
  corridor: Rect[],
  cells: RoomCell[],
): RoomCell[] {
  // 已合法(验收口径)的 cell 原样保留,不参与重排
  const keep = cells.map((c) => cellPassesContainment(poly, c))
  if (keep.every(Boolean)) return cells

  const placed: RoomCell[] = cells.filter((_, i) => keep[i])
  const result: RoomCell[] = cells.map((c, i) => (keep[i] ? c : (null as unknown as RoomCell)))

  /** 候选生成:贴某条走廊边的某一位置(外侧),返回 cell 与门 */
  const snapToEdge = (
    orig: RoomCell,
    rect: Rect,
    edge: Side,
    along: number,
    w: number,
    d: number,
  ): RoomCell | null => {
    const rl = rect.x - rect.w / 2
    const rr = rect.x + rect.w / 2
    const rt = rect.z - rect.d / 2
    const rb = rect.z + rect.d / 2
    let cell: RoomCell
    if (edge === 'north' || edge === 'south') {
      // 水平边:面宽沿 x,房间向边外侧(z 向)伸展
      const cx = along + w / 2
      if (cx + w / 2 > rr + 1e-9 || cx - w / 2 < rl - 1e-9) return null
      const sz = edge === 'north' ? -1 : 1
      const edgeZ = edge === 'north' ? rt : rb
      const cz = edgeZ + sz * d / 2
      cell = {
        roomId: orig.roomId, x: cx, z: cz, w, d,
        door: { x: cx, z: edgeZ },
        side: edge,
      }
    } else {
      const cz = along + w / 2
      if (cz + w / 2 > rb + 1e-9 || cz - w / 2 < rt - 1e-9) return null
      const sx = edge === 'west' ? -1 : 1
      const edgeX = edge === 'west' ? rl : rr
      const cx = edgeX + sx * d / 2
      cell = {
        roomId: orig.roomId, x: cx, z: cz, w: d, d: w,
        door: { x: edgeX, z: cz },
        side: edge,
      }
    }
    return cell
  }

  const relocate = (orig: RoomCell): RoomCell => {
    // 尺寸逐档收缩,优先原尺寸;每档全走廊边扫描,取离原位最近的合法解
    for (const f of [1, 0.85, 0.7, 0.55, 0.4, 0.28]) {
      const w = Math.max(orig.w * f, 2.2)
      const d = Math.max(orig.d * f, 2.2)
      let best: RoomCell | null = null
      let bestDist = Infinity
      for (const rect of corridor) {
        const rl = rect.x - rect.w / 2
        const rr = rect.x + rect.w / 2
        const rt = rect.z - rect.d / 2
        const rb = rect.z + rect.d / 2
        const edges: { edge: Side; start: number; end: number }[] = [
          { edge: 'north', start: rl, end: rr },
          { edge: 'south', start: rl, end: rr },
          { edge: 'west', start: rt, end: rb },
          { edge: 'east', start: rt, end: rb },
        ]
        for (const { edge, start, end } of edges) {
          for (let a = start; a + w <= end + 1e-9; a += 0.5) {
            const cand = snapToEdge(orig, rect, edge, a, w, d)
            if (!cand) continue
            if (!cellLegalInPolygon(poly, bounds, cand.x, cand.z, cand.w, cand.d, 0.3)) continue
            if (placed.some((c) => rectsOverlap(cand.x, cand.z, cand.w, cand.d, c.x, c.z, c.w, c.d, 0.005))) continue
            // 不压走廊本身(支廊与带形走廊允许相贴)
            if (corridor.some((k) => rectsOverlap(cand.x, cand.z, cand.w, cand.d, k.x, k.z, k.w, k.d, 0.05))) continue
            const dist = Math.hypot(cand.x - orig.x, cand.z - orig.z)
            if (dist < bestDist) {
              bestDist = dist
              best = cand
            }
          }
        }
      }
      if (best) return best
    }
    // 终极兜底:网格扫描全楼找 2.2×2.2 合法格,追加连接支廊保证与走廊相邻
    for (let gz = bounds.minZ + 1.1; gz <= bounds.maxZ - 1.1; gz += 1) {
      for (let gx = bounds.minX + 1.1; gx <= bounds.maxX - 1.1; gx += 1) {
        if (!cellLegalInPolygon(poly, bounds, gx, gz, 2.2, 2.2, 0.35)) continue
        if (placed.some((c) => rectsOverlap(gx, gz, 2.2, 2.2, c.x, c.z, c.w, c.d, 0.005))) continue
        // 找最近走廊矩形,门开在朝向它的一侧,支廊把门边与走廊连起来
        let nearest: Rect | null = null
        let nd = Infinity
        for (const k of corridor) {
          const dd = Math.hypot(k.x - gx, k.z - gz)
          if (dd < nd) {
            nd = dd
            nearest = k
          }
        }
        if (!nearest) continue
        const dxr = nearest.x - gx
        const dzr = nearest.z - gz
        const cell: RoomCell =
          Math.abs(dxr) >= Math.abs(dzr)
            ? {
                roomId: orig.roomId, x: gx, z: gz, w: 2.2, d: 2.2,
                door: { x: gx + Math.sign(dxr) * 1.1, z: gz },
                side: dxr < 0 ? 'west' : 'east',
              }
            : {
                roomId: orig.roomId, x: gx, z: gz, w: 2.2, d: 2.2,
                door: { x: gx, z: gz + Math.sign(dzr) * 1.1 },
                side: dzr < 0 ? 'north' : 'south',
              }
        const spur: Rect =
          Math.abs(dxr) >= Math.abs(dzr)
            ? {
                x: (cell.door.x + nearest.x) / 2, z: gz,
                w: Math.abs(nearest.x - cell.door.x), d: Math.min(CORRIDOR_WIDTH, 2.2),
              }
            : {
                x: gx, z: (cell.door.z + nearest.z) / 2,
                w: Math.min(CORRIDOR_WIDTH, 2.2), d: Math.abs(nearest.z - cell.door.z),
              }
        corridor.push(spur)
        return cell
      }
    }
    // 理论上到不了(楼内必有空间):保留原 cell,宁越界不丢房
    return orig
  }

  cells.forEach((c, i) => {
    if (keep[i]) return
    const moved = relocate(c)
    placed.push(moved)
    result[i] = moved
  })
  return result
}

/** 计算某楼某层的平面布局(确定性;同一输入恒同输出) */
export function computeFloorLayout(
  building: BakedBuilding,
  rooms: Room[],
  floor: number,
): FloorLayout {
  const poly: Pt[] = building.footprint.map(([x, z]) => [x - building.center[0], z - building.center[1]])
  const xs = poly.map(([x]) => x)
  const zs = poly.map(([, z]) => z)
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

  // 弧形/非矩形楼走弧形布局;矩形/近矩形楼维持原算法(输出逐字节一致)
  if (isArcFootprint(poly)) {
    const inner = layoutArc(poly, bounds, floorRooms)
    return {
      floor,
      corridor: inner.corridor,
      cells: legalizeCellsToPolygon(poly, bounds, inner.corridor, inner.cells),
      cores: inner.cores,
      bounds,
      arc: inner.arc,
    }
  }

  const aspect = Math.max(W, D) / Math.min(W, D)
  const inner =
    aspect > LINEAR_ASPECT
      ? layoutLinear(bounds, floorRooms, W >= D)
      : layoutCompact(bounds, floorRooms)

  return {
    floor,
    corridor: inner.corridor,
    cells: legalizeCellsToPolygon(poly, bounds, inner.corridor, inner.cells),
    cores: inner.cores,
    bounds,
  }
}
