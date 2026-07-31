// M2-D3 植被:阔叶/针叶两套低模树,InstancedMesh × 2(DrawCall = 2)
// 点位:trees.json 733 个 [x, z, scale](局部米制,z 向南为正,scale 0.8–1.4)
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { TreePoint } from '../../../lib/campusData'
import { useUIStore } from '../../../store/uiStore'
import type { Season } from '../../../store/uiStore'

export type SeasonPalette = Record<Season, string>

// 四季色板(手册 §3.5:春 #7fae5a / 夏 #4d7c43 / 秋 #c98f3d / 冬 #6b5d4f)
// 集成说明:weather/SeasonController 落地后,改为其导出的 seasonPalette 并通过 palette prop 注入即可;
// 当前该文件由并行代理开发、尚不存在,硬 import 会导致本文件 tsc 失败,故内置同值缺省。
export const seasonPalette: SeasonPalette = {
  spring: '#7fae5a',
  summer: '#4d7c43',
  autumn: '#c98f3d',
  winter: '#6b5d4f',
}

export interface TreesProps {
  points: TreePoint[]
  /** 可选:外部色板(weather/SeasonController)注入,缺省用内置 seasonPalette */
  palette?: Partial<SeasonPalette>
}

/** 确定性伪随机(同一点位每次渲染结果一致,无闪烁) */
function seededRand(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/** 给整段几何刷一个顶点色:与 instanceColor 相乘 → 树冠吃季节色、树干保持暗褐 */
function paintVertexColor(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** 阔叶树:球冠 + 圆柱干,合并为单一几何。三角面 ≈ 80(球) + 24(干) ≈ 104 < 300 */
function createBroadleafGeometry(): THREE.BufferGeometry {
  const crown = new THREE.SphereGeometry(2.3, 8, 6)
  crown.scale(1, 0.92, 1)
  crown.translate(0, 3.9, 0)
  paintVertexColor(crown, '#ffffff')
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 2.4, 6, 1)
  trunk.translate(0, 1.2, 0)
  paintVertexColor(trunk, '#8a6f52')
  const g = mergeGeometries([crown, trunk], false)
  crown.dispose()
  trunk.dispose()
  if (!g) throw new Error('broadleaf geometry merge failed')
  return g
}

/** 针叶树:双锥,合并为单一几何。三角面 ≈ 14 × 2 = 28 < 300 */
function createConiferGeometry(): THREE.BufferGeometry {
  const lower = new THREE.ConeGeometry(2.1, 3.4, 7)
  lower.translate(0, 2.6, 0)
  paintVertexColor(lower, '#f2f2f2')
  const upper = new THREE.ConeGeometry(1.45, 2.8, 7)
  upper.translate(0, 4.9, 0)
  paintVertexColor(upper, '#ffffff')
  const g = mergeGeometries([lower, upper], false)
  lower.dispose()
  upper.dispose()
  if (!g) throw new Error('conifer geometry merge failed')
  return g
}

interface Placement {
  x: number
  z: number
  scale: number
  rotY: number
}

const tmpMatrix = new THREE.Matrix4()
const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()
const tmpColor = new THREE.Color()
const Y_AXIS = new THREE.Vector3(0, 1, 0)

function fillMatrices(mesh: THREE.InstancedMesh, list: Placement[]): void {
  for (let i = 0; i < list.length; i++) {
    const p = list[i]
    tmpPos.set(p.x, 0, p.z)
    tmpQuat.setFromAxisAngle(Y_AXIS, p.rotY)
    tmpScale.set(p.scale, p.scale, p.scale)
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
    mesh.setMatrixAt(i, tmpMatrix)
  }
  mesh.instanceMatrix.needsUpdate = true
}

/** 季节着色:底色 ±6% 明度抖动,避免色块死板 */
function applySeasonColor(mesh: THREE.InstancedMesh, count: number, baseHex: string): void {
  tmpColor.set(baseHex)
  for (let i = 0; i < count; i++) {
    const c = tmpColor.clone().offsetHSL(0, 0, (seededRand(i * 3 + 11) - 0.5) * 0.12)
    mesh.setColorAt(i, c)
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

export default function Trees({ points, palette }: TreesProps) {
  const quality = useUIStore((s) => s.quality)
  const season = useUIStore((s) => s.season)
  const broadRef = useRef<THREE.InstancedMesh>(null)
  const coniferRef = useRef<THREE.InstancedMesh>(null)

  // 程序化几何各建一次(各 <300 面)
  const broadGeo = useMemo(createBroadleafGeometry, [])
  const coniferGeo = useMemo(createConiferGeometry, [])

  // 一次性布点:确定性拆分阔叶/针叶(约 72% / 28%);quality=low 只取偶数索引(50%)
  const { broadleaf, conifer } = useMemo(() => {
    const broad: Placement[] = []
    const con: Placement[] = []
    for (let i = 0; i < points.length; i++) {
      if (quality === 'low' && i % 2 !== 0) continue
      const [x, z, s] = points[i]
      const placement: Placement = { x, z, scale: s, rotY: seededRand(i + 1000) * Math.PI * 2 }
      if (seededRand(i * 7 + 3) < 0.28) con.push(placement)
      else broad.push(placement)
    }
    return { broadleaf: broad, conifer: con }
  }, [points, quality])

  // 布点写入实例矩阵(点位/档位变化时一次性重填,不在帧循环里做)
  useLayoutEffect(() => {
    if (broadRef.current) fillMatrices(broadRef.current, broadleaf)
    if (coniferRef.current) fillMatrices(coniferRef.current, conifer)
  }, [broadleaf, conifer])

  // 季节 → instanceColor(坑位:setColorAt 后必须 instanceColor.needsUpdate)
  useEffect(() => {
    const base = palette?.[season] ?? seasonPalette[season]
    if (broadRef.current) applySeasonColor(broadRef.current, broadleaf.length, base)
    if (coniferRef.current) applySeasonColor(coniferRef.current, conifer.length, base)
  }, [season, palette, broadleaf, conifer])

  return (
    // 冬季整树 y 缩放 0.9(手册 §3.5),组级缩放零额外 DrawCall
    <group scale={[1, season === 'winter' ? 0.9 : 1, 1]}>
      <instancedMesh
        key={`broadleaf-${broadleaf.length}`}
        ref={broadRef}
        args={[undefined, undefined, broadleaf.length]}
        geometry={broadGeo}
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors color="#ffffff" roughness={0.9} metalness={0} />
      </instancedMesh>
      <instancedMesh
        key={`conifer-${conifer.length}`}
        ref={coniferRef}
        args={[undefined, undefined, conifer.length]}
        geometry={coniferGeo}
        frustumCulled={false}
      >
        <meshStandardMaterial vertexColors color="#ffffff" roughness={0.9} metalness={0} />
      </instancedMesh>
    </group>
  )
}
