import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import { FEATURE_COLOR } from '../../../lib/campusData'
import type { Room } from '../../../lib/agentTypes'
import { useCampusStore } from '../../../store/campusStore'
import { computeFloorLayout, type FloorLayout } from '../../../lib/floorLayout'
import { getLabelSkin } from '../labels/SceneLabels'

/** 分层展开:相邻楼层板错开距离(m,爆炸图式,底层不动) */
const EXPAND_GAP = 2.2
/** 单层楼伪剖层透明度 */
const SHELL_OPACITY = 0.3
/** 楼层板不透明度 */
const SLAB_OPACITY = 0.92
/** 房间单元格目标高度(m,顶面=房间顶;低层高楼按 slabH 压限) */
const ROOM_CELL_H = 2.8
/** 楼层标签超过该房间数时,只显示高亮/选中房间的标签 */
const MAX_FLOOR_LABELS = 40

// ---------------------------------------------------------------------------
// 配色表
// ---------------------------------------------------------------------------
const ROOM_COLOR = '#b9c8d4' // 普通房间:冷灰蓝
const BUSY_TINT = '#d08379' // status=busy:微红
const REPAIR_TINT = '#e0994b' // status=repair:橙
const CANDIDATE_COLOR = '#3aa7ff' // AI 高亮房间(候选蓝)
const SELECTED_COLOR = '#e8b84b' // 选中房间(金)
const CORRIDOR_COLOR = '#d8e2ea' // 走廊地坪:略亮的冷灰
const CORE_COLOR = '#454b54' // 楼电梯间(交通核):深灰

/** 楼层号标签世界高度(m) */
const FLOOR_LABEL_H = 3.0

