import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { applyDayNight, currentNightFactor } from '../atmosphere/dayNight'

/**
 * 沙盘基座 + 教学区红线轮廓(微发光描边)。
 * 基座昼夜双色:白天=明亮浅灰绿(航拍校园底面),黑夜=原 #14181d 指挥中心深蓝黑。
 * 红线/晕染为夜态指挥元素,白天随 nightFactor 淡出至微不可见。
 */
const ZONE_CX = 90
const ZONE_CZ = 0
const ZONE_HW = 720
const ZONE_HH = 260
const ZONE_R = 130
const LINE_Y = 0.72
const HALO_Y = 0.68
const RED = '#ff3b30'
const BASE_DAY = new THREE.Color('#acb29f') // 浅灰绿,低饱和暖调
const BASE_NIGHT = new THREE.Color('#14181d')

/** 在 Shape 空间(x, -z)绘制圆角矩形路径 */
function roundedRectShape(cx: number, cy: number, hw: number, hh: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const x0 = cx - hw
  const x1 = cx + hw
  const y0 = cy - hh
  const y1 = cy + hh
  s.moveTo(x0 + r, y0)
  s.lineTo(x1 - r, y0)
  s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false)
  s.lineTo(x1, y1 - r)
  s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false)
  s.lineTo(x0 + r, y1)
  s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false)
  s.lineTo(x0, y0 + r)
  s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false)
  return s
}

export default function GroundPlate() {
  // 红线描边(LineLoop,呼吸脉冲)
  const line = useMemo(() => {
    const shape = roundedRectShape(ZONE_CX, -ZONE_CZ, ZONE_HW, ZONE_HH, ZONE_R)
    const pts = shape.getPoints(200).map((p) => new THREE.Vector3(p.x, LINE_Y, -p.y))
    const geom = new THREE.BufferGeometry().setFromPoints(pts)
    const mat = new THREE.LineBasicMaterial({
      color: RED,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    })
    return new THREE.LineLoop(geom, mat)
  }, [])

  // 发光晕染带(圆角矩形环面,加色混合)
  const haloGeom = useMemo(() => {
    const outer = roundedRectShape(ZONE_CX, -ZONE_CZ, ZONE_HW + 9, ZONE_HH + 9, ZONE_R + 9)
    const inner = roundedRectShape(ZONE_CX, -ZONE_CZ, ZONE_HW - 9, ZONE_HH - 9, Math.max(8, ZONE_R - 9))
    outer.holes.push(inner)
    const g = new THREE.ShapeGeometry(outer)
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const baseMat = useRef<THREE.MeshStandardMaterial>(null)

  useEffect(
    () => () => {
      line.geometry.dispose()
      line.material.dispose()
    },
    [line],
  )

  useFrame(({ clock }) => {
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 1.1)
    const nf = currentNightFactor()
    // 基座:白天浅灰绿 ↔ 黑夜深蓝黑
    if (baseMat.current) applyDayNight(baseMat.current.color, BASE_DAY, BASE_NIGHT)
    // 红线/晕染是指挥中心夜态元素,白天淡出(保留 12% 微痕维持层次)
    const dayFade = 0.12 + 0.88 * nf
    line.material.opacity = (0.55 + 0.3 * pulse) * dayFade
    if (haloMat.current) haloMat.current.opacity = (0.045 + 0.05 * pulse) * nf
  })

  return (
    <group>
      {/* 沙盘基座 2600×1400 */}
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2600, 1400]} />
        <meshStandardMaterial ref={baseMat} color="#14181d" roughness={1} metalness={0} />
      </mesh>
      {/* 教学区红线晕染 */}
      <mesh geometry={haloGeom} position={[0, HALO_Y, 0]}>
        <meshBasicMaterial
          ref={haloMat}
          color={RED}
          transparent
          opacity={0.07}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 教学区红线描边 */}
      <primitive object={line} dispose={null} />
    </group>
  )
}
