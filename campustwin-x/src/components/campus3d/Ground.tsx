import { useMemo } from 'react'
import * as THREE from 'three'
import type { BakedWater, BakedGreen, BakedRoad, BakedLandmark } from '../../lib/campusData'

const flat = (ring: [number, number][]): THREE.Shape => new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)))

function FlatPoly({ ring, y, color, opacity = 1 }: { ring: [number, number][]; y: number; color: string; opacity?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.ShapeGeometry(flat(ring))
    g.rotateX(-Math.PI / 2)
    return g
  }, [ring])
  return (
    <mesh geometry={geom} position={[0, y, 0]}>
      <meshStandardMaterial color={color} transparent={opacity < 1} opacity={opacity} roughness={0.9} />
    </mesh>
  )
}

const LANDMARK_COLOR: Record<string, string> = {
  gate: '#e8b84b', lake: '#5ac8d8', statue: '#d8c9a8', clock: '#e8d47a',
  plaza: '#9a8fb8', flowerfield: '#d88ab0', metro: '#4a90d8', sport: '#7fd8a8',
}

export default function Ground({ water, green, roads, landmarks }: {
  water: BakedWater[]; green: BakedGreen[]; roads: BakedRoad[]; landmarks: BakedLandmark[]
}) {
  const roadLines = useMemo(() => {
    // 灰盒阶段:道路用细线条表达方位(M2 换条带网格+流光)
    return roads.map((r) => {
      const pts = r.points.map(([x, z]) => new THREE.Vector3(x, 0.6, z))
      const g = new THREE.BufferGeometry().setFromPoints(pts)
      const m = new THREE.LineBasicMaterial({ color: r.name ? '#5a636e' : '#3a4148' })
      return { id: r.id, line: new THREE.Line(g, m) }
    })
  }, [roads])

  return (
    <group>
      {/* 沙盘基座 */}
      <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[2600, 1400]} />
        <meshStandardMaterial color="#14181d" roughness={1} />
      </mesh>
      {/* 绿地 / 运动场 */}
      {green.map((g) => (
        <FlatPoly key={g.id} ring={g.ring} y={0.15}
          color={['pitch', 'playground', 'track'].includes(g.kind) ? '#4a3f35' : '#24382c'} />
      ))}
      {/* 水系 */}
      {water.map((w) => (
        <FlatPoly key={w.id} ring={w.ring} y={0.3} color={w.hero ? '#2a5a6a' : '#1e3d48'} opacity={0.92} />
      ))}
      {/* 道路线 */}
      {roadLines.map((r) => (
        <primitive key={r.id} object={r.line} />
      ))}
      {/* 地标标记 */}
      {landmarks.map((l) => (
        <mesh key={l.id} position={[l.position[0], 3, l.position[1]]}>
          <coneGeometry args={[2.5, 6, 6]} />
          <meshStandardMaterial color={LANDMARK_COLOR[l.kind] ?? '#aaaaaa'} emissive={LANDMARK_COLOR[l.kind] ?? '#000000'} emissiveIntensity={0.35} />
        </mesh>
      ))}
    </group>
  )
}
