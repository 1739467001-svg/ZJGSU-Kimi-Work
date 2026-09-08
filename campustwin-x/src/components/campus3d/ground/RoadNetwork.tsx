import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedRoad } from '../../../lib/campusData'
import { applyDayNight } from '../atmosphere/dayNight'

/**
 * 道路网:roads.json 折线 → 法向扩边三角条带,全部合并为 1 个 mesh(1 DrawCall)。
 * 顶点色烘焙「白天态」:实名道路浅灰 #b7b3aa(更亮),无名道路 #a6a29a;
 * 夜态通过 material.color 乘算插值回落至原 #3a4148 / #2c323a 深色路网。
 */

const COLOR_NAMED = new THREE.Color('#b7b3aa')
const COLOR_UNNAMED = new THREE.Color('#a6a29a')
const TINT_DAY = new THREE.Color('#ffffff')
const TINT_NIGHT = new THREE.Color('#4f565f')

/** 路面基准高度(绿地 0.15 / 水系 0.35 之上) */
export const ROAD_SURFACE_Y = 0.55

/**
 * 道路中心线(世界坐标,含 y=路面高度),供 FlowLines 等模块复用。
 * 引用稳定:RoadNetwork 每次构建时原地清空并重新填充。
 */
export const roadCenterlines: THREE.Vector3[][] = []

/** 由道路数据构建中心线数组(纯函数,便于测试与其他模块按需重建) */
export function buildRoadCenterlines(roads: BakedRoad[], y: number = ROAD_SURFACE_Y): THREE.Vector3[][] {
  const lines: THREE.Vector3[][] = []
  for (const r of roads) {
    if (r.points.length < 2) continue
    lines.push(r.points.map(([x, z]) => new THREE.Vector3(x, y, z)))
  }
  return lines
}

interface CleanRoad {
  width: number
  named: boolean
  pts: { x: number; z: number }[]
}

function cleanRoads(roads: BakedRoad[]): CleanRoad[] {
  const out: CleanRoad[] = []
  for (const r of roads) {
    const pts: { x: number; z: number }[] = []
    for (const [x, z] of r.points) {
      const last = pts[pts.length - 1]
      if (last && Math.hypot(x - last.x, z - last.z) < 0.05) continue // 去连续重复点
      pts.push({ x, z })
    }
    if (pts.length < 2) continue
    out.push({ width: Math.max(1.2, r.width), named: r.name != null && r.name !== '', pts })
  }
  return out
}

/** 折线 → 三角条带合并网格(顶点色区分实名/无名) */
function buildRoadGeometry(roads: BakedRoad[]): THREE.BufferGeometry | null {
  const cleaned = cleanRoads(roads)
  if (cleaned.length === 0) return null

  let vCount = 0
  let iCount = 0
  for (const r of cleaned) {
    vCount += r.pts.length * 2
    iCount += (r.pts.length - 1) * 6
  }

  const pos = new Float32Array(vCount * 3)
  const nrm = new Float32Array(vCount * 3)
  const col = new Float32Array(vCount * 3)
  const uv = new Float32Array(vCount * 2)
  const idx = new Uint32Array(iCount)

  let vo = 0
  let io = 0
  cleaned.forEach((road, ri) => {
    const { pts, width, named } = road
    const n = pts.length
    const half = width / 2
    const color = named ? COLOR_NAMED : COLOR_UNNAMED
    // 微小高度错层,避免道路交叉处 z-fighting
    const y = ROAD_SURFACE_Y + (ri % 8) * 0.0015
    let dist = 0

    for (let i = 0; i < n; i++) {
      const p = pts[i]
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(n - 1, i + 1)]
      let dx = next.x - prev.x
      let dz = next.z - prev.z
      const len = Math.hypot(dx, dz)
      if (len < 1e-6) {
        dx = 1
        dz = 0
      } else {
        dx /= len
        dz /= len
      }
      // 法向(xz 平面内垂直于行进方向)
      const nx = -dz
      const nz = dx
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z)

      const vi = vo / 3
      // 左点
      pos[vo] = p.x + nx * half
      pos[vo + 1] = y
      pos[vo + 2] = p.z + nz * half
      // 右点
      pos[vo + 3] = p.x - nx * half
      pos[vo + 4] = y
      pos[vo + 5] = p.z - nz * half

      nrm[vo + 1] = 1
      nrm[vo + 4] = 1

      col[vo] = color.r
      col[vo + 1] = color.g
      col[vo + 2] = color.b
      col[vo + 3] = color.r
      col[vo + 4] = color.g
      col[vo + 5] = color.b

      const ui = (vo / 3) * 2
      uv[ui] = dist
      uv[ui + 1] = 0
      uv[ui + 2] = dist
      uv[ui + 3] = 1

      vo += 6

      if (i < n - 1) {
        const a = vi
        // 顶面朝上(+Y)的环绕序
        idx[io] = a
        idx[io + 1] = a + 2
        idx[io + 2] = a + 1
        idx[io + 3] = a + 1
        idx[io + 4] = a + 2
        idx[io + 5] = a + 3
        io += 6
      }
    }
  })

  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3))
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geom.setIndex(new THREE.BufferAttribute(idx, 1))
  geom.computeBoundingSphere()
  return geom
}

export default function RoadNetwork({ roads }: { roads: BakedRoad[] }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null)
  const geometry = useMemo(() => {
    // 同步刷新对外共享的中心线数组(引用不变,内容原地更新)
    const lines = buildRoadCenterlines(roads)
    roadCenterlines.length = 0
    roadCenterlines.push(...lines)
    return buildRoadGeometry(roads)
  }, [roads])

  useFrame(() => {
    const mat = matRef.current
    if (mat) applyDayNight(mat.color, TINT_DAY, TINT_NIGHT)
  })

  if (!geometry) return null
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial
        ref={matRef}
        vertexColors
        roughness={0.92}
        metalness={0.04}
        side={THREE.DoubleSide}
        polygonOffset
        polygonOffsetFactor={-1}
        polygonOffsetUnits={-1}
      />
    </mesh>
  )
}