/** footprint → 拉伸 height 的楼体几何(与 Buildings.tsx 同一坐标约定:Shape 用 (x,-z),extrude 后 rotateX(-90°)) */
function extrudeFootprint(b: BakedBuilding, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

/**
 * 房间世界坐标(供 AlarmPulse 等外部模块复用):
 * positionHint(相对楼体中心偏移)优先;否则按 computeFloorLayout 真实布局
 * 取房间单元格中心,y 取所在楼层顶。已移除哈希随机布点。
 */
export function roomWorldPosition(room: Room, building: BakedBuilding): [number, number, number] {
  const slabH = building.height / Math.max(building.levels, 1)
  const floorTop = Math.min(room.floor, building.levels) * slabH
  if (room.positionHint) {
    return [building.center[0] + room.positionHint[0], room.positionHint[1], building.center[1] + room.positionHint[2]]
  }
  const rooms = useCampusStore.getState().rooms.filter((r) => r.buildingId === building.id)
  const cell = computeFloorLayout(building, rooms, room.floor).cells.find((c) => c.roomId === room.id)
  if (cell) return [building.center[0] + cell.x, floorTop, building.center[1] + cell.z]
  return [building.center[0], floorTop, building.center[1]]
}

// ---------------------------------------------------------------------------
// 单层平面内容:房间单元格(InstancedMesh)+ 走廊条带 + 交通核 + 房间标签
// 坐标约定:组内局部 = 世界坐标(组仅承担 y 方向爆炸抬升,初始 0 → idx*EXPAND_GAP)
// ---------------------------------------------------------------------------
interface FloorPlanProps {
  layout: FloorLayout
  roomsById: Map<string, Room>
  /** 楼体中心(布局局部坐标 → 世界坐标的偏移) */
  ox: number
  oz: number
  /** 本层地坪 y(组内局部,已含 idx*slabH) */
  baseY: number
  /** 单元格高度(≤2.8m,低层高楼压限) */
  roomH: number
  selectedRoomId: string | null
  highlighted: Set<string>
  /** 本层含高亮/选中房间(走廊微亮) */
  hot: boolean
  /** 本层含选中房间(走廊强亮引导) */
  hasSelected: boolean
}

function FloorPlan({
  layout,
  roomsById,
  ox,
  oz,
  baseY,
  roomH,
  selectedRoomId,
  highlighted,
  hot,
  hasSelected,
}: FloorPlanProps) {
  // 单位盒几何:房间实例/走廊条带/交通核共享,按实例矩阵或 mesh scale 拉伸
  const boxGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), [])
  useEffect(() => () => boxGeo.dispose(), [boxGeo])

  const cells = layout.cells
  const cellKey = cells.map((c) => c.roomId).join('|')
  const cellsRef = useRef<THREE.InstancedMesh | null>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])

  // 实例矩阵:静态(布局确定后不再逐帧更新,升降由父级楼层组承担)
  useEffect(() => {
    const im = cellsRef.current
    if (!im) return
    cells.forEach((c, i) => {
      dummy.position.set(ox + c.x, baseY + roomH / 2, oz + c.z)
      dummy.scale.set(Math.max(c.w, 0.4), roomH, Math.max(c.d, 0.4))
      dummy.updateMatrix()
      im.setMatrixAt(i, dummy.matrix)
    })
    im.instanceMatrix.needsUpdate = true
  }, [cells, ox, oz, baseY, roomH, dummy])

  // 实例配色:选中金 > 候选蓝 > busy 微红 / repair 橙 > 默认冷灰蓝
  useEffect(() => {
    const im = cellsRef.current
    if (!im) return
    const col = new THREE.Color()
    cells.forEach((c, i) => {
      const room = roomsById.get(c.roomId)
      if (c.roomId === selectedRoomId) col.set(SELECTED_COLOR)
      else if (highlighted.has(c.roomId)) col.set(CANDIDATE_COLOR)
      else if (room?.status === 'busy') col.set(BUSY_TINT)
      else if (room?.status === 'repair') col.set(REPAIR_TINT)
      else col.set(ROOM_COLOR)
      im.setColorAt(i, col)
    })
    if (im.instanceColor) im.instanceColor.needsUpdate = true
  }, [cells, roomsById, selectedRoomId, highlighted])

  // 标签预算:>40 房间的楼层只显示高亮/选中房间的标签
  const showAll = cells.length <= MAX_FLOOR_LABELS

  return (
    <group>
      {/* 走廊条带地坪(略亮;选中房间所在层加强引导) */}
      {layout.corridor.map((r, i) => (
        <mesh
          key={`corr_${i}`}
          geometry={boxGeo}
          position={[ox + r.x, baseY + 0.06, oz + r.z]}
          scale={[r.w, 0.12, r.d]}
        >
          <meshStandardMaterial
            color={CORRIDOR_COLOR}
            emissive={hasSelected ? SELECTED_COLOR : hot ? CANDIDATE_COLOR : '#000000'}
            emissiveIntensity={hasSelected ? 0.5 : hot ? 0.25 : 0}
            roughness={0.7}
            metalness={0.05}
          />
        </mesh>
      ))}

      {/* 楼电梯间(交通核,深灰小方块) */}
      {layout.cores.map((c, i) => (
        <mesh
          key={`core_${i}`}
          geometry={boxGeo}
          position={[ox + c.x, baseY + roomH * 0.45, oz + c.z]}
          scale={[1.8, roomH * 0.9, 1.8]}
        >
          <meshStandardMaterial color={CORE_COLOR} roughness={0.85} metalness={0.1} />
        </mesh>
      ))}

      {/* 房间单元格(真实尺寸矮盒体,全部实例化) */}
      {cells.length > 0 && (
        <instancedMesh
          key={cellKey}
          args={[undefined, undefined, cells.length]}
          ref={cellsRef}
          frustumCulled={false}
        >
          <primitive object={boxGeo} attach="geometry" />
          <meshStandardMaterial roughness={0.6} metalness={0.05} />
        </instancedMesh>
      )}

      {/* 房间号标签(贴 cell 顶面上方 0.5m,字号随面宽缩放;小房间只显示号码) */}
      {cells.map((c) => {
        if (!showAll && c.roomId !== selectedRoomId && !highlighted.has(c.roomId)) return null
        const room = roomsById.get(c.roomId)
        if (!room) return null
        const narrow = Math.min(c.w, c.d) < 5
        const num = room.name.match(/\d+/)?.[0]
        const text = narrow && num ? num : room.name
        const skin = getLabelSkin(`rc:${room.id}:${text}`, text)
        const h = THREE.MathUtils.clamp(Math.min(c.w, c.d) * 0.3, 0.8, 2.0)
        return (
          <sprite
            key={`rlabel_${c.roomId}`}
            position={[ox + c.x, baseY + roomH + 0.5, oz + c.z]}
            scale={[h * skin.aspect, h, 1]}
            renderOrder={12}
          >
            <spriteMaterial map={skin.texture} transparent depthWrite={false} toneMapped={false} />
          </sprite>
        )
      })}
    </group>
  )
}

interface Props {
  buildings: BakedBuilding[]
  /** 缺省读 campusStore.rooms */
  rooms?: Room[]
}

