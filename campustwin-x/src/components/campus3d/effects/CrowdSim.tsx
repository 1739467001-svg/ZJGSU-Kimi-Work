import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding, BakedLandmark } from '../../../lib/campusData'
import { useSimStore } from '../../../store/simStore'

/** 路径 id —— 仿真引擎写 simStore.pathCrowd 时以此为键 */
export const CROWD_PATH_IDS = [
  'south_gate_teaching',
  'qianjiangwan_north2',
  'teaching_xingyun',
  'teaching_liushui',
  'teaching_library',
] as const
export type CrowdPathId = (typeof CROWD_PATH_IDS)[number]

type CrowdKind = 'commute' | 'canteen' | 'library'

const POINTS_PER_PATH = 200
const TABLE_LEN = 512
const PATH_Y = 1.2
/** 光点循环速度(圈/秒) */
const FLOW_SPEED = 0.025
const KIND_COLOR: Record<CrowdKind, string> = {
  commute: '#6fb6ff',
  canteen: '#ffc46b',
  library: '#8fe3b8',
}

/** 时段潮汐兜底(simStore.pathCrowd 缺该路径数据时按仿真时钟估算) */
function tidalFallback(kind: CrowdKind, hour: number): number {
  const bump = (center: number, width: number, peak: number) => {
    const d = Math.min(Math.abs(hour - center), 24 - Math.abs(hour - center))
    return peak * Math.exp(-(d * d) / (2 * width * width))
  }
  switch (kind) {
    case 'commute':
      return Math.min(1, 0.08 + bump(8, 1.2, 0.8) + bump(17.8, 1.4, 0.7))
    case 'canteen':
      return Math.min(1, 0.05 + bump(12.2, 1.0, 0.9) + bump(18.2, 1.1, 0.7))
    case 'library':
      return Math.min(1, 0.05 + bump(9, 1.5, 0.4) + bump(14, 2.0, 0.45) + bump(20, 1.8, 0.85))
  }
}

interface PathRuntime {
  id: CrowdPathId
  kind: CrowdKind
  table: Float32Array
  offsets: Float32Array
  dirs: Float32Array
  /** 挂载标记(仅判空,几何/材质经 geom/mat 访问) */
  points: THREE.Object3D | null
  geom: THREE.BufferGeometry
  mat: THREE.PointsMaterial
}

/** 从真实数据解析端点(失败时用实测坐标兜底) */
function resolveAnchors(buildings: BakedBuilding[], landmarks: BakedLandmark[]) {
  const byName = (kw: string) => buildings.find((b) => b.name?.includes(kw) || b.alias.some((a) => a.includes(kw)))
  const centroid = (list: BakedBuilding[]): [number, number] => {
    if (list.length === 0) return [346, -105]
    const sx = list.reduce((a, b) => a + b.center[0], 0)
    const sz = list.reduce((a, b) => a + b.center[1], 0)
    return [sx / list.length, sz / list.length]
  }
  const teaching = centroid(buildings.filter((b) => b.feature === 'teaching' && b.zone.includes('teaching')))
  const gateSouth = landmarks.find((l) => l.id === 'gate_south')?.position ?? ([117.92, 255.68] as [number, number])
  const gateNorth2 = landmarks.find((l) => l.id === 'gate_north2')?.position ?? ([492.72, -219.64] as [number, number])
  const qianjiangwan = byName('钱江湾综合楼')?.center ?? ([386.14, -315.27] as [number, number])
  const xingyun = byName('行云苑')?.center ?? ([412.6, -490.6] as [number, number])
  const liushui = byName('流水苑')?.center ?? ([512.1, -358.7] as [number, number])
  const library = buildings.find((b) => b.feature === 'library')?.center ?? ([140.09, -127.14] as [number, number])
  return { teaching, gateSouth, gateNorth2, qianjiangwan, xingyun, liushui, library }
}

interface Props {
  buildings: BakedBuilding[]
  landmarks: BakedLandmark[]
}

/**
 * 潮汐人流仿真:5 条主干路径(CatmullRomCurve3),每条 200 个光点沿曲线循环流动,
 * 双向各半;密度读 simStore.pathCrowd[pathId](缺省按时段潮汐),密度控制可见点数与透明度。
 * 每路径 1 个 THREE.Points(单 geometry 实例化渲染),共 5 DrawCall,动画全在 useFrame。
 */
