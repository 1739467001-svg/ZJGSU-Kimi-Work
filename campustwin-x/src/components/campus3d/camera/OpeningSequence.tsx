// OpeningSequence —— 8.5 秒电影感首屏运镜:
// 高空远景(全校区轮廓+天空)→ 俯冲 → 掠过综合大楼新月形弧板 → 低高度摆向图书馆白色主塔
// → 拉升 → 落幅三分构图机位(教学区中轴 / 图书馆 / 水系同屏)。
// 曲线用 CatmullRomCurve3 预烘焙;全局进度经 easeInOutCubic 时间扭曲(慢起-快冲-慢落),
// 并附带轻微的呼吸式 FOV 变化(中段广角张力,首尾复原)。
// 进度经 useOpeningProgress() 暴露给楼宇模块(逐栋点亮)。
// 任意点击/滚轮/按键跳过(由 CameraRig 全局输入监听调用 uiStore.setOpeningPlayed)。
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { create } from 'zustand'
import { useUIStore } from '../../../store/uiStore'
import type { CameraBusRef, OrbitControlsRef } from './CameraRig'
import { easeInOutCubic } from './CameraDirector'

export const OPENING_DURATION = 8.5

// ---------- 高度安全说明 ----------
// 全校建筑最高为综合大楼 48m(含屋顶格栅 ≈ 51m),图书馆主塔视觉高 ≈ 45m;
// 飞行路径全程高度 ≥ 80m(最低点为两 hero 建筑之间的摆荡衔接点 80m),
// 即使考虑 CatmullRom 插值微幅下沉,对最高建筑仍有 >25m 余量,不会穿模。

// ---------- 首屏进度(楼宇逐栋点亮等外部模块订阅) ----------
interface OpeningState { progress: number; active: boolean }
const useOpeningStore = create<OpeningState>(() => ({ progress: 0, active: false }))

/** 首屏进度 0-1(楼宇模块接入点亮效果用);首屏结束后恒为 1 */
export function useOpeningProgress(): number {
  return useOpeningStore((s) => (s.active ? s.progress : 1))
}
/** 首屏是否正在播放 */
export function useOpeningActive(): boolean {
  return useOpeningStore((s) => s.active)
}

/** 落幅机位:东南侧中高空回望,教学区中轴纵深居中偏左、图书馆居右三分之一、墨湖/水渠穿中景 */
export const LANDING_POS = new THREE.Vector3(360, 220, 330)
export const LANDING_TARGET = new THREE.Vector3(95, 15, -70)

/** FOV 呼吸幅度:中段 +6° 增强俯冲张力,首尾回到基准 */
const FOV_PUNCH = 6

export interface OpeningSequenceProps {
  bus: CameraBusRef
  controlsRef: OrbitControlsRef
}

export default function OpeningSequence({ bus, controlsRef }: OpeningSequenceProps) {
  const camera = useThree((s) => s.camera)
  const openingPlayed = useUIStore((s) => s.openingPlayed)
  const elapsedRef = useRef(0)
  const baseFovRef = useRef(42)

  // 预烘焙飞行曲线(局部米制坐标,z 向南为正)
  const { path, lookPath } = useMemo(() => {
    // 位置关键帧:高空远景 → 俯冲 → 综合大楼北侧掠弧 → 低点摆荡 → 图书馆东北掠塔 → 拉升 → 落幅
    const pathPoints = [
      new THREE.Vector3(460, 540, 980),  // K0 高空远景:南偏东上空,全校区轮廓+天际线
      new THREE.Vector3(300, 240, 300),  // K1 俯冲进入校区上空
      new THREE.Vector3(20, 94, -140),   // K2 掠过综合大楼北侧外弧(楼高 51m,净高 43m)
      new THREE.Vector3(140, 88, -230),  // K2b 全程最低点:两 hero 楼之间向北摆出
      new THREE.Vector3(255, 92, -185),  // K3 掠过图书馆主塔东北角(塔高 ≈45m)
      new THREE.Vector3(330, 250, 160),  // K4 拉升回望
      LANDING_POS.clone(),               // K5 落幅三分构图机位
    ]
    // 注视点关键帧:与位置节拍一一对应,甩镜衔接两个 hero 建筑
    const lookPoints = [
      new THREE.Vector3(0, 60, -500),    // L0 望向校区天际线(画面上 1/3 留天空)
      new THREE.Vector3(60, 40, -60),    // L1 俯冲前瞻校园核心
      new THREE.Vector3(15, 42, 0),      // L2 综合大楼弧板/中庭
      new THREE.Vector3(120, 40, -140),  // L2b 甩向图书馆方向
      new THREE.Vector3(150, 36, -150),  // L3 图书馆白色主塔
      new THREE.Vector3(90, 15, -80),    // L4 教学区中轴/墨湖
      LANDING_TARGET.clone(),            // L5 落幅注视
    ]
    return {
      path: new THREE.CatmullRomCurve3(pathPoints, false, 'centripetal', 0.5),
      lookPath: new THREE.CatmullRomCurve3(lookPoints, false, 'centripetal', 0.5),
    }
  }, [])

  // 启动:未播放过 → 接管相机,落到曲线起点
  useEffect(() => {
    if (openingPlayed) return
    bus.current.owner = 'opening'
    const c = controlsRef.current
    if (c) c.enabled = false
    elapsedRef.current = 0
    if (camera instanceof THREE.PerspectiveCamera) baseFovRef.current = camera.fov
    useOpeningStore.setState({ progress: 0, active: true })
    path.getPointAt(0, camera.position)
    const t0 = lookPath.getPointAt(0, new THREE.Vector3())
    if (c) c.target.copy(t0)
    camera.lookAt(t0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingPlayed])

  // 结束(自然播完或被跳过):恢复 FOV、交还控制权
  // 飞行期间每帧已同步 controls.target 并 c.update(),交还时机位/注视连续,无跳变
  useEffect(() => {
    if (!openingPlayed) return
    if (bus.current.owner === 'opening') bus.current.owner = null
    if (camera instanceof THREE.PerspectiveCamera && camera.fov !== baseFovRef.current) {
      camera.fov = baseFovRef.current
      camera.updateProjectionMatrix()
    }
    const c = controlsRef.current
    if (c) {
      c.enabled = true
      c.update()
    }
    useOpeningStore.setState({ progress: 1, active: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openingPlayed])

  useFrame((_, dt) => {
    if (!useOpeningStore.getState().active) return
    // 所有权被外部夺走(防御;正常跳过走 setOpeningPlayed)
    if (bus.current.owner !== 'opening') {
      useUIStore.getState().setOpeningPlayed(true)
      return
    }
    elapsedRef.current += dt
    const t = Math.min(elapsedRef.current / OPENING_DURATION, 1)
    useOpeningStore.setState({ progress: t })

    // 时间扭曲:慢起(远景驻留)→ 快冲(俯冲+掠楼)→ 慢落(拉升落幅)
    const e = easeInOutCubic(t)

    const c = controlsRef.current
    path.getPointAt(e, camera.position)
    const look = lookPath.getPointAt(e, new THREE.Vector3())
    if (c) {
      c.target.copy(look)
      c.update()
    } else {
      camera.lookAt(look)
    }

    // 呼吸式 FOV:中段轻微推宽,首尾回到基准
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = baseFovRef.current + FOV_PUNCH * Math.sin(Math.PI * e)
      camera.updateProjectionMatrix()
    }

    if (t >= 1) useUIStore.getState().setOpeningPlayed(true)
  })

  return null
}