/**
 * 楼宇分层视图(campusStore.slicedBuildingId 触发,试点:点击信电楼自动进入):
 * - 多层楼(levels>1):按层拆板,爆炸图式逐层抬高 EXPAND_GAP,每层渲染
 *   computeFloorLayout 真实楼层平面——房间为真实尺寸单元格(InstancedMesh,
 *   高≈2.8m 矮盒体)、走廊为略亮条带地坪、交通核为深灰小方块、房间号标签
 *   贴 cell 顶面;
 * - 单层楼:整楼半透明壳 opacity 0.3 + 同样的布局渲染(一层);
 * - AI 联动:highlightedRoomIds 染候选蓝、selectedRoomId 染金并附加从地面
 *   贯穿到房间的垂直脉冲光柱(加法混合呼吸圆柱),所在层走廊微亮、楼板微发光;
 * - 状态色:busy 微红 / repair 橙,其余冷灰蓝。
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

  const roomsById = useMemo(() => new Map(buildingRooms.map((r) => [r.id, r])), [buildingRooms])
  const highlighted = useMemo(() => new Set(highlightedRoomIds), [highlightedRoomIds])

  // 含高亮/选中房间的楼层:楼板微发光 + 走廊微亮提示
  const hotFloors = useMemo(() => {
    const set = new Set<number>()
    for (const r of buildingRooms) {
      if (highlighted.has(r.id) || r.id === selectedRoomId) set.add(r.floor)
    }
    return set
  }, [buildingRooms, highlighted, selectedRoomId])

  // 多层楼 → 逐层楼板;单层楼 → 整体壳
  const slabMode = !!building && building.levels > 1
  const levels = building?.levels ?? 1
  const slabH = building ? building.height / Math.max(levels, 1) : 0
  const roomH = Math.min(ROOM_CELL_H, slabH * 0.8)

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

  // 逐层真实平面布局(确定性;单层楼壳模式同样渲染第 1 层布局)
  const floorGroups = useMemo(() => {
    if (!building) return []
    const floors = slabMode ? Array.from({ length: levels }, (_, i) => i + 1) : [1]
    return floors.map((f) => ({
      floor: f,
      idx: f - 1,
      layout: computeFloorLayout(building, buildingRooms, f),
    }))
  }, [building, buildingRooms, slabMode, levels])

  // 选中房间 → 所在单元格与楼层(脉冲光柱锚点)
  const selectedInfo = useMemo(() => {
    if (!building || !selectedRoomId) return null
    for (const fg of floorGroups) {
      const cell = fg.layout.cells.find((c) => c.roomId === selectedRoomId)
      if (cell) return { cell, idx: fg.idx, floor: fg.floor }
    }
    return null
  }, [building, selectedRoomId, floorGroups])

  const slabMeshRefs = useRef<(THREE.Mesh | null)[]>([])
  const shellRef = useRef<THREE.Mesh | null>(null)
  const floorGroupRefs = useRef<(THREE.Group | null)[]>([])
  const liftRef = useRef<number[]>([]) // 各层当前抬升量(脉冲光柱同步用)
  const columnRef = useRef<THREE.Mesh | null>(null)

  // 楼层号标签锚点:footprint 西端(x 最小)外侧 6m,各层板中点高度
  const floorLabelAnchor = useMemo(() => {
    if (!building) return { x: 0, z: 0 }
    let minX = Infinity
    for (const [x] of building.footprint) if (x < minX) minX = x
    return { x: minX - 6, z: building.center[1] }
  }, [building])

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
    // 楼层平面组与楼板同节奏抬升(内容初始即在各层堆叠位,组只补 i*EXPAND_GAP)
    floorGroupRefs.current.forEach((g, i) => {
      if (!g) return
      const target = slabMode ? i * EXPAND_GAP : 0
      g.position.y = damp(g.position.y, target)
      liftRef.current[i] = g.position.y
    })
    // 选中房间:地面 → 房间顶的垂直脉冲光柱(呼吸动画)
    const col = columnRef.current
    if (col) {
      if (selectedInfo && building) {
        const lift = liftRef.current[selectedInfo.idx] ?? 0
        const top = selectedInfo.idx * slabH + slabH * 0.04 + roomH + lift + 0.4
        col.visible = true
        col.position.set(
          building.center[0] + selectedInfo.cell.x,
          Math.max(top, 0.1) / 2,
          building.center[1] + selectedInfo.cell.z,
        )
        const breathe = Math.sin(t * 3)
        const r =
          THREE.MathUtils.clamp(
            Math.min(selectedInfo.cell.w, selectedInfo.cell.d) * 0.35,
            0.5,
            1.6,
          ) *
          (1 + 0.08 * breathe)
        col.scale.set(r, Math.max(top, 0.1), r)
        const mat = col.material as THREE.MeshBasicMaterial
        mat.opacity = 0.2 + 0.13 * breathe
      } else {
        col.visible = false
      }
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

      {/* 逐层真实楼层平面(房间单元格 + 走廊 + 交通核 + 房间号标签) */}
      {floorGroups.map((fg) => (
        <group
          key={`fg_${fg.floor}`}
          ref={(g) => {
            floorGroupRefs.current[fg.idx] = g
          }}
        >
          <FloorPlan
            layout={fg.layout}
            roomsById={roomsById}
            ox={building.center[0]}
            oz={building.center[1]}
            baseY={fg.idx * slabH + slabH * 0.04}
            roomH={roomH}
            selectedRoomId={selectedRoomId}
            highlighted={highlighted}
            hot={hotFloors.has(fg.floor)}
            hasSelected={selectedInfo?.floor === fg.floor}
          />
        </group>
      ))}

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

      {/* 选中房间垂直脉冲光柱(加法混合,呼吸动画;实际位置/高度在 useFrame 中同步) */}
      {selectedInfo && (
        <mesh ref={columnRef} frustumCulled={false} renderOrder={13}>
          <cylinderGeometry args={[1, 1, 1, 24, 1, true]} />
          <meshBasicMaterial
            color={SELECTED_COLOR}
            transparent
            opacity={0.25}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
    </group>
  )
}
