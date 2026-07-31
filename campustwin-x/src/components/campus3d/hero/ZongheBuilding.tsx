import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeroBuildingProps } from './HeroBuildings'

export const ZONGHE_ID = 'w561932273'
export const ZONGHE_FLOORS = 12

/* ------------------------------------------------------------------ */
/* 程序化玻璃幕墙贴图(本地 CanvasTexture,无外部资源):                   */
/* map = 日间立面(竖向分格窗 + 楼层横带),emissiveMap = 夜景亮窗          */
/* ------------------------------------------------------------------ */
export interface FacadeTextures {
  map: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
}

export interface FacadeOptions {
  cols?: number
  rows?: number
  /** 夜景亮窗比例 0..1 */
  litRatio?: number
  baseColor?: string
  windowColor?: string
  litColor?: string
  seed?: number
}

/** mulberry32 可复现随机(亮窗位置每次构建一致) */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fillFacadeCanvases(
  day: HTMLCanvasElement,
  night: HTMLCanvasElement,
  opts: Required<FacadeOptions>,
): void {
  const { cols, rows, litRatio, baseColor, windowColor, litColor, seed } = opts
  const rand = mulberry32(seed)
  const W = day.width
  const H = day.height
  const cw = W / cols
  const ch = H / rows

  const dctx = day.getContext('2d')
  const nctx = night.getContext('2d')
  if (!dctx || !nctx) throw new Error('Canvas 2D context unavailable')

  dctx.fillStyle = baseColor
  dctx.fillRect(0, 0, W, H)
  nctx.fillStyle = '#000000'
  nctx.fillRect(0, 0, W, H)

  for (let r = 0; r <= rows; r++) {
    dctx.fillStyle = 'rgba(230,238,244,0.10)' // 楼层线 = 贴图横带
    dctx.fillRect(0, Math.min(H - 2, Math.round(r * ch)), W, r === 0 || r === rows ? 2 : 1)
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.round(c * cw + 1.5)
      const y = Math.round(r * ch + 2.5)
      const w = Math.max(1, Math.round(cw - 3))
      const h = Math.max(1, Math.round(ch - 5))
      dctx.fillStyle = windowColor
      dctx.fillRect(x, y, w, h)
      if (rand() < litRatio) {
        nctx.globalAlpha = 0.55 + rand() * 0.45
        nctx.fillStyle = litColor
        nctx.fillRect(x, y, w, h)
      }
    }
  }
  nctx.globalAlpha = 1
}

/** 生成立面贴图对;调用方负责 dispose(本模块内由组件统一 dispose) */
export function makeFacadeTextures(options: FacadeOptions = {}): FacadeTextures {
  const opts: Required<FacadeOptions> = {
    cols: options.cols ?? 16,
    rows: options.rows ?? 2,
    litRatio: options.litRatio ?? 0.32,
    baseColor: options.baseColor ?? '#242c33',
    windowColor: options.windowColor ?? '#46555f',
    litColor: options.litColor ?? '#ffb45e',
    seed: options.seed ?? 20240117,
  }
  const day = document.createElement('canvas')
  day.width = 256
  day.height = 128
  const night = document.createElement('canvas')
  night.width = 256
  night.height = 128
  fillFacadeCanvases(day, night, opts)

  const map = new THREE.CanvasTexture(day)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const emissiveMap = new THREE.CanvasTexture(night)
  emissiveMap.wrapS = THREE.RepeatWrapping
  emissiveMap.wrapT = THREE.RepeatWrapping
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  emissiveMap.anisotropy = 4
  return { map, emissiveMap }
}

/* ------------------------------------------------------------------ */
/* 综合大楼(照片实证重建,2026-07 专项;同月透明 bug 修复 + 金字塔重建):   */
/* 真实形态 = 12 层弧形板楼(新月形平面,外弧朝北、内庭院朝南,             */
/* 西南带南翼),暖白横向窗带 + 顶层小方窗 + 深色百叶格栅冠顶               */
/* (两端加厚塔冠),内庭院中轴:12m 全透明玻璃金字塔(22m 底边,               */
/* 卢浮宫式四棱锥 + 白色菱形网格 + 环形喷泉,地下空间采光顶)+              */
/* 竖向中庭凹槽 + 地面层主入口 + 广场两翼曲面雨棚。墙体为内外               */
/* 双层立面(厚 0.42m,双面贴图),任何方位看都是实体楼。依据:               */
/* 校官网竣工通稿(51m/12F/塔高12m/四周喷泉)+ 虎扑实拍 / 官方黄昏航拍。   */
/* ------------------------------------------------------------------ */

