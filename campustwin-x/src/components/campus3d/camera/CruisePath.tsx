// CruisePath —— 待机巡航:cameraMode==='cruise' 且 30s 无输入时,
// 沿校园椭圆轨道缓慢环绕;任意输入(由 CameraRig 全局监听)立即交还控制权。
import { useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { useUIStore } from '../../../store/uiStore'
import type { CameraBusRef, OrbitControlsRef } from './CameraRig'
import { dampV3 } from './CameraDirector'
import { useOpeningActive } from './OpeningSequence'

const IDLE_MS = 30_000
/** 椭圆轨道参数(围绕校园核心,局部米制) */
const ORBIT_CENTER = new THREE.Vector3(40, 0, -80)
const ORBIT_RX = 620
const ORBIT_RZ = 460
const ORBIT_PERIOD = 90 // 一圈 90 秒
const MIN_ALT = 180
const MAX_ALT = 450

export interface CruisePathProps {
  bus: CameraBusRef
  controlsRef: OrbitControlsRef
}

export default function CruisePath({ bus, controlsRef }: CruisePathProps) {
  const camera = useThree((s) => s.camera)
  const cameraMode = useUIStore((s) => s.cameraMode)
  const openingActive = useOpeningActive()
  const angleRef = useRef(0)
  const altRef = useRef(320)
  const goalPos = useRef(new THREE.Vector3())
  const goalTgt = useRef(new THREE.Vector3())

  useFrame((_, dt) => {
    if (cameraMode !== 'cruise' || openingActive) return
    const b = bus.current

    // 巡航中:推进轨道角;所有权丢失则静默退出(CameraRig 已负责交还)
    if (b.owner === 'cruise') {
      angleRef.current += (dt * Math.PI * 2) / ORBIT_PERIOD
      goalPos.current.set(
        ORBIT_CENTER.x + ORBIT_RX * Math.cos(angleRef.current),
        altRef.current,
        ORBIT_CENTER.z + ORBIT_RZ * Math.sin(angleRef.current),
      )
      goalTgt.current.set(ORBIT_CENTER.x, 20, ORBIT_CENTER.z)
      dampV3(camera.position, goalPos.current, 2.5, dt)
      const c = controlsRef.current
      if (c) {
        dampV3(c.target, goalTgt.current, 2.5, dt)
        c.update()
      } else {
        camera.lookAt(goalTgt.current)
      }
      return
    }

    // 待机判定:总线空闲 + 30s 无输入 → 进入巡航
    if (b.owner !== null) return
    if (Date.now() - b.lastInputMs < IDLE_MS) return

    b.owner = 'cruise'
    const c = controlsRef.current
    if (c) c.enabled = false
    // 从当前机位反推轨道角与高度,平滑接入轨道
    angleRef.current = Math.atan2(
      (camera.position.z - ORBIT_CENTER.z) / ORBIT_RZ,
      (camera.position.x - ORBIT_CENTER.x) / ORBIT_RX,
    )
    altRef.current = Math.min(MAX_ALT, Math.max(MIN_ALT, camera.position.y))
  })

  return null
}
