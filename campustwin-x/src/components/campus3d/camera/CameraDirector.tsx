// CameraDirector —— 运镜导演:监听 campusStore.cameraFocus / scanTrigger,
// 用阻尼插值把相机送到目标位,到位后交还 OrbitControls。
// 所有权通过 CameraRig 的 CameraBus 仲裁;锁定期用户输入由 CameraRig 全局打断。
import { useEffect, useRef } from 'react'
import { DEPLOY_BASE } from '../../../lib/deployBase'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useCampusStore } from '../../../store/campusStore'
import type { CameraFocus, Room } from '../../../lib/agentTypes'
import type { BakedBuilding } from '../../../lib/campusData'
import { computeFloorLayout } from '../../../lib/floorLayout'
import type { CameraBusRef, OrbitControlsRef } from './CameraRig'

// ---------- 自写数学工具(不用库) ----------
/** 帧率无关的指数阻尼系数 */
export function dampFactor(lambda: number, dt: number): number {
  return 1 - Math.exp(-lambda * dt)
}
/** 标量阻尼插值 */
export function expDamp(cur: number, target: number, lambda: number, dt: number): number {
  return cur + (target - cur) * dampFactor(lambda, dt)
}
/** 向量阻尼插值(写入 out,返回 out) */
export function dampV3(out: THREE.Vector3, target: THREE.Vector3, lambda: number, dt: number): THREE.Vector3 {
  const k = dampFactor(lambda, dt)
  out.x += (target.x - out.x) * k
  out.y += (target.y - out.y) * k
  out.z += (target.z - out.z) * k
  return out
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// ---------- 常量 ----------
/** 全景机位(指挥中心默认斜视视角;TourCruise 返校落幅与各兜底分支复用,勿改为俯视) */
export const OVERVIEW_POS = new THREE.Vector3(420, 480, 620)
export const OVERVIEW_TARGET = new THREE.Vector3(40, 0, -80)
/**
 * 校园全局「正上方俯视」机位(campus 聚焦 / 态势扫描专用,看地图视角)。
 * 高度推算:fov=42°(CampusCanvas),垂直覆盖 = 2·h·tan(21°) ≈ 0.768h;
 * 覆盖全校南北 1.1km 需 h ≥ 550/tan(21°) ≈ 1432m,取 1450m 留边距
 * (此时东西覆盖 ≈ 1.365h ≈ 1980m > 1.4km,富余;maxDistance=2200、far=6000 均兼容)。
 * 注视点 = 校园中心 (40, 0, -80)。
 * 防万向锁:相机自正北微偏 2.5°(z 向南为正,北 = -z),
 * 水平偏移 = 1450·tan(2.5°) ≈ 63m,观感仍为正俯视地图、上北下南,
 * 同时 OrbitControls up=+Y 不与视线共线。
 */
export const TOPDOWN_POS = new THREE.Vector3(40, 1450, -143)
export const TOPDOWN_TARGET = new THREE.Vector3(40, 0, -80)
/** 校园中心(用于推算"楼前方"朝向) */
const CAMPUS_CENTER = new THREE.Vector2(40, -80)

const DEG = Math.PI / 180
const BUILDING_DIST = 120
const BUILDING_PITCH = 35 * DEG
const ROUTE_ALTITUDE = 90
const ROUTE_SPEED = 60 // m/s

// ---------- M4 房间级三段式定位运镜参数 ----------
/** 与 BuildingSlice 的爆炸展开约定一致(EXPAND_GAP=2.2,他人组件,此处只读镜像) */
const SLICE_EXPAND_GAP = 2.2
/** 段①:飞向目标楼上空(楼宇全貌)时长 */
const LOCATE_S1_DUR = 1.2
/** 段②:悬停至建筑西侧偏上 45° 俯瞰位时长 */
const LOCATE_S2_DUR = 1.0
/** 段②后等待分层爆炸动画沉降时长 */
const LOCATE_SETTLE_DUR = 1.0
/** 段③:下降到目标楼层、推近房间特写时长 */
const LOCATE_S3_DUR = 1.3
/** 特写距离 = 房间面宽 × 该倍数(限幅 12~48m) */
const LOCATE_CLOSEUP_MULT = 3.5
/** 特写俯角 */
const LOCATE_CLOSEUP_PITCH = 40 * DEG

// ---------- 道路数据(route 运镜用,本地 public 数据,懒加载+缓存) ----------
interface RoadShape { id: string; points: [number, number][] }
let roadsCache: Promise<RoadShape[]> | null = null
function loadRoads(): Promise<RoadShape[]> {
  if (!roadsCache) {
    roadsCache = fetch(`${DEPLOY_BASE}data/campus/roads.json`)
      .then((r) => r.json())
      .then((d: { roads?: RoadShape[] }) => d.roads ?? [])
      .catch(() => [])
  }
  return roadsCache
}

// ---------- 飞行状态 ----------
interface PointFlight {
  kind: 'point'
  t: number
  duration: number
  fromPos: THREE.Vector3
  fromTgt: THREE.Vector3
  toPos: THREE.Vector3
  toTgt: THREE.Vector3
}
interface RouteFlight {
  kind: 'route'
  t: number
  duration: number
  curve: THREE.CatmullRomCurve3
}
/** 序列运镜的一段;toPos 为 null 表示悬停段(保持上一目标,等待分层沉降) */
interface SeqLeg {
  t: number
  duration: number
  fromPos: THREE.Vector3
  fromTgt: THREE.Vector3
  toPos: THREE.Vector3 | null
  toTgt: THREE.Vector3 | null
  onStart?: () => void
}
/** 房间级三段式定位运镜 */
interface SeqFlight {
  kind: 'seq'
  roomId: string
  i: number
  legs: SeqLeg[]
}
type Flight = PointFlight | RouteFlight | SeqFlight

export interface CameraDirectorProps {
  bus: CameraBusRef
  controlsRef: OrbitControlsRef
}

/** "楼前方"水平朝向:从校园中心指向楼,接近中心时取东南向默认 */
function approachDir(x: number, z: number): THREE.Vector2 {
  const d = new THREE.Vector2(x - CAMPUS_CENTER.x, z - CAMPUS_CENTER.y)
  if (d.lengthSq() < 1) d.set(0.6, 0.8)
  return d.normalize()
}

function buildingFlight(b: BakedBuilding, fromPos: THREE.Vector3, fromTgt: THREE.Vector3): PointFlight {
  const [x, z] = b.center
  const dir = approachDir(x, z)
  const target = new THREE.Vector3(x, Math.max(b.height * 0.6, 8), z)
  const pos = new THREE.Vector3(
    x + dir.x * BUILDING_DIST,
    target.y + BUILDING_DIST * Math.tan(BUILDING_PITCH),
    z + dir.y * BUILDING_DIST,
  )
  return { kind: 'point', t: 0, duration: 2.2, fromPos, fromTgt, toPos: pos, toTgt: target }
}

function overviewFlight(fromPos: THREE.Vector3, fromTgt: THREE.Vector3, duration = 2.4): PointFlight {
  return {
    kind: 'point', t: 0, duration,
    fromPos, fromTgt,
    toPos: OVERVIEW_POS.clone(), toTgt: OVERVIEW_TARGET.clone(),
  }
}

/** 正上方俯视飞行:campus 聚焦 / 态势扫描专用(看地图视角) */
function topdownFlight(fromPos: THREE.Vector3, fromTgt: THREE.Vector3, duration = 2.4): PointFlight {
  return {
    kind: 'point', t: 0, duration,
    fromPos, fromTgt,
    toPos: TOPDOWN_POS.clone(), toTgt: TOPDOWN_TARGET.clone(),
  }
}

/**
 * M4 房间级三段式定位运镜:
 * ① 楼上空楼宇全貌(1.2s)→ ② 西侧偏上 45° 俯瞰位 + 触发分层剖切(1.0s)
 * → 悬停等爆炸动画沉降(1.0s)→ ③ 下降到目标楼层,推近房间单元格斜上方特写(1.3s)。
 * 全程 easeInOutCubic;坐标 = floorLayout 单元格(局部)+ building.center。
 */
function roomLocateFlight(
  room: Room,
  b: BakedBuilding,
  buildingRooms: Room[],
  fromPos: THREE.Vector3,
  fromTgt: THREE.Vector3,
  ensureSlice: () => void,
): SeqFlight {
  const [bx, bz] = b.center
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [fx, fz] of b.footprint) {
    if (fx < minX) minX = fx
    if (fx > maxX) maxX = fx
    if (fz < minZ) minZ = fz
    if (fz > maxZ) maxZ = fz
  }
  const maxDim = Math.max(maxX - minX, maxZ - minZ, b.height, 12)
  const levels = Math.max(b.levels, 1)
  const slabH = b.height / levels
  // 剖切展开后,目标层楼板顶面高度(与 BuildingSlice floorLift 同一约定)
  const fIdx = Math.min(Math.max(room.floor, 1), levels)
  const floorY = (fIdx - 1) * (slabH + SLICE_EXPAND_GAP) + slabH

  // M4 契约:floorLayout 单元格(局部米制)→ 世界坐标
  const cell = computeFloorLayout(b, buildingRooms, room.floor).cells.find((c) => c.roomId === room.id) ?? null
  const cx = bx + (cell ? cell.x : 0)
  const cz = bz + (cell ? cell.z : 0)
  const faceW = cell ? Math.max(cell.w, cell.d) : 7.2

  // 特写机位方位:从房门(走廊侧)斜上方看进房间;门向量退化时取西侧
  const doorDir = new THREE.Vector2(cell ? cell.door.x - cell.x : -1, cell ? cell.door.z - cell.z : 0)
  if (doorDir.lengthSq() < 1e-4) doorDir.set(-1, 0)
  doorDir.normalize()

  // 段① 目标楼上空,俯瞰楼宇全貌
  const s1Pos = new THREE.Vector3(bx, b.height + maxDim * 1.25 + 16, bz + maxDim * 0.14)
  const s1Tgt = new THREE.Vector3(bx, b.height * 0.45, bz)
  // 段② 建筑西侧偏上 45° 俯瞰位(水平距离=垂直高差 → 俯角 45°)
  const hd = maxDim * 1.5
  const s2Pos = new THREE.Vector3(bx - hd, b.height * 0.5 + hd, bz)
  const s2Tgt = new THREE.Vector3(bx, b.height * 0.5, bz)
  // 段③ 房间单元格特写:距离≈面宽 3.5 倍,注视点=cell 中心
  const dist = Math.min(48, Math.max(12, faceW * LOCATE_CLOSEUP_MULT))
  const s3Tgt = new THREE.Vector3(cx, floorY, cz)
  const s3Pos = new THREE.Vector3(
    cx + doorDir.x * dist * Math.cos(LOCATE_CLOSEUP_PITCH),
    floorY + dist * Math.sin(LOCATE_CLOSEUP_PITCH),
    cz + doorDir.y * dist * Math.cos(LOCATE_CLOSEUP_PITCH),
  )

  const leg = (
    duration: number,
    fp: THREE.Vector3,
    ft: THREE.Vector3,
    tp: THREE.Vector3 | null,
    tt: THREE.Vector3 | null,
    onStart?: () => void,
  ): SeqLeg => ({ t: 0, duration, fromPos: fp, fromTgt: ft, toPos: tp, toTgt: tt, onStart })

  return {
    kind: 'seq',
    roomId: room.id,
    i: 0,
    legs: [
      leg(LOCATE_S1_DUR, fromPos, fromTgt, s1Pos, s1Tgt),
      leg(LOCATE_S2_DUR, s1Pos, s1Tgt, s2Pos, s2Tgt, ensureSlice),
      leg(LOCATE_SETTLE_DUR, s2Pos, s2Tgt, null, null), // 悬停,等分层爆炸动画沉降
      leg(LOCATE_S3_DUR, s2Pos, s2Tgt, s3Pos, s3Tgt),
    ],
  }
}