const WALL_H = 48 // 12 层 × 4m(烘焙 height=48;官方总高 51m 含屋顶格栅)
const FLOOR_H = WALL_H / ZONGHE_FLOORS
const BAY_W = 3.6 // 开间模数(照片:等距白色壁柱 + 双联窗)
const PARAPET_TOP = 48.8 // 女儿墙顶
const SCREEN_H = 2.4 // 屋顶格栅基准高(顶 ≈ 51.2 ≈ 官方 51m)
const WALL_OUT = 0.06 // 墙面外挑,避免与屋顶板侧壁 z-fight
const WALL_THICK = 0.42 // 墙体厚度:内墙面内退量(侧/背面看不再是零厚度薄片)

/** 立面锚点(由 footprint 推得的局部坐标,减去 center 后使用) */
const ATRIUM_POS = new THREE.Vector2(36, -40) // 内弧中轴点(庭院侧)
// 庭院圆心:对内/外弧 footprint 最小二乘圆拟合的公共圆心 ≈ (32.9, 18.0),
// 内弧半径 58.4m(旧值 (28,13) 偏离拟合圆心约 7m,导致中轴歪斜)
const COURTYARD_C = new THREE.Vector2(32.9, 18)
const PYRAMID_FRONT = 25 // 金字塔中心距内弧立面 25m(航拍:塔身位于环行车道岛中央)
/** 金字塔位置:庭院圆心 → 中庭连线中轴上,内弧正前方 PYRAMID_FRONT 米处 */
const PYRAMID_POS = (() => {
  const axis = ATRIUM_POS.clone().sub(COURTYARD_C)
  const d = axis.length()
  return COURTYARD_C.clone().add(axis.multiplyScalar((d - PYRAMID_FRONT) / d))
})() // ≈ (34.7, -15.0)
/* 金字塔实测参数(校官微 + 虎扑实拍):塔高 12m 全透明玻璃采光顶,
   底边约 20–25m 取 22m,卢浮宫式四棱锥,坐于 0.9m 浅色实体基座上 */
const PYR_H = 12
const PYR_SIDE = 22
const PYR_R = PYR_SIDE / Math.SQRT2 // 四棱锥底面外接圆半径(角点半径)
const PYR_BASE_H = 0.9

/* ---------------- 弧形板楼立面贴图:1 开间(3.6m)× 全高(48m) ------------- */
function makeBandFacadeTextures(): FacadeTextures {
  const W = 256
  const H = 1024
  const day = document.createElement('canvas')
  day.width = W
  day.height = H
  const night = document.createElement('canvas')
  night.width = W
  night.height = H
  const d = day.getContext('2d')
  const n = night.getContext('2d')
  if (!d || !n) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(561932273)
  const pxM = H / WALL_H // 纵向像素/米 ≈ 21.3
  const yOf = (m: number) => H - m * pxM // 米(自墙根)→ 画布 y

  d.fillStyle = '#ece7dc' // 暖白墙体
  d.fillRect(0, 0, W, H)
  n.fillStyle = '#000000'
  n.fillRect(0, 0, W, H)

  const pier = Math.round(0.55 * (W / BAY_W)) // 壁柱 0.55m
  // 1–11 层:横向通长窗带(双联窗 + 中梃),窗台 1.15m、窗高 2.2m
  for (let f = 0; f < ZONGHE_FLOORS - 1; f++) {
    const yTop = yOf(f * FLOOR_H + 3.35)
    const yBot = yOf(f * FLOOR_H + 1.15)
    const h = yBot - yTop
    d.fillStyle = '#46525c' // 蓝灰玻璃(低饱和)
    d.fillRect(pier, yTop, W - pier * 2, h)
    d.fillStyle = '#3d4850' // 玻璃顶部阴影
    d.fillRect(pier, yTop, W - pier * 2, Math.max(2, Math.round(h * 0.14)))
    d.fillStyle = '#ece7dc' // 中梃(双联窗)
    d.fillRect(W / 2 - 1, yTop, 2, h)
    d.fillStyle = '#d8d2c4' // 窗台线
    d.fillRect(0, yBot, W, 2)
    d.fillStyle = 'rgba(120,112,96,0.35)' // 层间微阴影
    d.fillRect(0, yOf((f + 1) * FLOOR_H) - 1, W, 2)
    // 夜景亮窗(左右两联独立判定)
    for (const [x0, x1] of [
      [pier, W / 2 - 1],
      [W / 2 + 1, W - pier],
    ] as const) {
      if (rand() < 0.32) {
        n.globalAlpha = 0.5 + rand() * 0.45
        n.fillStyle = '#ffc27a'
        n.fillRect(x0, yTop, x1 - x0, h)
      }
    }
  }
  // 12 层(顶层):小方窗,藏于格栅冠顶之下
  {
    const yTop = yOf(11 * FLOOR_H + 2.55)
    const yBot = yOf(11 * FLOOR_H + 1.05)
    const h = yBot - yTop
    const wWin = Math.round(1.45 * (W / BAY_W))
    for (const cx of [Math.round(W * 0.25), Math.round(W * 0.75)]) {
      d.fillStyle = '#46525c'
      d.fillRect(cx - wWin / 2, yTop, wWin, h)
      if (rand() < 0.18) {
        n.globalAlpha = 0.45 + rand() * 0.4
        n.fillStyle = '#ffc27a'
        n.fillRect(cx - wWin / 2, yTop, wWin, h)
      }
    }
  }
  n.globalAlpha = 1

  const map = new THREE.CanvasTexture(day)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const emissiveMap = new THREE.CanvasTexture(night)
  emissiveMap.wrapS = THREE.RepeatWrapping
  emissiveMap.wrapT = THREE.RepeatWrapping
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  emissiveMap.anisotropy = 8
  return { map, emissiveMap }
}