export default function CrowdSim({ buildings, landmarks }: Props) {
  const paths = useMemo<PathRuntime[]>(() => {
    const a = resolveAnchors(buildings, landmarks)
    const defs: { id: CrowdPathId; kind: CrowdKind; pts: [number, number][] }[] = [
      {
        id: 'south_gate_teaching',
        kind: 'commute',
        pts: [a.gateSouth, [117.9, 205.9], [230, 80], [300, -20], a.teaching],
      },
      {
        id: 'qianjiangwan_north2',
        kind: 'commute',
        pts: [a.qianjiangwan, a.gateNorth2, [430, -180], [358.2, -136.7]],
      },
      {
        id: 'teaching_xingyun',
        kind: 'canteen',
        pts: [a.teaching, [400, -220], [420, -350], a.xingyun],
      },
      {
        id: 'teaching_liushui',
        kind: 'canteen',
        pts: [a.teaching, [440, -190], [490, -280], a.liushui],
      },
      {
        id: 'teaching_library',
        kind: 'library',
        pts: [a.teaching, [280, -115], [200, -125], a.library],
      },
    ]
    return defs.map((d) => {
      const curve = new THREE.CatmullRomCurve3(
        d.pts.map(([x, z]) => new THREE.Vector3(x, PATH_Y, z)),
        false,
        'catmullrom',
        0.35,
      )
      const samples = curve.getSpacedPoints(TABLE_LEN)
      const table = new Float32Array(TABLE_LEN * 3)
      samples.forEach((p, i) => {
        table[i * 3] = p.x
        table[i * 3 + 1] = p.y
        table[i * 3 + 2] = p.z
      })
      const offsets = new Float32Array(POINTS_PER_PATH)
      const dirs = new Float32Array(POINTS_PER_PATH)
      for (let i = 0; i < POINTS_PER_PATH; i++) {
        offsets[i] = i / POINTS_PER_PATH
        dirs[i] = i % 2 === 0 ? 1 : -1
      }
      const geom = new THREE.BufferGeometry()
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS_PER_PATH * 3), 3))
      const mat = new THREE.PointsMaterial({
        color: KIND_COLOR[d.kind],
        size: 1.8,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.6,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      })
      return { id: d.id, kind: d.kind, table, offsets, dirs, points: null, geom, mat }
    })
  }, [buildings, landmarks])

  const pathsRef = useRef<PathRuntime[]>([])
  pathsRef.current = paths

  useEffect(
    () => () => {
      paths.forEach((p) => {
        p.geom.dispose()
        p.mat.dispose()
      })
    },
    [paths],
  )

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const { pathCrowd, simClock } = useSimStore.getState()
    const now = new Date(simClock.nowMs)
    const hour = now.getHours() + now.getMinutes() / 60

    for (const p of pathsRef.current) {
      if (!p.points) continue
      const raw = pathCrowd[p.id]
      const density = THREE.MathUtils.clamp(raw ?? tidalFallback(p.kind, hour), 0, 1)
      const count = Math.max(6, Math.round(POINTS_PER_PATH * density))
      const attr = p.geom.attributes.position as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const advance = t * FLOW_SPEED
      for (let i = 0; i < count; i++) {
        let u = p.offsets[i] + advance
        u -= Math.floor(u)
        if (p.dirs[i] < 0) u = 1 - u
        const f = u * (TABLE_LEN - 1)
        const i0 = Math.floor(f)
        const i1 = Math.min(i0 + 1, TABLE_LEN - 1)
        const k = f - i0
        arr[i * 3] = p.table[i0 * 3] + (p.table[i1 * 3] - p.table[i0 * 3]) * k
        arr[i * 3 + 1] = p.table[i0 * 3 + 1] + (p.table[i1 * 3 + 1] - p.table[i0 * 3 + 1]) * k
        arr[i * 3 + 2] = p.table[i0 * 3 + 2] + (p.table[i1 * 3 + 2] - p.table[i0 * 3 + 2]) * k
      }
      attr.needsUpdate = true
      p.geom.setDrawRange(0, count)
      p.mat.opacity = 0.25 + density * 0.65
    }
  })

  return (
    <group>
      {paths.map((p) => (
        <points
          key={p.id}
          geometry={p.geom}
          material={p.mat}
          frustumCulled={false}
          ref={(pts) => {
            p.points = pts
          }}
        />
      ))}
    </group>
  )
}
