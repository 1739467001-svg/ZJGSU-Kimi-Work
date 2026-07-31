// CameraRig —— 运镜组合层:持有相机所有权总线(CameraBus),
// 仲裁 OpeningSequence / CameraDirector / CruisePath 三者对相机的独占权,
// 并注册全局输入监听实现"锁定期按下指针/按键即打断交还"。
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { useUIStore } from '../../../store/uiStore'
import OpeningSequence from './OpeningSequence'
import CameraDirector from './CameraDirector'
import CruisePath from './CruisePath'

/** OrbitControls 实例 ref(结构化类型,兼容 useRef<OrbitControlsImpl | null>) */
export type OrbitControlsRef = { current: OrbitControlsImpl | null }

/** 相机独占者:null = OrbitControls 自由交互 */
export type CameraOwner = 'opening' | 'director' | 'cruise' | null

/** 运镜仲裁总线(可变 ref,跨组件共享,不触发渲染) */
export interface CameraBus {
  owner: CameraOwner
  /** 最近一次用户输入时间戳(ms),巡航待机判定用 */
  lastInputMs: number
}
export type CameraBusRef = { current: CameraBus }

export interface CameraRigProps {
  controlsRef: OrbitControlsRef
}

export default function CameraRig({ controlsRef }: CameraRigProps) {
  const busRef = useRef<CameraBus>({ owner: null, lastInputMs: Date.now() })
  const gl = useThree((s) => s.gl)

  // 全局输入:刷新待机计时;首屏跳过;导演/巡航锁定期立即交还控制权
  useEffect(() => {
    const bus = busRef.current
    const onInput = () => {
      bus.lastInputMs = Date.now()
      if (bus.owner === 'opening') {
        useUIStore.getState().setOpeningPlayed(true)
        return
      }
      if (bus.owner !== null) {
        bus.owner = null
        const c = controlsRef.current
        if (c) c.enabled = true
      }
    }
    const dom = gl.domElement
    dom.addEventListener('pointerdown', onInput)
    dom.addEventListener('wheel', onInput, { passive: true })
    window.addEventListener('keydown', onInput)
    return () => {
      dom.removeEventListener('pointerdown', onInput)
      dom.removeEventListener('wheel', onInput)
      window.removeEventListener('keydown', onInput)
    }
  }, [gl, controlsRef])

  return (
    <>
      <OpeningSequence bus={busRef} controlsRef={controlsRef} />
      <CameraDirector bus={busRef} controlsRef={controlsRef} />
      <CruisePath bus={busRef} controlsRef={controlsRef} />
    </>
  )
}