/* ---------------- 屋顶深色百叶格栅贴图(横条纹) ---------------------- */
function makeScreenTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#2e3032'
  ctx.fillRect(0, 0, 64, 64)
  for (let y = 0; y < 64; y += 8) {
    ctx.fillStyle = '#494b4d' // 百叶板
    ctx.fillRect(0, y, 64, 4)
    ctx.fillStyle = '#1f2123' // 板间缝
    ctx.fillRect(0, y + 4, 64, 2)
  }
  ctx.fillStyle = 'rgba(70,72,74,0.6)' // 竖梃
  for (let x = 0; x < 64; x += 16) ctx.fillRect(x, 0, 2, 64)
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* ---------------- 中庭竖向凹槽贴图(深色玻璃 + 层间小窗) --------------- */
function makeAtriumTextures(): FacadeTextures {
  const W = 128
  const H = 512
  const day = document.createElement('canvas')
  day.width = W
  day.height = H
  const night = document.createElement('canvas')
  night.width = W
  night.height = H
  const d = day.getContext('2d')
  const n = night.getContext('2d')
  if (!d || !n) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(20260717)
  d.fillStyle = '#232a30'
  d.fillRect(0, 0, W, H)
  n.fillStyle = '#000'
  n.fillRect(0, 0, W, H)
  const rows = 12
  const ch = H / rows
  for (let r = 0; r < rows; r++) {
    const y = Math.round(r * ch + ch * 0.3)
    const h = Math.round(ch * 0.45)
    d.fillStyle = '#3d4a54'
    d.fillRect(6, y, W - 12, h)
    if (rand() < 0.4) {
      n.globalAlpha = 0.5 + rand() * 0.4
      n.fillStyle = '#ffc27a'
      n.fillRect(6, y, W - 12, h)
    }
  }
  n.globalAlpha = 1
  d.fillStyle = 'rgba(236,231,220,0.85)' // 白色边框(凹槽框)
  d.fillRect(0, 0, 3, H)
  d.fillRect(W - 3, 0, 3, H)
  const map = new THREE.CanvasTexture(day)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const emissiveMap = new THREE.CanvasTexture(night)
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  emissiveMap.anisotropy = 4
  return { map, emissiveMap }
}

