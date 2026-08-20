// TourCruise —— 巡游逐站巡航:订阅 tourStore,
// status=playing 且总线空闲时取得独占(owner='tour'),逐站阻尼飞行到地标旁观景点,
// 到位停留 dwellSec 秒(此期间 TourPanel 展示该站讲稿),然后飞向下一站;
// 全部站点走完或用户结束时飞回全校视角(OVERVIEW_POS/TARGET)并交还总线。
// 用户输入打断(owner 被 CameraRig 置回)时静默退出巡航并暂停巡礼;开场运镜期间不抢总线。
import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useTourStore } from '../../../store/tourStore'
import type { CameraBusRef, OrbitControlsRef } from './CameraRig'
import { clamp01, dampV3, easeInOutCubic, lerp, OVERVIEW_POS, OVERVIEW_TARGET } from './CameraDirector'
import { useOpeningActive } from './OpeningSequence'

const DEG = Math.PI / 180
/** 观景点参数:距地标 60m、俯角 30°(落在 50~70m / 25~35° 要求区间) */
const STATION_DIST = 60
const STATION_PITCH = 30 * DEG
/** 注视点离地高度(门/雕像/钟等低矮地标) */
const TARGET_ALT = 6
/** 单站飞行时长(秒) */
const FLY_SEC = 2.4
/** 结束返校飞行时长(秒) */
const EXIT_SEC = 2.8
/** 校园中心(与 CameraDirector 一致,用于推算接近方向) */
const CAMPUS_CENTER = new THREE.Vector2(40, -80)

/** "地标前方"水平朝向:从校园中心指向地标,接近中心时取东南向默认(与 CameraDirector.approachDir 同款思路) */
function approachDir(x: number, z: number): THREE.Vector2 {
  const d = new THREE.Vector2(x - CAMPUS_CENTER.x, z - CAMPUS_CENTER.y)
  if (d.lengthSq() < 1) d.set(0.6, 0.8)
  return d.normalize()
}

/** 单段点到点飞行(与 CameraDirector 的 point flight 同构) */
interface Flight {
  t: number
  duration: number
  fromPos: THREE.Vector3
  fromTgt: THREE.Vector3
  toPos: THREE.Vector3
  toTgt: THREE.Vector3
}

function beginFlight(
  camera: THREE.Camera,
  controls: OrbitControlsRef,
  toPos: THREE.Vector3,
  toTgt: THREE.Vector3,
  duration: number,
): Flight {
  const c = controls.current
  return {
    t: 0, duration,
    fromPos: camera.position.clone(),
    fromTgt: c ? c.target.clone() : OVERVIEW_TARGET.clone(),
    toPos: toPos.clone(), toTgt: toTgt.clone(),
  }
}

/** 巡航阶段:idle 未接管 → fly 飞行中 → dwell 停留中 → exit 返校中 */
type Phase = 'idle' | 'fly' | 'dwell' | 'exit'

export interface TourCruiseProps {
  bus: CameraBusRef
  controlsRef: OrbitControlsRef
}

export default function TourCruise({ bus, controlsRef }: TourCruiseProps) {
  const camera = useThree((s) => s.camera)
  const openingActive = useOpeningActive()
  const phaseRef = useRef<Phase>('idle')
  const flightRef = useRef<Flight | null>(null)
  const dwellLeft = useRef(0)
  /** 已安排飞行的站点序号,-1 = 尚未安排(用于检测站点切换) */
  const stationRef = useRef(-1)
  const goalPos = useRef(new THREE.Vector3())
  const goalTgt = useRef(new THREE.Vector3())

  useFrame((_, dt) => {
    const tour = useTourStore.getState()
    const b = bus.current
    const c = controlsRef.current

    // 所有权丢失(用户输入打断,CameraRig 已负责交还 controls):静默退出并暂停巡礼
    if (phaseRef.current !== 'idle' && b.owner !== 'tour') {
      phaseRef.current = 'idle'
      flightRef.current = null
      stationRef.current = -1
      if (tour.status === 'playing') tour.pause()
      return
    }

    const stopped = tour.status === 'idle' || !tour.waypoints.length

    // 巡礼被停止(面板「结束」):若仍占总线,安排返校飞行,到位后交还
    if (stopped && phaseRef.current !== 'idle' && phaseRef.current !== 'exit' && b.owner === 'tour') {
      phaseRef.current = 'exit'
      flightRef.current = beginFlight(camera, controlsRef, OVERVIEW_POS, OVERVIEW_TARGET, EXIT_SEC)
    }

    // playing:接管总线 / 站点切换时安排新飞行(开场运镜期间不抢)
    if (!stopped && tour.status === 'playing' && !openingActive) {
      if (phaseRef.current === 'idle') {
        if (b.owner !== null) return // 导演拉全景/其他运镜占用中,等下一帧
        b.owner = 'tour'
        if (c) c.enabled = false
        phaseRef.current = 'fly'
        stationRef.current = -1
      }
      if (phaseRef.current !== 'exit' && stationRef.current !== tour.currentIndex) {
        const wp = tour.waypoints[tour.currentIndex]
        stationRef.current = tour.currentIndex
        const dir = approachDir(wp.position[0], wp.position[1])
        const toTgt = new THREE.Vector3(wp.position[0], TARGET_ALT, wp.position[1])
        const toPos = new THREE.Vector3(
          wp.position[0] + dir.x * STATION_DIST,
          TARGET_ALT + STATION_DIST * Math.tan(STATION_PITCH),
          wp.position[1] + dir.y * STATION_DIST,
        )
        flightRef.current = beginFlight(camera, controlsRef, toPos, toTgt, FLY_SEC)
        phaseRef.current = 'fly'
      }
    }

    // 飞行推进(easeInOutCubic 时间扭曲 + 指数阻尼,与 CameraDirector 同手感)
    const f = flightRef.current
    if (f && (phaseRef.current === 'fly' || phaseRef.current === 'exit')) {
      f.t = clamp01(f.t + dt / f.duration)
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
        if (phaseRef.current === 'exit') {
          // 返校到位:交还总线与 OrbitControls
          phaseRef.current = 'idle'
          stationRef.current = -1
          b.owner = null
          if (c) {
            c.enabled = true
            c.update()
          }
        } else {
          phaseRef.current = 'dwell'
          dwellLeft.current = tour.dwellSec
        }
      }
      return
    }

    // 停留:讲稿展示中;暂停时冻结倒计时,计时结束推进下一站(末站则返校收官)
    if (phaseRef.current === 'dwell') {
      if (tour.status !== 'playing') return
      dwellLeft.current -= dt
      if (dwellLeft.current > 0) return
      if (tour.currentIndex >= tour.waypoints.length - 1) {
        phaseRef.current = 'exit'
        flightRef.current = beginFlight(camera, controlsRef, OVERVIEW_POS, OVERVIEW_TARGET, EXIT_SEC)
        tour.stop()
      } else {
        tour.next()
      }
    }
  })

  return null
}
