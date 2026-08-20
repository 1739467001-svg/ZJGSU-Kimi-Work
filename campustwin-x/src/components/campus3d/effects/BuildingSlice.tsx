import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import { FEATURE_COLOR } from '../../../lib/campusData'
import type { Room } from '../../../lib/agentTypes'
import { useCampusStore } from '../../../store/campusStore'
import { getLabelSkin } from '../labels/SceneLabels'

/** 分层展开:相邻楼层板错开距离(m,爆炸图式,底层不动) */
const EXPAND_GAP = 2.2
/** 单层楼伪剖层透明度 */
const SHELL_OPACITY = 0.3
/** 楼层板不透明度 */
const SLAB_OPACITY = 0.92
const ROOM_COLOR = '#b9c8d4' // 普通房间标记:冷灰蓝
const CANDIDATE_COLOR = '#3aa7ff' // AI 高亮房间(候选蓝)
const SELECTED_COLOR = '#e8b84b' // 选中房间(金)
/** 房间名标签世界高度(m) */
const ROOM_LABEL_H = 2.2
/** 楼层号标签世界高度(m) */
const FLOOR_LABEL_H = 3.0

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
 * 楼宇分层视图(campusStore.slicedBuildingId 触发,试点:点击信电楼自动进入):
 * - 多层楼(levels>1):按层拆板,爆炸图式逐层抬高 EXPAND_GAP,显示每层全部房间
 *   标记(浮出小 box,InstancedMesh)+ 房间名标签 + 西侧楼层号标签;
 * - 单层楼:整楼半透明壳 opacity 0.3 + 全部房间标记;
 * - AI 联动:highlightedRoomIds 房间染候选蓝、selectedRoomId 染金,所在层楼板微发光。
 * 说明:本组件自绘分层视图,不改动原楼体;集成方在分层期间已将原楼(灰盒/精模)隐藏。
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

  // 分层显示该楼全部房间(AI 高亮/选中仅改配色,不再过滤)
  const buildingRooms = useMemo(
    () => (building ? rooms.filter((r) => r.buildingId === building.id) : []),
    [building, rooms],
  )

  // 含高亮/选中房间的楼层:楼板微发光提示
  const hotFloors = useMemo(() => {
    const set = new Set<number>()
    for (const r of buildingRooms) {
      if (highlightedRoomIds.includes(r.id) || r.id === selectedRoomId) set.add(r.floor)
    }
    return set
  }, [buildingRooms, highlightedRoomIds, selectedRoomId])

  // 多层楼 → 逐层楼板;单层楼 → 整体壳
  const slabMode = !!building && building.levels > 1
  const levels = building?.levels ?? 1
  const slabH = building ? building.height / Math.max(levels, 1) : 0

  const slabGeoms = useMemo(() => {
    if (!building || !slabMode) return []
    return Array.from({ length: levels }, () => extrudeFootprint(building, slabH * 0.94))
  }, [building, slabMode, levels, slabH])

  const shellGeom = useMemo(
    () => (building && !slabMode ? extrudeFootprint(building, building.height) : null),
    [building, slabMode],
  )

  useEffect(() => () => slabGeoms.forEach((g) => g.dispose()), [slabGeoms])
  useEffect(() => () => shellGeom?.dispose(), [shellGeom])

  const slabMeshRefs = useRef<(THREE.Mesh | null)[]>([])
  const shellRef = useRef<THREE.Mesh | null>(null)
  const markerRef = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // 楼层展开抬高量:floor(1 基)→ (floor-1) * EXPAND_GAP
  const floorLift = (floor: number) => (Math.min(floor, levels) - 1) * EXPAND_GAP

  // 房间浮出标记(世界坐标,随楼层展开同步抬高)
  const markers = useMemo(() => {
    if (!building) return []
    return buildingRooms.map((room) => {
      const [x, y0, z] = roomWorldPosition(room, building)
      const lift = slabMode ? floorLift(room.floor) : 0
      return {
        id: room.id,
        name: room.name,
        selected: room.id === selectedRoomId,
        highlighted: highlightedRoomIds.includes(room.id),
        pos: [x, y0 + lift + 1.2, z] as [number, number, number],
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building, buildingRooms, slabMode, selectedRoomId, highlightedRoomIds, slabH])

  // 楼层号标签锚点:footprint 西端(x 最小)外侧 6m,各层板中点高度
  const floorLabelAnchor = useMemo(() => {
    if (!building) return { x: 0, z: 0 }
    let minX = Infinity
    for (const [x] of building.footprint) if (x < minX) minX = x
    return { x: minX - 6, z: building.center[1] }
  }, [building])

  // 标记配色:普通冷灰蓝 / 高亮蓝 / 选中金
  useEffect(() => {
    const im = markerRef.current
    if (!im) return
    const c = new THREE.Color()
    markers.forEach((m, i) => {
      c.set(m.selected ? SELECTED_COLOR : m.highlighted ? CANDIDATE_COLOR : ROOM_COLOR)
      im.setColorAt(i, c)
    })
    if (im.instanceColor) im.instanceColor.needsUpdate = true
  }, [markers])

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime
    const damp = (cur: number, target: number) => THREE.MathUtils.damp(cur, target, 6, delta)

    if (building && slabMode) {
      slabMeshRefs.current.forEach((mesh, i) => {
        if (!mesh) return
        // 爆炸图式展开:各层从堆叠态阻尼抬升至 i*EXPAND_GAP
        mesh.position.y = damp(mesh.position.y, i * slabH + i * EXPAND_GAP)
        const mat = mesh.material as THREE.MeshStandardMaterial
        mat.opacity = damp(mat.opacity, SLAB_OPACITY)
      })
    }
    if (building && !slabMode && shellRef.current) {
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
      {slabMode &&
        slabGeoms.map((g, i) => (
          <mesh
            key={`slab_${i}`}
            geometry={g}
            position={[0, i * slabH, 0]}
            ref={(m) => {
              slabMeshRefs.current[i] = m
            }}
          >
            <meshStandardMaterial
              color={baseColor}
              emissive={hotFloors.has(i + 1) ? CANDIDATE_COLOR : '#000000'}
              emissiveIntensity={hotFloors.has(i + 1) ? 0.35 : 0}
              transparent
              opacity={SLAB_OPACITY}
              roughness={0.85}
              metalness={0.05}
              depthWrite={false}
            />
          </mesh>
        ))}
      {!slabMode && shellGeom && (
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

      {/* 楼层号标签(各层板西端外侧,随层抬高) */}
      {slabMode &&
        slabGeoms.map((_, i) => {
          const skin = getLabelSkin(`floor:${building.id}:${i + 1}`, `${i + 1}F`)
          return (
            <sprite
              key={`floor_${i}`}
              position={[floorLabelAnchor.x, i * slabH + slabH / 2 + i * EXPAND_GAP, floorLabelAnchor.z]}
              scale={[FLOOR_LABEL_H * skin.aspect, FLOOR_LABEL_H, 1]}
              renderOrder={11}
            >
              <spriteMaterial map={skin.texture} transparent depthWrite={false} toneMapped={false} />
            </sprite>
          )
        })}

      {/* 房间名标签(浮于房间标记上方) */}
      {markers.map((m) => {
        const skin = getLabelSkin(`room:${m.id}`, m.name)
        return (
          <sprite
            key={`rlabel_${m.id}`}
            position={[m.pos[0], m.pos[1] + 2.1, m.pos[2]]}
            scale={[ROOM_LABEL_H * skin.aspect, ROOM_LABEL_H, 1]}
            renderOrder={12}
          >
            <spriteMaterial map={skin.texture} transparent depthWrite={false} toneMapped={false} />
          </sprite>
        )
      })}

      {/* 房间标记(全部房间,实例化) */}
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