/* ---------------- 金字塔金属网格贴图(透明底 + 白色菱形格) --------------- */
/* 调研:卢浮宫式全透明玻璃四棱锥 + 白色金属菱形网格 —— 网格只画线,        */
/* 玻璃本体由叠加的半透明材质呈现,两层错开 0.08m 避免共面 z-fight          */
function makePyramidTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.clearRect(0, 0, S, S) // 透明底:只保留白色菱形网格线
  ctx.strokeStyle = 'rgba(232,238,240,0.95)' // 白色金属网格
  ctx.lineWidth = 4
  const step = 32
  for (let i = -S; i < S * 2; i += step) {
    ctx.beginPath()
    ctx.moveTo(i, 0)
    ctx.lineTo(i + S, S)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(i + S, 0)
    ctx.lineTo(i, S)
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* ---------------- 金字塔玻璃贴图对(透明渐变 + 夜间内透辉光) ------------- */
/* 锥体 UV:uv.y=1 在锥顶、0 在底边 → 画布顶行对应锥顶。                   */
/* alphaMap 取绿色通道:锥顶更透(0.22)→ 底边略实(0.55),形成竖向透明渐变; */
/* emissiveMap 底亮顶暗,夜间呈现"自塔基向上渐隐"的内透蓝光。             */
function makePyramidGlassMaps(): { alphaMap: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const W = 64
  const H = 256
  const ac = document.createElement('canvas')
  ac.width = W
  ac.height = H
  const actx = ac.getContext('2d')
  const ec = document.createElement('canvas')
  ec.width = W
  ec.height = H
  const ectx = ec.getContext('2d')
  if (!actx || !ectx) throw new Error('Canvas 2D context unavailable')
  const ag = actx.createLinearGradient(0, 0, 0, H)
  ag.addColorStop(0, 'rgb(56,56,56)') // 锥顶 ≈ 0.22 不透明
  ag.addColorStop(1, 'rgb(140,140,140)') // 底边 ≈ 0.55 不透明
  actx.fillStyle = ag
  actx.fillRect(0, 0, W, H)
  const eg = ectx.createLinearGradient(0, 0, 0, H)
  eg.addColorStop(0, '#000000') // 锥顶不发光
  eg.addColorStop(0.55, '#0d3238')
  eg.addColorStop(1, '#bfeef8') // 塔基冰蓝辉光(低饱和,不偏紫)
  ectx.fillStyle = eg
  ectx.fillRect(0, 0, W, H)
  const alphaMap = new THREE.CanvasTexture(ac)
  const emissiveMap = new THREE.CanvasTexture(ec)
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  return { alphaMap, emissiveMap }
}

/* ---------------- 轮廓工具:局部化 + 线段表 -------------------------- */
interface WallSeg {
  x0: number
  z0: number
  x1: number
  z1: number
  len: number
  mx: number
  mz: number
  phi: number // rotateY 角(局部 +z → 外法线)
  nx: number // 外法线
  nz: number
}

function buildWallSegs(footprint: [number, number][], center: [number, number]): WallSeg[] {
  const pts = footprint.map(([x, z]) => ({ x: x - center[0], z: z - center[1] }))
  // 顶点质心(用于外法线定向:法线须背离质心)
  let cx = 0
  let cz = 0
  for (const p of pts) {
    cx += p.x
    cz += p.z
  }
  cx /= pts.length
  cz /= pts.length
  const segs: WallSeg[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.01) continue
    let phi = Math.atan2(-dz, dx)
    let nx = Math.sin(phi)
    let nz = Math.cos(phi)
    const mx = (a.x + b.x) / 2
    const mz = (a.z + b.z) / 2
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      phi += Math.PI // 翻转让 +z 朝外(贴图左右镜像,横带窗无碍)
      nx = Math.sin(phi)
      nz = Math.cos(phi)
    }
    segs.push({ x0: a.x, z0: a.z, x1: b.x, z1: b.z, len, mx, mz, phi, nx, nz })
  }
  return segs
}

/** 找离目标点最近的轮廓线段(内弧中庭定位用) */
function nearestSeg(segs: WallSeg[], p: THREE.Vector2): WallSeg {
  let best = segs[0]
  let bd = Infinity
  for (const s of segs) {
    const d = (s.mx - p.x) ** 2 + (s.mz - p.y) ** 2
    if (d < bd) {
      bd = d
      best = s
    }
  }
  return best
}

