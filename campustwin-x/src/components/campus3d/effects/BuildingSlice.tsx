import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import { FEATURE_COLOR } from '../../../lib/campusData'
import type { Room } from '../../../lib/agentTypes'
import { useCampusStore } from '../../../store/campusStore'

/** 目标层错开距离(m) */
const EXPAND_STEP = 1.5
/** 非目标层透明度 */
const DIM_OPACITY = 0.12
/** 普通楼伪剖层透明度 */
const SHELL_OPACITY = 0.3
const CANDIDATE_COLOR = '#3aa7ff'
const SELECTED_COLOR = '#e8b84b'

/** footprint → 拉伸 height 的楼体几何(与 Buildings.tsx 同一坐标约定:Shape 用 (x,-z),extrude 后 rotateX(-90°)) */
function extrudeFootprint(b: BakedBuilding, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

/** 字符串 → 稳定伪随机 [-1,1](房间无 positionHint 时的确定性布点) */
function hashUnit(s: string, salt: number): number {
  let h = 2166136261 + salt
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 2000) / 1000 - 1
}

/**
 * 房间世界坐标:positionHint(相对楼体中心偏移)优先;
 * 缺省时按房间 id 哈希在 footprint 中心附近确定性布点,y 取所在楼层顶。
 */
export function roomWorldPosition(room: Room, building: BakedBuilding): [number, number, number] {
  const slabH = building.height / Math.max(building.levels, 1)
  const floorTop = Math.min(room.floor, building.levels) * slabH
  if (room.positionHint) {
    return [building.center[0] + room.positionHint[0], room.positionHint[1], building.center[1] + room.positionHint[2]]
  }
  return [
    building.center[0] + hashUnit(room.id, 1) * 6,
    floorTop,
    building.center[1] + hashUnit(room.id, 2) * 6,
  ]
}

interface Props {
  buildings: BakedBuilding[]
  /** 缺省读 campusStore.rooms */
  rooms?: Room[]
}

/**
 * 楼宇剖层(campusStore.slicedBuildingId 触发):
 * - hero 分段楼层结构(综合大楼):按层拆板,非目标层 opacity→0.12,目标层 y 错开 1.5m 展开;
 * - 普通楼伪剖层:整楼半透明壳 opacity 0.3;
 * - 目标房间(highlightedRoomIds / selectedRoomId)在 positionHint 处浮出小 box(InstancedMesh)。
 * 说明:本组件自绘剖层视图,不改动 Buildings.tsx;集成方在剖层期间应将原楼体网格隐藏/调暗。
 */
