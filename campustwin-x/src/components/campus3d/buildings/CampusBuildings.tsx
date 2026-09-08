// 楼宇渲染(M2-D2):实名楼独立 Mesh(侧面立面贴图 + 顶面纯色),
// 未命名楼按 inside/outside 拆分侧面/顶面后各自合并,控 DrawCall
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Edges } from '@react-three/drei'
import type { BakedBuilding } from '../../../lib/campusData'
import { FEATURE_COLOR } from '../../../lib/campusData'
import { buildingGeometry } from '../Buildings'
import { FACADE_TILE_METERS, FLOOR_HEIGHT, roofColor } from '../../../lib/textures'
import FacadeMaterial from './FacadeMaterial'

/** 合批楼(高度不一)纵向平铺所用的贴图行数(每行 = FLOOR_HEIGHT 米) */
const MERGED_LEVELS = 4

const COLOR_SELECTED = '#e8b84b'
const COLOR_HIGHLIGHT = '#3aa7ff'
const COLOR_ALARM = '#ff3b30'

function safeFeature(b: BakedBuilding): string {
  // 数据里校外楼 feature 可能为 null,索引导航安全(null → 'null' 键 → undefined)
  return FEATURE_COLOR[b.feature] !== undefined ? b.feature : 'unknown'
}

/** 把 ExtrudeGeometry 侧面(group materialIndex=1)的米制 UV 缩放到贴图重复单元 */
function scaleSideUVs(g: THREE.BufferGeometry, invU: number, invV: number): void {
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
  if (!uv) return
  const arr = uv.array as Float32Array
  for (const grp of g.groups) {
    if (grp.materialIndex !== 1) continue
    for (let i = grp.start; i < grp.start + grp.count; i++) {
      arr[i * 2] *= invU
      arr[i * 2 + 1] *= invV
    }
  }
  uv.needsUpdate = true
}

/** 实名楼:整楼立面 = 一个纵向重复单元(贴图行数 = levels,行高 ≈ height/levels) */
function namedGeometry(b: BakedBuilding): THREE.BufferGeometry {
  const g = buildingGeometry(b)
  scaleSideUVs(g, 1 / FACADE_TILE_METERS, 1 / Math.max(1, b.height))
  return g
}

interface SplitParts {
  cap: THREE.BufferGeometry
  side: THREE.BufferGeometry
}

/** 未命名楼:按 ExtrudeGeometry 分组(0=顶/底盖,1=侧面)拆成两份无分组几何,便于合批 */
function splitGeometry(b: BakedBuilding): SplitParts {
  const g = buildingGeometry(b)
  const slice = (matIndex: number): THREE.BufferGeometry => {
    const out = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv'] as const) {
      const attr = g.getAttribute(name) as THREE.BufferAttribute
      const itemSize = attr.itemSize
      const src = attr.array as Float32Array
      const chunks: Float32Array[] = []
      let total = 0
      for (const grp of g.groups) {
        if (grp.materialIndex !== matIndex) continue
        const c = src.slice(grp.start * itemSize, (grp.start + grp.count) * itemSize)
        chunks.push(c)
        total += c.length
      }
      const merged = new Float32Array(total)
      let off = 0
      for (const c of chunks) {
        merged.set(c, off)
        off += c.length
      }
      out.setAttribute(name, new THREE.BufferAttribute(merged, itemSize))
    }
    return out
  }
  const parts: SplitParts = { cap: slice(0), side: slice(1) }
  g.dispose()
  scaleSideUVs(parts.side, 1 / FACADE_TILE_METERS, 1 / (MERGED_LEVELS * FLOOR_HEIGHT))
  return parts
}

interface MergedPair {
  cap: THREE.BufferGeometry
  side: THREE.BufferGeometry
}

export interface CampusBuildingsProps {
  buildings: BakedBuilding[]
  /** 选中楼 → 金色 */
  selectedId: string | null
  /** 高亮楼(Agent 检索结果)→ 品牌蓝描边 */
  highlightedIds: string[]
  /** 告警楼 → 红色 */
  alarmId: string | null
  /** 0=白天 1=全夜,驱动窗灯 emissive */
  nightFactor: number
  onSelect: (b: BakedBuilding) => void
}