/* ------------------------------------------------------------------ */
/* 综合大楼                                                            */
/* ------------------------------------------------------------------ */
export default function ZongheBuilding({ building, nightFactor }: HeroBuildingProps) {
  const H = building.height || WALL_H

  /* 轮廓线段表(局部坐标) */
  const segs = useMemo(
    () => buildWallSegs(building.footprint as [number, number][], building.center as [number, number]),
    [building],
  )

  /* ① 弧形板楼墙体:每线段外墙面 + 内退 WALL_THICK 的内墙面(双面贴图), */
  /*    侧/背面看过去是有厚度感的实体楼,内弧庭院望外弧背面不再透明。      */
  /*    UV=米制,横带窗等密度绕弧                                          */
  const wallGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const s of segs) {
      // 外墙面:沿外法线外挑 WALL_OUT,规避与屋顶板侧壁共面
      const g = new THREE.PlaneGeometry(s.len, H)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * s.len, uv.getY(i) * H)
      g.translate(0, H / 2, 0)
      g.rotateY(s.phi)
      g.translate(s.mx + s.nx * WALL_OUT, 0, s.mz + s.nz * WALL_OUT)
      parts.push(g)
      // 内墙面:内退 WALL_THICK、法线朝内,复用同一立面贴图(镜像无碍横带窗)
      const gi = new THREE.PlaneGeometry(s.len, H)
      const uvi = gi.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uvi.count; i++) uvi.setXY(i, uvi.getX(i) * s.len, uvi.getY(i) * H)
      gi.translate(0, H / 2, 0)
      gi.rotateY(s.phi + Math.PI)
      gi.translate(s.mx - s.nx * WALL_THICK, 0, s.mz - s.nz * WALL_THICK)
      parts.push(gi)
    }
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [segs, H])

  /* ② 屋顶板(女儿墙压顶,footprint 拉伸 2m,顶面 48.8) */
  const roofGeometry = useMemo(() => {
    const pts = (building.footprint as [number, number][]).map(
      ([x, z]) => new THREE.Vector2(x - building.center[0], -(z - building.center[1])),
    )
    const shape = new THREE.Shape(pts)
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, PARAPET_TOP - 2, 0)
    return g
  }, [building])

  /* ③ 屋顶深色格栅冠顶:沿全轮廓内退 1.1m 环通 + 两端/中庭加厚塔冠 */
  const screenGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const s of segs) {
      const g = new THREE.BoxGeometry(Math.max(0.5, s.len - 0.4), SCREEN_H, 0.35)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (s.len / 2.2), uv.getY(i) * (SCREEN_H / 2.4))
      g.rotateY(s.phi)
      g.translate(s.mx - s.nx * 1.1, PARAPET_TOP + SCREEN_H / 2, s.mz - s.nz * 1.1)
      parts.push(g)
    }
    // 塔冠:西端 / 东端加厚(照片:两端深色塔帽明显拔高)
    const capAt = (target: THREE.Vector2, w: number, h: number) => {
      const s = nearestSeg(segs, target)
      const g = new THREE.BoxGeometry(w, h, 1.4)
      const uv = g.attributes.uv as THREE.BufferAttribute
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 2.2), uv.getY(i) * (h / 2.4))
      g.rotateY(s.phi)
      g.translate(s.mx - s.nx * 1.5, PARAPET_TOP + h / 2, s.mz - s.nz * 1.5)
      parts.push(g)
    }
    capAt(new THREE.Vector2(-44.9, 11), 16, 3.8) // 西端塔冠
    capAt(new THREE.Vector2(70, -41), 16, 3.8) // 东端塔冠
    capAt(ATRIUM_POS, 13, 3.2) // 中庭上方(庭院侧照片中可见)
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [segs])

  /* ④ 内庭院中轴:中庭竖向凹槽(深色玻璃,8m 宽,3F–12F) */
  const atriumGeometry = useMemo(() => {
    const s = nearestSeg(segs, ATRIUM_POS)
    const g = new THREE.PlaneGeometry(9, 36)
    g.rotateY(s.phi)
    g.translate(s.mx + s.nx * 0.15, 26, s.mz + s.nz * 0.15)
    return g
  }, [segs])

  /* ④b 主入口凹槽(地面层,中庭正下方;航拍/hupu-2:内弧中轴底部         */
  /*    为通高深色玻璃入口,夜间亮灯)——比墙面外挑 0.12,覆于立面之上      */
  const entranceGeometry = useMemo(() => {
    const s = nearestSeg(segs, ATRIUM_POS)
    const g = new THREE.PlaneGeometry(13, 7.4)
    g.rotateY(s.phi)
    g.translate(s.mx + s.nx * 0.12, 3.7, s.mz + s.nz * 0.12)
    return g
  }, [segs])

  /* ⑤ 玻璃金字塔重建(调研:塔高 12m 全透明玻璃采光顶、底边约 22m、      */
  /*    白色菱形金属网格、0.9m 浅色实体基座、四周环喷泉;                  */
  /*    位于内弧凹面正前方圆形广场中轴 —— 庭院圆心→中庭连线上)             */
  // 锥体朝向:一个棱面正对中庭(底边与内弧立面平行)
  const pyramidAngle = useMemo(() => {
    const axis = ATRIUM_POS.clone().sub(COURTYARD_C) // 庭院圆心 → 中庭
    return Math.PI / 4 + Math.atan2(axis.x, axis.y)
  }, [])
  // 全透明蓝绿玻璃锥体(12m 高 / 22m 底边,卢浮宫式四棱锥)
  const pyramidGlassGeometry = useMemo(() => {
    const g = new THREE.ConeGeometry(PYR_R, PYR_H, 4, 1)
    g.rotateY(pyramidAngle)
    g.translate(PYRAMID_POS.x, PYR_BASE_H + PYR_H / 2, PYRAMID_POS.y)
    return g
  }, [pyramidAngle])
  // 白色金属菱形网格层:比玻璃面外扩 0.08m,避免共面 z-fight
  const pyramidGridGeometry = useMemo(() => {
    const g = new THREE.ConeGeometry(PYR_R + 0.08, PYR_H, 4, 1)
    g.rotateY(pyramidAngle)
    g.translate(PYRAMID_POS.x, PYR_BASE_H + PYR_H / 2, PYRAMID_POS.y)
    return g
  }, [pyramidAngle])
  // 夜间内透辉光核(塔内地下空间柔光,白天近乎不可见)
  const pyramidGlowGeometry = useMemo(() => {
    const g = new THREE.ConeGeometry(PYR_R * 0.55, PYR_H * 0.55, 4, 1)
    g.rotateY(pyramidAngle)
    g.translate(PYRAMID_POS.x, PYR_BASE_H + (PYR_H * 0.55) / 2, PYRAMID_POS.y)
    return g
  }, [pyramidAngle])
  // 浅色实体基座(虎扑实拍:底边坐在低矮浅色基座上)
  const pyramidBaseGeometry = useMemo(() => {
    const g = new THREE.BoxGeometry(PYR_SIDE + 1.4, PYR_BASE_H, PYR_SIDE + 1.4)
    g.rotateY(pyramidAngle)
    g.translate(PYRAMID_POS.x, PYR_BASE_H / 2, PYRAMID_POS.y)
    return g
  }, [pyramidAngle])
  // 环形喷泉(校官微"塔的四周是喷泉"):浅蓝水面环 + 浅色池缘
  const fountainWaterGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(17.6, 20.0, 64)
    g.rotateX(-Math.PI / 2)
    g.translate(PYRAMID_POS.x, 0.12, PYRAMID_POS.y)
    return g
  }, [])
  const fountainCurbGeometry = useMemo(() => {
    const g = new THREE.RingGeometry(20.0, 20.9, 64)
    g.rotateX(-Math.PI / 2)
    g.translate(PYRAMID_POS.x, 0.17, PYRAMID_POS.y)
    return g
  }, [])
  const roofPyramidGeometry = useMemo(() => {
    // 北侧外弧中点屋顶小天窗(远景照片中屋顶中央的深色小锥)
    const s = nearestSeg(segs, new THREE.Vector2(39.6, -61.2))
    const g = new THREE.ConeGeometry(2.8, 2.6, 4, 1)
    g.rotateY(Math.PI / 4 + s.phi)
    g.translate(s.mx - s.nx * 3, PARAPET_TOP + 1.3, s.mz - s.nz * 3)
    return g
  }, [segs])

  /* ⑥ 两翼曲面雨棚(白色壳体;金字塔重建放大后外移至喷泉环之外、        */
  /*    广场两侧 —— 对应黄昏航拍中环形车道外缘的一对白色壳体)             */
  const canopyGeometry = useMemo(() => {
    const axis = ATRIUM_POS.clone().sub(COURTYARD_C).normalize()
    const tangent = new THREE.Vector2(-axis.y, axis.x)
    const parts: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      const cxp = PYRAMID_POS.x + axis.x * 2 + tangent.x * 25.5 * side
      const czp = PYRAMID_POS.y + axis.y * 2 + tangent.y * 25.5 * side
      const g = new THREE.CylinderGeometry(4.5, 4.5, 8, 12, 1, true, side > 0 ? 0.2 : Math.PI - 1.7, 1.5)
      g.rotateZ(Math.PI / 2) // 筒轴放平(沿 x)
      g.rotateY(Math.atan2(-tangent.y, tangent.x))
      g.translate(cxp, 4.6, czp)
      parts.push(g)
    }
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [])

  /* 贴图与材质 */
  const facade = useMemo(() => {
    const t = makeBandFacadeTextures()
    t.map.repeat.set(1 / BAY_W, 1 / H)
    t.emissiveMap.repeat.set(1 / BAY_W, 1 / H)
    return t
  }, [H])
  const screenTexture = useMemo(() => makeScreenTexture(), [])
  const atriumTex = useMemo(() => makeAtriumTextures(), [])
  // 菱形网格:底周长约 88m,repeat.x=4 → 网格单元 ≈ 2.75m(近卢浮宫分格尺度)
  const pyramidTexture = useMemo(() => {
    const t = makePyramidTexture()
    t.repeat.set(4, 1)
    return t
  }, [])
  const pyramidGlassMaps = useMemo(() => makePyramidGlassMaps(), [])

  const wallMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: facade.map,
        emissiveMap: facade.emissiveMap,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0,
        roughness: 0.72,
        metalness: 0.06,
        // 双面渲染:配合内墙面几何,任何方位看过去都是实体楼(修侧面/背面透明)
        side: THREE.DoubleSide,
      }),
    [facade],
  )
  const roofMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d8d3c8',
        roughness: 0.85,
        metalness: 0.05,
        side: THREE.DoubleSide, // 保险:拉伸体侧壁/底面任何朝向不消失
      }),
    [],
  )
  const screenMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: screenTexture,
        color: '#b9b9bb',
        roughness: 0.6,
        metalness: 0.35,
      }),
    [screenTexture],
  )
  const atriumMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: atriumTex.map,
        emissiveMap: atriumTex.emissiveMap,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0,
        roughness: 0.35,
        metalness: 0.5,
        side: THREE.DoubleSide, // 中庭/入口凹槽玻璃双面可见
      }),
    [atriumTex],
  )
  // 金字塔玻璃:蓝绿 tinted 全透明 + 竖向透明渐变(alphaMap)+ 夜间内透辉光(emissiveMap)
  const pyramidGlassMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#a9d4da', // 低饱和蓝绿玻璃
        transparent: true,
        alphaMap: pyramidGlassMaps.alphaMap,
        opacity: 1, // 不透明度由 alphaMap 渐变控制(锥顶 0.22 → 底边 0.55)
        roughness: 0.08,
        metalness: 0.05,
        side: THREE.DoubleSide,
        depthWrite: false, // 透明体不写深度,避免与网格层互相遮挡排序错误
        emissive: new THREE.Color('#9fe0f0'),
        emissiveMap: pyramidGlassMaps.emissiveMap,
        emissiveIntensity: 0.05,
      }),
    [pyramidGlassMaps],
  )
  // 白色金属菱形网格(透明底贴图,只渲染网格线)
  const pyramidGridMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: pyramidTexture,
        transparent: true,
        roughness: 0.35,
        metalness: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
        emissive: new THREE.Color('#e8f0f2'),
        emissiveIntensity: 0.04,
      }),
    [pyramidTexture],
  )
  // 夜间内透辉光核(无光照纯发光,白天近不可见)
  const pyramidGlowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#8fd8ec',
        transparent: true,
        opacity: 0.04,
        depthWrite: false,
      }),
    [],
  )
  const pyramidBaseMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#d9d2c2', roughness: 0.8, metalness: 0.04 }),
    [],
  )
  // 喷泉浅蓝水面(夜间微光)
  const fountainWaterMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#8fc3d4',
        transparent: true,
        opacity: 0.72,
        roughness: 0.15,
        metalness: 0.05,
        emissive: new THREE.Color('#4a96ac'),
        emissiveIntensity: 0.05,
      }),
    [],
  )
  const fountainCurbMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cfc8b8', roughness: 0.85, metalness: 0.03 }),
    [],
  )
  const canopyMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e6e1d6',
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    [],
  )

  useFrame(() => {
    const n = THREE.MathUtils.clamp(nightFactor, 0, 1)
    wallMaterial.emissiveIntensity = 0.04 + n * 1.2
    atriumMaterial.emissiveIntensity = 0.03 + n * 1.0
    // 金字塔夜间微发光保留并强化:玻璃内透蓝光 + 塔内辉光核淡入(黄昏航拍效果)
    pyramidGlassMaterial.emissiveIntensity = 0.05 + n * 0.85
    pyramidGridMaterial.emissiveIntensity = 0.04 + n * 0.18
    pyramidGlowMaterial.opacity = 0.04 + n * 0.42
    fountainWaterMaterial.emissiveIntensity = 0.05 + n * 0.35
  })

  useEffect(
    () => () => {
      wallGeometry.dispose()
      roofGeometry.dispose()
      screenGeometry.dispose()
      atriumGeometry.dispose()
      entranceGeometry.dispose()
      pyramidGlassGeometry.dispose()
      pyramidGridGeometry.dispose()
      pyramidGlowGeometry.dispose()
      pyramidBaseGeometry.dispose()
      fountainWaterGeometry.dispose()
      fountainCurbGeometry.dispose()
      roofPyramidGeometry.dispose()
      canopyGeometry.dispose()
      facade.map.dispose()
      facade.emissiveMap.dispose()
      screenTexture.dispose()
      atriumTex.map.dispose()
      atriumTex.emissiveMap.dispose()
      pyramidTexture.dispose()
      pyramidGlassMaps.alphaMap.dispose()
      pyramidGlassMaps.emissiveMap.dispose()
      wallMaterial.dispose()
      roofMaterial.dispose()
      screenMaterial.dispose()
      atriumMaterial.dispose()
      pyramidGlassMaterial.dispose()
      pyramidGridMaterial.dispose()
      pyramidGlowMaterial.dispose()
      pyramidBaseMaterial.dispose()
      fountainWaterMaterial.dispose()
      fountainCurbMaterial.dispose()
      canopyMaterial.dispose()
    },
    [
      wallGeometry,
      roofGeometry,
      screenGeometry,
      atriumGeometry,
      entranceGeometry,
      pyramidGlassGeometry,
      pyramidGridGeometry,
      pyramidGlowGeometry,
      pyramidBaseGeometry,
      fountainWaterGeometry,
      fountainCurbGeometry,
      roofPyramidGeometry,
      canopyGeometry,
      facade,
      screenTexture,
      atriumTex,
      pyramidTexture,
      pyramidGlassMaps,
      wallMaterial,
      roofMaterial,
      screenMaterial,
      atriumMaterial,
      pyramidGlassMaterial,
      pyramidGridMaterial,
      pyramidGlowMaterial,
      pyramidBaseMaterial,
      fountainWaterMaterial,
      fountainCurbMaterial,
      canopyMaterial,
    ],
  )

  return (
    <group name="zonghe" position={[building.center[0], 0, building.center[1]]}>
      {/* 弧形板楼(12 层横带窗) */}
      <mesh geometry={wallGeometry} material={wallMaterial} name="zonghe-wall" />
      {/* 屋顶板 + 女儿墙压顶 */}
      <mesh geometry={roofGeometry} material={roofMaterial} />
      {/* 深色百叶格栅冠顶(两端塔冠) */}
      <mesh geometry={screenGeometry} material={screenMaterial} />
      {/* 庭院中庭凹槽 + 地面层主入口 */}
      <mesh geometry={atriumGeometry} material={atriumMaterial} />
      <mesh geometry={entranceGeometry} material={atriumMaterial} name="zonghe-entrance" />
      {/* 玻璃金字塔:基座 → 辉光核 → 玻璃 → 网格(透明层按 renderOrder 排序) */}
      <mesh geometry={pyramidBaseGeometry} material={pyramidBaseMaterial} name="zonghe-pyramid-base" />
      <mesh geometry={pyramidGlowGeometry} material={pyramidGlowMaterial} renderOrder={9} />
      <mesh
        geometry={pyramidGlassGeometry}
        material={pyramidGlassMaterial}
        name="zonghe-pyramid-glass"
        renderOrder={10}
      />
      <mesh geometry={pyramidGridGeometry} material={pyramidGridMaterial} renderOrder={11} />
      {/* 环形喷泉水面 + 池缘 */}
      <mesh geometry={fountainWaterGeometry} material={fountainWaterMaterial} name="zonghe-fountain" />
      <mesh geometry={fountainCurbGeometry} material={fountainCurbMaterial} />
      {/* 屋顶小天窗(同款玻璃) */}
      <mesh geometry={roofPyramidGeometry} material={pyramidGlassMaterial} renderOrder={10} />
      {/* 广场两侧曲面雨棚 */}
      <mesh geometry={canopyGeometry} material={canopyMaterial} />
    </group>
  )
}
