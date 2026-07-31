// CameraDirector —— 运镜导演:监听 campusStore.cameraFocus / scanTrigger,
// 用阻尼插值把相机送到目标位,到位后交还 OrbitControls。
// 所有权通过 CameraRig 的 CameraBus 仲裁;锁定期用户输入由 CameraRig 全局打断。
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useCampusStore } from '../../../store/campusStore'
import type { CameraFocus } from '../../../lib/agentTypes'
import type { BakedBuilding } from '../../../lib/campusData'
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
/** 全景机位(指挥中心默认视角) */
export const OVERVIEW_POS = new THREE.Vector3(420, 480, 620)
export const OVERVIEW_TARGET = new THREE.Vector3(40, 0, -80)
/** 校园中心(用于推算"楼前方"朝向) */
const CAMPUS_CENTER = new THREE.Vector2(40, -80)

const DEG = Math.PI / 180
const BUILDING_DIST = 120
const BUILDING_PITCH = 35 * DEG
const ROOM_DIST = 45
const ROOM_PITCH = 30 * DEG
const ROUTE_ALTITUDE = 90
const ROUTE_SPEED = 60 // m/s

// ---------- 道路数据(route 运镜用,本地 public 数据,懒加载+缓存) ----------
interface RoadShape { id: string; points: [number, number][] }
let roadsCache: Promise<RoadShape[]> | null = null
function loadRoads(): Promise<RoadShape[]> {
  if (!roadsCache) {
    roadsCache = fetch('/data/campus/roads.json')
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
type Flight = PointFlight | RouteFlight

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

  const currentAnchors = () => {
    const c = controlsRef.current
    return {
      pos: camera.position.clone(),
      tgt: c ? c.target.clone() : OVERVIEW_TARGET.clone(),
    }
  }

  // scanTrigger:先拉全景
  useEffect(() => {
    if (scanTrigger <= 0 || scanTrigger === lastScanRef.current) return
    lastScanRef.current = scanTrigger
    const a = currentAnchors()
    tryStart(overviewFlight(a.pos, a.tgt))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanTrigger])

  // cameraFocus:building / room / campus / route
  useEffect(() => {
    if (!cameraFocus) return
    const focus: CameraFocus = cameraFocus
    const a = currentAnchors()
    const finish = () => useCampusStore.getState().focusCamera(null)

    if (focus.type === 'campus') {
      if (tryStart(overviewFlight(a.pos, a.tgt))) finish()
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
        const hint = room.positionHint
        const tx = b.center[0] + (hint ? hint[0] : 0)
        const ty = (hint ? hint[1] : b.height * 0.5) + 2
        const tz = b.center[1] + (hint ? hint[2] : 0)
        const dir = approachDir(tx, tz)
        const target = new THREE.Vector3(tx, Math.max(ty, 4), tz)
        const pos = new THREE.Vector3(
          tx + dir.x * ROOM_DIST,
          target.y + ROOM_DIST * Math.tan(ROOM_PITCH),
          tz + dir.y * ROOM_DIST,
        )
        if (tryStart({ kind: 'point', t: 0, duration: 1.8, fromPos: a.pos, fromTgt: a.tgt, toPos: pos, toTgt: target })) finish()
      } else if (tryStart(overviewFlight(a.pos, a.tgt))) finish()
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
      flightRef.current = null
      return
    }
    const c = controlsRef.current
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
