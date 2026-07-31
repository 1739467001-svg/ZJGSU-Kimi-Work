// 区域分块容器:相机(XZ 平面距离)超出 radius 时整块不渲染(返回 null)
// 用于 M2 按区分块加载/剔除;自身无网格,新增 DrawCall = 0
import { useRef, useState, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'

export interface ZoneChunkProps {
  /** 区块中心(局部米制坐标 [x, z],与 campusData 同一坐标系) */
  center: [number, number]
  /** 可见半径(米);相机水平距离 > radius 时 children 不渲染 */
  radius: number
  children: ReactNode
}

/**
 * 带迟滞(10%)避免边界闪烁:进入阈值 = radius,退出阈值 = radius * 1.1。
 * 仅在可见性翻转时 setState,稳定状态下 useFrame 不触发重渲染。
 */
export default function ZoneChunk({ center, radius, children }: ZoneChunkProps) {
  const [visible, setVisible] = useState(true)
  const visibleRef = useRef(true)
  const enterSq = radius * radius
  const exitSq = enterSq * 1.21 // 1.1^2

  useFrame(({ camera }) => {
    const dx = camera.position.x - center[0]
    const dz = camera.position.z - center[1]
    const dSq = dx * dx + dz * dz
    const next = visibleRef.current ? dSq <= exitSq : dSq <= enterSq
    if (next !== visibleRef.current) {
      visibleRef.current = next
      setVisible(next)
    }
  })

  if (!visible) return null
  return <>{children}</>
}
