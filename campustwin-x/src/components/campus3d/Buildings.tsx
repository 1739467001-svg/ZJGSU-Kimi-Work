import { useMemo } from 'react'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedBuilding } from '../../lib/campusData'
import { FEATURE_COLOR } from '../../lib/campusData'

// footprint 为局部坐标 [x,z];Shape 用 (x, -z),extrude 后 rotateX(-90°) 使 y=高度、z 回到原值
export function buildingGeometry(b: BakedBuilding): THREE.BufferGeometry {
  const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

interface Props {
  buildings: BakedBuilding[]
  selectedId: string | null
  onSelect: (b: BakedBuilding) => void
}

export default function Buildings({ buildings, selectedId, onSelect }: Props) {
  // 命名楼(L0/L1/L2 实名)→ 独立 Mesh,可点击;未命名/校外 → 合并成两个大 Mesh 控 DrawCall
  const { named, mergedInside, mergedOutside } = useMemo(() => {
    const named = buildings.filter((b) => b.name)
    const inside = buildings.filter((b) => !b.name && b.zone !== 'outside')
    const outside = buildings.filter((b) => !b.name && b.zone === 'outside')
    const merge = (list: BakedBuilding[]) =>
      list.length ? mergeGeometries(list.map(buildingGeometry), false) : null
    return { named, mergedInside: merge(inside), mergedOutside: merge(outside) }
  }, [buildings])

  return (
    <group>
      {named.map((b) => (
        <mesh
          key={b.id}
          geometry={buildingGeometry(b)}
          onClick={(e) => {
            e.stopPropagation()
            onSelect(b)
          }}
        >
          <meshStandardMaterial
            color={selectedId === b.id ? '#e8b84b' : FEATURE_COLOR[b.feature] ?? '#8a8f94'}
            emissive={selectedId === b.id ? '#7a5c10' : '#000000'}
            roughness={0.85}
            metalness={0.05}
          />
        </mesh>
      ))}
      {mergedInside && (
        <mesh geometry={mergedInside}>
          <meshStandardMaterial color="#767c84" roughness={0.9} />
        </mesh>
      )}
      {mergedOutside && (
        <mesh geometry={mergedOutside}>
          <meshStandardMaterial color="#3d434a" roughness={0.95} />
        </mesh>
      )}
    </group>
  )
}