export default function CampusBuildings({
  buildings,
  selectedId,
  highlightedIds,
  alarmId,
  nightFactor,
  onSelect,
}: CampusBuildingsProps) {
  // 实名楼(L0/L1/L2)→ 独立 Mesh,可点击,侧面贴图 + 顶面纯色
  const named = useMemo(
    () =>
      buildings
        .filter((b) => b.name)
        .map((b) => ({ b, geometry: namedGeometry(b) })),
    [buildings],
  )
  useEffect(() => () => named.forEach((n) => n.geometry.dispose()), [named])

  // 未命名楼 → 侧面/顶面分别合并(inside/outside 各 2 个 Mesh,共 4 DrawCall)
  const merged = useMemo<{ inside: MergedPair | null; outside: MergedPair | null }>(() => {
    const build = (list: BakedBuilding[]): MergedPair | null => {
      if (!list.length) return null
      const caps: THREE.BufferGeometry[] = []
      const sides: THREE.BufferGeometry[] = []
      for (const b of list) {
        const p = splitGeometry(b)
        caps.push(p.cap)
        sides.push(p.side)
      }
      const cap = mergeGeometries(caps, false)
      const side = mergeGeometries(sides, false)
      caps.forEach((g) => g.dispose())
      sides.forEach((g) => g.dispose())
      return cap && side ? { cap, side } : null
    }
    const inside = buildings.filter((b) => !b.name && b.zone !== 'outside')
    const outside = buildings.filter((b) => !b.name && b.zone === 'outside')
    return { inside: build(inside), outside: build(outside) }
  }, [buildings])
  useEffect(
    () => () => {
      for (const pair of [merged.inside, merged.outside]) {
        pair?.cap.dispose()
        pair?.side.dispose()
      }
    },
    [merged],
  )

  const highlightSet = useMemo(() => new Set(highlightedIds), [highlightedIds])

  return (
    <group>
      {named.map(({ b, geometry }) => {
        const feature = safeFeature(b)
        const isSelected = selectedId === b.id
        const isAlarm = alarmId === b.id
        const isHighlighted = highlightSet.has(b.id)
        const tint = isSelected ? COLOR_SELECTED : isAlarm ? COLOR_ALARM : undefined
        const edgeColor = isSelected ? COLOR_SELECTED : isAlarm ? COLOR_ALARM : isHighlighted ? COLOR_HIGHLIGHT : null
        return (
          <mesh
            key={b.id}
            geometry={geometry}
            castShadow
            receiveShadow
            onClick={(e) => {
              e.stopPropagation()
              onSelect(b)
            }}
          >
            {/* group 0 = 顶/底盖:纯色 */}
            <meshStandardMaterial attach="material-0" color={tint ?? roofColor(feature)} roughness={0.92} metalness={0.02} />
            {/* group 1 = 侧面:日景贴图 + 夜景窗灯 */}
            <FacadeMaterial
              attach="material-1"
              feature={feature}
              levels={Math.max(1, b.levels)}
              nightFactor={nightFactor}
              tint={tint}
            />
            {edgeColor && <Edges threshold={20} color={edgeColor} />}
          </mesh>
        )
      })}

      {merged.inside && (
        <group>
          <mesh geometry={merged.inside.cap} castShadow receiveShadow>
            <meshStandardMaterial color={roofColor('unknown')} roughness={0.95} />
          </mesh>
          <mesh geometry={merged.inside.side} castShadow receiveShadow>
            <FacadeMaterial feature="unknown" levels={MERGED_LEVELS} nightFactor={nightFactor} />
          </mesh>
        </group>
      )}
      {merged.outside && (
        <group>
          <mesh geometry={merged.outside.cap} castShadow receiveShadow>
            {/* 原 #3a4048 近死黑,提亮为深灰蓝(仍低于校内楼,保留校外背景层次) */}
            <meshStandardMaterial color="#4b5763" roughness={0.95} />
          </mesh>
          <mesh geometry={merged.outside.side} castShadow receiveShadow>
            {/* 原 #5a626c 偏暗,同步提亮为灰蓝 */}
            <meshStandardMaterial color="#6b7581" roughness={0.95} />
          </mesh>
        </group>
      )}
    </group>
  )
}
