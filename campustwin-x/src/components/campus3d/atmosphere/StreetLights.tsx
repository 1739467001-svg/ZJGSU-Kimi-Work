// 路灯:沿实名道路每 40m 一柱,InstancedMesh 半透明光柱 + 顶部程序化光晕 Points。
// 共 2 个 DrawCall;nightFactor > 0.5 可见,0.5→1 渐入。数据自取 /data/campus/roads.json。
import { useEffect, useMemo, useRef, useState } from 'react'
import { DEPLOY_BASE } from '../../../lib/deployBase'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedRoad } from '../../../lib/campusData'
import { getNightFactor } from './WindowLights'

const SPACING = 40 // 布灯间距(米)
const POLE_H = 8 // 光柱高度(米)
const DEDUP_CELL = 20 // 路口去重栅格(米)

interface LampPoint { x: number; z: number }

async function loadNamedRoads(): Promise<BakedRoad[]> {
  const res = await fetch(`${DEPLOY_BASE}data/campus/roads.json`)
  if (!res.ok) return []
  const data: unknown = await res.json()
  const roads = (data as { roads?: BakedRoad[] }).roads
  if (!Array.isArray(roads)) return []
  return roads.filter((r) => r.name != null && r.points.length >= 2)
}

/** 沿道路折线按 SPACING 采样灯位,跨段连续进位,路口附近按栅格去重 */
function sampleLamps(roads: BakedRoad[]): LampPoint[] {
  const out: LampPoint[] = []
  const occupied = new Set<string>()
  for (const road of roads) {
    let carry = SPACING / 2
    for (let i = 0; i < road.points.length - 1; i++) {
      const [x1, z1] = road.points[i]
      const [x2, z2] = road.points[i + 1]
      const dx = x2 - x1
      const dz = z2 - z1
      const len = Math.hypot(dx, dz)
      if (len <= 0) continue
      let d = carry
      while (d <= len) {
        const t = d / len
        const x = x1 + dx * t
        const z = z1 + dz * t
        const key = `${Math.round(x / DEDUP_CELL)}:${Math.round(z / DEDUP_CELL)}`
        if (!occupied.has(key)) {
          occupied.add(key)
          out.push({ x, z })
        }
        d += SPACING
      }
      carry = d - len
    }
  }
  return out
}

/** 程序化径向渐变光晕贴图(本地生成,无外部资源) */
function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255, 214, 150, 1)')
    g.addColorStop(0.35, 'rgba(255, 190, 110, 0.55)')
    g.addColorStop(1, 'rgba(255, 170, 80, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(c)
}

export default function StreetLights() {
  const [roads, setRoads] = useState<BakedRoad[] | null>(null)
  const groupRef = useRef<THREE.Group>(null)
  const instRef = useRef<THREE.InstancedMesh>(null)
  const pillarMatRef = useRef<THREE.MeshBasicMaterial>(null)
  const glowMatRef = useRef<THREE.PointsMaterial>(null)

  useEffect(() => {
    let alive = true
    loadNamedRoads()
      .then((r) => { if (alive) setRoads(r) })
      .catch(() => { if (alive) setRoads([]) })
    return () => { alive = false }
  }, [])

  const lamps = useMemo(() => (roads ? sampleLamps(roads) : null), [roads])
  const glowTexture = useMemo(() => makeGlowTexture(), [])

  const glowGeometry = useMemo(() => {
    if (!lamps) return null
    const arr = new Float32Array(lamps.length * 3)
    lamps.forEach((l, i) => {
      arr[i * 3] = l.x
      arr[i * 3 + 1] = POLE_H + 0.4
      arr[i * 3 + 2] = l.z
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    return g
  }, [lamps])

  // 写入实例矩阵(每盏灯一次)
  useEffect(() => {
    const inst = instRef.current
    if (!inst || !lamps) return
    const m = new THREE.Matrix4()
    lamps.forEach((l, i) => {
      m.makeTranslation(l.x, POLE_H / 2, l.z)
      inst.setMatrixAt(i, m)
    })
    inst.instanceMatrix.needsUpdate = true
    inst.computeBoundingSphere()
  }, [lamps])

  useFrame(() => {
    const nf = getNightFactor()
    const fade = THREE.MathUtils.clamp((nf - 0.5) * 2, 0, 1)
    if (groupRef.current) groupRef.current.visible = nf > 0.5
    if (pillarMatRef.current) pillarMatRef.current.opacity = 0.26 * fade
    if (glowMatRef.current) glowMatRef.current.opacity = 0.95 * fade
  })

  if (!lamps || !glowGeometry || lamps.length === 0) return null

  return (
    <group ref={groupRef} visible={false}>
      {/* 半透明光柱(1 DrawCall) */}
      <instancedMesh
        ref={instRef}
        args={[undefined, undefined, lamps.length]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.28, 0.5, POLE_H, 6, 1, true]} />
        <meshBasicMaterial
          ref={pillarMatRef}
          color="#ffc37a"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      {/* 顶部光晕(1 DrawCall,面向相机的点精灵) */}
      <points geometry={glowGeometry} frustumCulled={false}>
        <pointsMaterial
          ref={glowMatRef}
          size={5}
          map={glowTexture}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
    </group>
  )
}
