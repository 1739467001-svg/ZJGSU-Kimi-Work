// 广场旗帜(任务E):综合大楼庭院广场 (34,-35) 两面 + 南门飞翔门两面
// (位置取自 campusData landmarks 的 gate_south,缺省回退到烘焙坐标)。
// 旗面 PlaneGeometry(8×5 段)逐帧顶点波动模拟飘动,低饱和红 / 校蓝;
// 旗杆磨砂金属 + 顶部圆球;夜里旗杆射灯微光(加法混合光柱 + 旗面暖色 emissive)。
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedLandmark } from '../../../lib/campusData'
import { getNightFactor } from '../atmosphere/WindowLights'

const POLE_H = 9 // 旗杆高度(米)
const FLAG_W = 2.6 // 旗面宽(米)
const FLAG_H = 1.6 // 旗面高(米)
const FLAG_SEG_X = 8
const FLAG_SEG_Y = 5

/** 低饱和旗色:广场双红,南门一红一校蓝 */
const FLAG_RED = '#a8453c'
const FLAG_BLUE = '#4d6b86'

interface FlagUnitDef {
  x: number
  z: number
  yaw: number
  color: string
  phase: number
}

interface Props {
  landmarks: BakedLandmark[]
}

/** 单面旗:旗杆 + 圆球 + 顶点动画旗面 + 夜间射灯光柱(共享自父级) */
function FlagUnit({
  def,
  glowGeometry,
  glowMaterial,
}: {
  def: FlagUnitDef
  glowGeometry: THREE.CylinderGeometry
  glowMaterial: THREE.MeshBasicMaterial
}) {
  const flagMatRef = useRef<THREE.MeshStandardMaterial>(null)
  const baseEmissive = useMemo(() => new THREE.Color('#5a3a18'), [])

  // 旗面几何:translate 使 x∈[0, FLAG_W],左边缘固定在旗杆侧;逐帧重写顶点
  const flagGeometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(FLAG_W, FLAG_H, FLAG_SEG_X, FLAG_SEG_Y)
    g.translate(FLAG_W / 2 + 0.08, 0, 0)
    return g
  }, [])
  useEffect(() => () => flagGeometry.dispose(), [flagGeometry])

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // 阵风:全局慢速起伏,各旗相位错开
    const gust = 0.75 + 0.35 * Math.sin(t * 0.45 + def.phase * 1.7)
    const attr = flagGeometry.getAttribute('position') as THREE.BufferAttribute
    const uv = flagGeometry.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < attr.count; i++) {
      const x = attr.getX(i)
      const k = Math.max(0, (x - 0.08) / FLAG_W) // 自由边振幅最大,旗杆侧为 0
      const z =
        Math.sin(x * 2.4 - t * 5.5 + def.phase) * 0.17 * k * gust +
        Math.sin(x * 4.1 - t * 8.2 + def.phase * 2.3) * 0.05 * k
      const y = Math.sin(x * 3.3 - t * 7.0 + def.phase) * 0.05 * k * gust
      attr.setZ(i, z)
      // y 基准行高由 uv.y 还原(初值 ∈ [-H/2, H/2]),避免逐帧覆盖导致漂移累积
      attr.setY(i, (uv.getY(i) - 0.5) * FLAG_H + y)
    }
    attr.needsUpdate = true
    flagGeometry.computeVertexNormals()

    // 夜间射灯照亮旗面:暖色 emissive 随 nightFactor 渐入
    const nf = getNightFactor()
    const lit = THREE.MathUtils.smoothstep(nf, 0.5, 0.9)
    const mat = flagMatRef.current
    if (mat) {
      mat.emissive.copy(baseEmissive)
      mat.emissiveIntensity = lit * 0.7
    }
  })

  return (
    <group position={[def.x, 0, def.z]} rotation={[0, def.yaw, 0]}>
      {/* 旗杆:磨砂金属灰 */}
      <mesh position={[0, POLE_H / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.1, POLE_H, 8]} />
        <meshStandardMaterial color="#8d8f93" roughness={0.45} metalness={0.7} />
      </mesh>
      {/* 顶部圆球:低饱和金 */}
      <mesh position={[0, POLE_H + 0.12, 0]}>
        <sphereGeometry args={[0.13, 8, 6]} />
        <meshStandardMaterial color="#b9a06a" roughness={0.35} metalness={0.8} />
      </mesh>
      {/* 旗面:顶点动画,标准材质吃昼夜光照,夜里叠加 emissive 射灯暖意 */}
      <mesh geometry={flagGeometry} position={[0, POLE_H - 1.05, 0]}>
        <meshStandardMaterial
          ref={flagMatRef}
          color={def.color}
          roughness={0.85}
          metalness={0}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* 夜间射灯光柱:共享几何/材质,加法混合微光 */}
      <mesh geometry={glowGeometry} material={glowMaterial} position={[0, POLE_H / 2, 0]} />
    </group>
  )
}

export default function Flags({ landmarks }: Props) {
  // 四面旗:综合大楼庭院广场 (34,-35) 两面 + 南门飞翔门两翼各一面
  const units = useMemo<FlagUnitDef[]>(() => {
    const gate = landmarks.find((l) => l.id === 'gate_south')
    const gx = gate?.position[0] ?? 117.92
    const gz = gate?.position[1] ?? 255.68
    return [
      { x: 30, z: -33, yaw: 0.5, color: FLAG_RED, phase: 0 },
      { x: 38, z: -37, yaw: 0.9, color: FLAG_RED, phase: 2.1 },
      { x: gx - 9, z: gz + 6, yaw: -0.4, color: FLAG_RED, phase: 4.2 },
      { x: gx + 9, z: gz + 6, yaw: 0.3, color: FLAG_BLUE, phase: 5.6 },
    ]
  }, [landmarks])

  // 射灯光柱:开口圆柱,加法混合;全部旗杆共享 1 几何 + 1 材质
  const glowGeometry = useMemo(
    () => new THREE.CylinderGeometry(0.5, 1.4, POLE_H, 8, 1, true),
    [],
  )
  useEffect(() => () => glowGeometry.dispose(), [glowGeometry])
  const glowMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#ffc37a',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    [],
  )
  useEffect(() => () => glowMaterial.dispose(), [glowMaterial])

  useFrame(() => {
    // 夜里射灯微光渐入(与 StreetLights 同一 nf 0.5→1 窗口)
    const nf = getNightFactor()
    glowMaterial.opacity = 0.09 * THREE.MathUtils.smoothstep(nf, 0.5, 1)
  })

  return (
    <group>
      {units.map((u, i) => (
        <FlagUnit key={i} def={u} glowGeometry={glowGeometry} glowMaterial={glowMaterial} />
      ))}
    </group>
  )
}
