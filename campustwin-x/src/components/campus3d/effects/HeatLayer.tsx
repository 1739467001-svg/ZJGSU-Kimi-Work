import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedBuilding } from '../../../lib/campusData'
import { useCampusStore } from '../../../store/campusStore'
import { useSimStore } from '../../../store/simStore'

/** 冷 → 暖三段渐变(低饱和,指挥中心热力配色) */
const COLD = new THREE.Color('#275e7d')
const MID = new THREE.Color('#c98f3d')
const HOT = new THREE.Color('#ff4a30')

function heatColor(t: number, out: THREE.Color): THREE.Color {
  const x = THREE.MathUtils.clamp(t, 0, 1)
  if (x < 0.5) return out.lerpColors(COLD, MID, x * 2)
  return out.lerpColors(MID, HOT, (x - 0.5) * 2)
}

interface Props {
  buildings: BakedBuilding[]
}

/**
 * 热力层(campusStore.heatMode !== 'none' 时):
 * 按 simStore.buildingOccupancy(occupancy/traffic)或 buildingEnergy(energy,按最大值归一)
 * 给楼体着色,冷→暖 lerp;优先只染 campusStore.highlightedBuildingIds,为空则全部校内实名楼。
 * 实现:每楼屋顶上方 0.3m 半透明色块,合并为单一网格(1 DrawCall),不触碰 Buildings.tsx 材质。
 */
export default function HeatLayer({ buildings }: Props) {
  const heatMode = useCampusStore((s) => s.heatMode)
  const highlighted = useCampusStore((s) => s.highlightedBuildingIds)
  const buildingOccupancy = useSimStore((s) => s.buildingOccupancy)
  const buildingEnergy = useSimStore((s) => s.buildingEnergy)

  const active = heatMode !== 'none'

  const targets = useMemo(() => {
    if (!active) return []
    return buildings.filter(
      (b) => b.name && b.zone !== 'outside' && (highlighted.length === 0 || highlighted.includes(b.id)),
    )
  }, [active, buildings, highlighted])

  // 取值签名(2 位小数):数据未实质变化时不重建几何
  const valueSig = useMemo(() => {
    if (!active) return ''
    if (heatMode === 'energy') {
      const max = Math.max(1, ...targets.map((b) => buildingEnergy[b.id] ?? 0))
      return targets.map((b) => ((buildingEnergy[b.id] ?? 0) / max).toFixed(2)).join(',')
    }
    // occupancy / traffic:均以楼宇占用率为数据源(traffic 暂无楼级人流,用占用率代理)
    return targets.map((b) => (buildingOccupancy[b.id] ?? 0).toFixed(2)).join(',')
  }, [active, heatMode, targets, buildingOccupancy, buildingEnergy])

  const geometry = useMemo(() => {
    if (!active || targets.length === 0) return null
    const isEnergy = heatMode === 'energy'
    const maxEnergy = Math.max(1, ...targets.map((b) => buildingEnergy[b.id] ?? 0))
    const c = new THREE.Color()
    const geoms = targets.map((b) => {
      const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
      const g = new THREE.ShapeGeometry(shape)
      g.rotateX(-Math.PI / 2)
      g.translate(0, b.height + 0.3, 0)
      const v = isEnergy ? (buildingEnergy[b.id] ?? 0) / maxEnergy : (buildingOccupancy[b.id] ?? 0)
      heatColor(v, c)
      const count = g.attributes.position.count
      const colors = new Float32Array(count * 3)
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r
        colors[i * 3 + 1] = c.g
        colors[i * 3 + 2] = c.b
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return g
    })
    const merged = mergeGeometries(geoms, false)
    geoms.forEach((g) => g.dispose())
    return merged
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, heatMode, targets, valueSig])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null
  return (
    <mesh geometry={geometry} renderOrder={5}>
      <meshBasicMaterial vertexColors transparent opacity={0.38} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  )
}