export default function CameraDirector({ bus, controlsRef }: CameraDirectorProps) {
  const camera = useThree((s) => s.camera)
  const cameraFocus = useCampusStore((s) => s.cameraFocus)
  const scanTrigger = useCampusStore((s) => s.scanTrigger)
  const flightRef = useRef<Flight | null>(null)
  const goalPos = useRef(new THREE.Vector3())
  const goalTgt = useRef(new THREE.Vector3())
  const lastScanRef = useRef(0)

  const tryStart = (f: Flight) => {
    if (bus.current.owner !== null) return false // 首屏/巡航占用中,飞行挂起等待
    bus.current.owner = 'director'
    const c = controlsRef.current
    if (c) c.enabled = false
    flightRef.current = f
    return true
  }

  /** 房间定位序列:导演已在飞(如上一次定位)时直接抢占重定向;否则走正常仲裁 */
  const tryStartSeq = (f: SeqFlight) => {
    if (bus.current.owner === 'director') {
      flightRef.current = f
      return true
    }
    return tryStart(f)
  }

  const currentAnchors = () => {
    const c = controlsRef.current
    return {
      pos: camera.position.clone(),
      tgt: c ? c.target.clone() : OVERVIEW_TARGET.clone(),
    }
  }

  // scanTrigger:先拉全景(正上方俯视,看地图视角)
  useEffect(() => {
    if (scanTrigger <= 0 || scanTrigger === lastScanRef.current) return
    lastScanRef.current = scanTrigger
    const a = currentAnchors()
    tryStart(topdownFlight(a.pos, a.tgt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTrigger])

  // cameraFocus:building / room / campus / route
  useEffect(() => {
    if (!cameraFocus) return
    const focus: CameraFocus = cameraFocus
    const a = currentAnchors()
    const finish = () => useCampusStore.getState().focusCamera(null)

    if (focus.type === 'campus') {
      // 「校园概览/态势」→ 正上方俯视全局(看地图视角)
      if (tryStart(topdownFlight(a.pos, a.tgt))) finish()
      return
    }
    if (focus.type === 'building') {
      const b = useCampusStore.getState().buildings.find((x) => x.id === focus.id)
      const f = b ? buildingFlight(b, a.pos, a.tgt) : overviewFlight(a.pos, a.tgt)
      if (tryStart(f)) finish()
      return
    }
    if (focus.type === 'room') {
      const state = useCampusStore.getState()
      const room = state.rooms.find((x) => x.id === focus.id)
      const b = room ? state.buildings.find((x) => x.id === room.buildingId) : undefined
      if (room && b) {
        const buildingRooms = state.rooms.filter((r) => r.buildingId === b.id)
        // 段②开始时确保该楼已分层剖切(他人组件 BuildingSlice 负责展开动画)
        const ensureSlice = () => {
          const s = useCampusStore.getState()
          if (s.slicedBuildingId !== b.id) s.setSlicedBuilding(b.id)
        }
        const f = roomLocateFlight(room, b, buildingRooms, a.pos, a.tgt, ensureSlice)
        // 序列期间不调 finish():locatingRoomId 需保留到运镜结束/被打断时统一清除
        if (tryStartSeq(f)) return
      } else {
        tryStart(overviewFlight(a.pos, a.tgt))
      }
      finish() // 数据缺失或总线被占:清掉"正在定位"态,避免 UI 卡 loading
      return
    }
    // route:沿道路曲线飞行(本地 roads.json,懒加载)
    let cancelled = false
    void loadRoads().then((roads) => {
      if (cancelled) return
      const road = roads.find((r) => r.id === focus.id && r.points.length >= 2)
      if (!road) {
        if (tryStart(overviewFlight(a.pos, a.tgt))) finish()
        return
      }
      const pts = road.points.map(([x, z]) => new THREE.Vector3(x, ROUTE_ALTITUDE, z))
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5)
      const len = curve.getLength()
      const duration = Math.min(30, Math.max(6, len / ROUTE_SPEED))
      if (tryStart({ kind: 'route', t: 0, duration, curve })) finish()
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraFocus])

  useFrame((_, dt) => {
    const f = flightRef.current
    if (!f) return
    // 被打断(用户输入/首屏抢占):放弃飞行,柔和停留在当前机位
    if (bus.current.owner !== 'director') {
      if (f.kind === 'seq') useCampusStore.getState().focusCamera(null) // 定位中断 → 清"正在定位"态
      flightRef.current = null
      return
    }
    const c = controlsRef.current

    // 房间级三段式定位序列
    if (f.kind === 'seq') {
      const leg = f.legs[f.i]
      leg.t = clamp01(leg.t + dt / leg.duration)
      if (leg.toPos && leg.toTgt) {
        const e = easeInOutCubic(leg.t)
        goalPos.current.set(
          lerp(leg.fromPos.x, leg.toPos.x, e),
          lerp(leg.fromPos.y, leg.toPos.y, e),
          lerp(leg.fromPos.z, leg.toPos.z, e),
        )
        goalTgt.current.set(
          lerp(leg.fromTgt.x, leg.toTgt.x, e),
          lerp(leg.fromTgt.y, leg.toTgt.y, e),
          lerp(leg.fromTgt.z, leg.toTgt.z, e),
        )
      }
      // 悬停段:goal 保持上一段目标,相机继续阻尼收敛
      dampV3(camera.position, goalPos.current, 6, dt)
      if (c) {
        dampV3(c.target, goalTgt.current, 6, dt)
        c.update()
      } else {
        camera.lookAt(goalTgt.current)
      }
      const isLast = f.i === f.legs.length - 1
      const arrived = leg.toPos
        ? camera.position.distanceTo(goalPos.current) < (isLast ? 1.0 : 2.5)
        : true
      if (leg.t >= 1 && arrived) {
        if (!isLast) {
          f.i += 1
          f.legs[f.i].onStart?.()
        } else {
          flightRef.current = null
          bus.current.owner = null
          if (c) {
            c.enabled = true
            c.update()
          }
          useCampusStore.getState().focusCamera(null) // 定位完成 → 清"正在定位"态
        }
      }
      return
    }

    f.t = clamp01(f.t + dt / f.duration)

    if (f.kind === 'point') {
      const e = easeInOutCubic(f.t)
      goalPos.current.set(
        lerp(f.fromPos.x, f.toPos.x, e),
        lerp(f.fromPos.y, f.toPos.y, e),
        lerp(f.fromPos.z, f.toPos.z, e),
      )
      goalTgt.current.set(
        lerp(f.fromTgt.x, f.toTgt.x, e),
        lerp(f.fromTgt.y, f.toTgt.y, e),
        lerp(f.fromTgt.z, f.toTgt.z, e),
      )
    } else {
      // route:沿路径前进,注视点前移
      f.curve.getPointAt(f.t, goalPos.current)
      f.curve.getPointAt(clamp01(f.t + 0.06), goalTgt.current)
      goalTgt.current.y = ROUTE_ALTITUDE * 0.4
    }

    dampV3(camera.position, goalPos.current, 6, dt)
    if (c) {
      dampV3(c.target, goalTgt.current, 6, dt)
      c.update()
    } else {
      camera.lookAt(goalTgt.current)
    }

    // 到位判定:时间走完且位置基本收敛
    if (f.t >= 1 && camera.position.distanceTo(goalPos.current) < 1.5) {
      flightRef.current = null
      bus.current.owner = null
      if (c) {
        c.enabled = true
        c.update()
      }
    }
  })

  return null
}