export default function BuildingSlice({ buildings, rooms: roomsProp }: Props) {
  const slicedBuildingId = useCampusStore((s) => s.slicedBuildingId)
  const highlightedRoomIds = useCampusStore((s) => s.highlightedRoomIds)
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const storeRooms = useCampusStore((s) => s.rooms)
  const rooms = roomsProp ?? storeRooms

  const building = useMemo(
    () => buildings.find((b) => b.id === slicedBuildingId) ?? null,
    [buildings, slicedBuildingId],
  )

  const targetRooms = useMemo(() => {
    if (!building) return []
    return rooms.filter(
      (r) => r.buildingId === building.id && (highlightedRoomIds.includes(r.id) || r.id === selectedRoomId),
    )
  }, [building, rooms, highlightedRoomIds, selectedRoomId])

  // 目标层集合(1 基);无目标房间时兜底 1 层,保证剖层可视
  const targetFloors = useMemo(() => {
    const set = new Set(targetRooms.map((r) => r.floor))
    if (set.size === 0) set.add(1)
    return set
  }, [targetRooms])

  const isHero = !!building && building.hero && building.levels > 1

  // hero:每层楼板几何(构建时切好,非运行时切)
  const slabGeoms = useMemo(() => {
    if (!building || !isHero) return []
    const slabH = building.height / building.levels
    return Array.from({ length: building.levels }, () => extrudeFootprint(building, slabH * 0.94))
  }, [building, isHero])

  // 普通楼:整体壳几何
  const shellGeom = useMemo(
    () => (building && !isHero ? extrudeFootprint(building, building.height) : null),
    [building, isHero],
  )

  useEffect(() => () => slabGeoms.forEach((g) => g.dispose()), [slabGeoms])
  useEffect(() => () => shellGeom?.dispose(), [shellGeom])

  const slabMeshRefs = useRef<(THREE.Mesh | null)[]>([])
  const shellRef = useRef<THREE.Mesh | null>(null)
  const markerRef = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // 楼层展开偏移(目标层按序错开 EXPAND_STEP)
  const floorOffset = useMemo(() => {
    if (!building || !isHero) return new Map<number, number>()
    const sorted = [...targetFloors].sort((a, b) => a - b)
    return new Map(sorted.map((f, i) => [f, (i + 1) * EXPAND_STEP]))
  }, [building, isHero, targetFloors])

  // 房间浮出标记(世界坐标)
  const markers = useMemo(() => {
    if (!building) return []
    const slabH = building.height / Math.max(building.levels, 1)
    return targetRooms.map((room) => {
      const [x, y0, z] = roomWorldPosition(room, building)
      const expand = isHero ? (floorOffset.get(room.floor) ?? 0) : 0
      return {
        id: room.id,
        selected: room.id === selectedRoomId,
        pos: [x, (room.positionHint ? y0 : Math.min(room.floor, building.levels) * slabH) + expand + 1.2, z] as [
          number,
          number,
          number,
        ],
      }
    })
  }, [building, targetRooms, isHero, floorOffset, selectedRoomId])

  // 标记配色:候选蓝 / 选中金
  useEffect(() => {
    const im = markerRef.current
    if (!im) return
    const c = new THREE.Color()
    markers.forEach((m, i) => {
      c.set(m.selected ? SELECTED_COLOR : CANDIDATE_COLOR)
      im.setColorAt(i, c)
    })
    if (im.instanceColor) im.instanceColor.needsUpdate = true
  }, [markers])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const damp = (cur: number, target: number) => THREE.MathUtils.damp(cur, target, 6, delta)

    if (building && isHero) {
      const slabH = building.height / building.levels
      slabMeshRefs.current.forEach((mesh, i) => {
        if (!mesh) return
        const floor = i + 1
        const isTarget = targetFloors.has(floor)
        const targetY = i * slabH + (isTarget ? (floorOffset.get(floor) ?? 0) : 0)
        mesh.position.y = damp(mesh.position.y, targetY)
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.opacity = damp(mat.opacity, isTarget ? 0.95 : DIM_OPACITY)
      })
    }
    if (building && !isHero && shellRef.current) {
      const mat = shellRef.current.material as THREE.MeshStandardMaterial
      mat.opacity = damp(mat.opacity, SHELL_OPACITY)
    }
    // 标记轻微浮动
    const im = markerRef.current
    if (im) {
      markers.forEach((m, i) => {
        dummy.position.set(m.pos[0], m.pos[1] + Math.sin(t * 2 + i * 1.3) * 0.3, m.pos[2])
        dummy.updateMatrix()
        im.setMatrixAt(i, dummy.matrix)
      })
      im.instanceMatrix.needsUpdate = true
    }
  })

  if (!building) return null
  const baseColor = FEATURE_COLOR[building.feature] ?? '#8a8f94'

  return (
    <group>
      {isHero &&
        slabGeoms.map((g, i) => (
          <mesh
            key={`slab_${i}`}
            geometry={g}
            position={[0, (i * building.height) / building.levels, 0]}
            ref={(m) => {
              slabMeshRefs.current[i] = m
            }}
          >
            <meshStandardMaterial
              color={baseColor}
              emissive={targetFloors.has(i + 1) ? CANDIDATE_COLOR : '#000000'}
              emissiveIntensity={targetFloors.has(i + 1) ? 0.35 : 0}
              transparent
              opacity={0.95}
              roughness={0.85}
              metalness={0.05}
              depthWrite={false}
            />
          </mesh>
        ))}
      {!isHero && shellGeom && (
        <mesh geometry={shellGeom} ref={shellRef}>
          <meshStandardMaterial
            color={baseColor}
            transparent
            opacity={SHELL_OPACITY}
            roughness={0.85}
            metalness={0.05}
            depthWrite={false}
          />
        </mesh>
      )}
      {markers.length > 0 && (
        <instancedMesh
          key={markers.map((m) => m.id).join('|')}
          args={[undefined, undefined, markers.length]}
          ref={markerRef}
          frustumCulled={false}
        >
          <boxGeometry args={[2.6, 1.8, 2.6]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      )}
    </group>
  )
}
