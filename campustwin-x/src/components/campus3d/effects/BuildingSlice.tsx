// 楼宇分层剖切视图(动效流畅度改造版)
// 要点:
// ① 布局计算走 getCachedFloorLayout(跨组件共享缓存,同楼同层只算一遍);
// ② 楼层内容(房间/走廊/标签)分帧渐进挂载:高/中档每帧 2 层、低档每帧 1 层,
//    点击那一帧只挂楼板,重活摊到后续 ~levels×2 帧;
// ③ 展开/收起均为错峰(cascade)时间轴补间:展开 1F→顶层依次延迟启动,
//    cubic ease-out;收起反向(顶层先落),从当前位置捕获起点,可中途打断不重跳;
// ④ 房间标签第二段挂载(内容全部就绪后逐层补)且逐个淡入,避免纹理栅格化挤同一帧;
// ⑤ 收起/切楼有平滑过渡:旧楼以 close 模式保留实例错峰回落,完成后才卸载;
// ⑥ useFrame 全程指令式(ref/position/opacity),构建期 setState 次数有界(≤2×levels)。
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedBuilding } from '../../../lib/campusData'
import { FEATURE_COLOR } from '../../../lib/campusData'
import type { Room } from '../../../lib/agentTypes'
import { useCampusStore } from '../../../store/campusStore'
import { useUIStore } from '../../../store/uiStore'
import { getCachedFloorLayout } from '../../../lib/floorLayout'
import { getLabelSkin, type LabelSkin } from '../labels/SceneLabels'

/** 分层展开:相邻楼层板错开距离(m,爆炸图式,底层不动) */
const EXPAND_GAP = 2.2
/** 单层楼伪剖层透明度 */
const SHELL_OPACITY = 0.3
/** 楼层板不透明度 */
const SLAB_OPACITY = 0.92
/** 房间单元格目标高度(m,顶面=房间顶;低层高楼按 slabH 压限) */
const ROOM_CELL_H = 2.8
/** 楼层标签超过该房间数时,只显示高亮/选中房间的标签(桌面档) */
const MAX_FLOOR_LABELS = 40

// ---------------------------------------------------------------------------
// 错峰动画参数(帧率无关:全部用时钟时间轴驱动)
// ---------------------------------------------------------------------------
/** 单层展开时长(s) */
const OPEN_DUR = 0.9
/** 展开逐层错峰(s):12 层总时长 = 0.9 + 11×0.06 ≈ 1.56s */
const OPEN_STAGGER = 0.06
/** 单层收起时长(s,收起更利落) */
const CLOSE_DUR = 0.65
/** 收起逐层错峰(s,顶层先落):12 层总时长 ≈ 1.2s */
const CLOSE_STAGGER = 0.05
/** 收起动画结束后保留实例的缓冲(s),到点才卸载 */
const CLOSE_BUFFER = 0.2

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

/** 单位盒几何:全部楼层共享(房间实例/走廊条带/交通核),随 App 生命周期常驻 */
const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1)

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
/** cubic ease-out:起步干脆、收尾柔和 */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/** footprint → 拉伸 height 的楼体几何(与 Buildings.tsx 同一坐标约定:Shape 用 (x,-z),extrude 后 rotateX(-90°)) */
function extrudeFootprint(b: BakedBuilding, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

/**
 * 房间世界坐标(供 AlarmPulse 等外部模块复用):
 * positionHint(相对楼体中心偏移)优先;否则按缓存布局取房间单元格中心,
 * y 取所在楼层顶。已移除哈希随机布点。
 */
export function roomWorldPosition(room: Room, building: BakedBuilding): [number, number, number] {
  const slabH = building.height / Math.max(building.levels, 1)
  const floorTop = Math.min(room.floor, building.levels) * slabH
  if (room.positionHint) {
    return [building.center[0] + room.positionHint[0], room.positionHint[1], building.center[1] + room.positionHint[2]]
  }
  const rooms = useCampusStore.getState().rooms
  const cell = getCachedFloorLayout(building, rooms, room.floor).cells.find((c) => c.roomId === room.id)
  if (cell) return [building.center[0] + cell.x, floorTop, building.center[1] + cell.z]
  return [building.center[0], floorTop, building.center[1]]
}

// ---------------------------------------------------------------------------
// 淡入文字标签:挂载时 opacity=0,useFrame 阻尼淡入到 1(指令式,无 setState)
// ---------------------------------------------------------------------------
interface FadeInSpriteProps {
  position: [number, number, number]
  scale: [number, number, number]
  skin: LabelSkin
  renderOrder: number
}

function FadeInSprite({ position, scale, skin, renderOrder }: FadeInSpriteProps) {
  const ref = useRef<THREE.Sprite | null>(null)
  const doneRef = useRef(false)
  useFrame((_, dt) => {
    if (doneRef.current) return
    const s = ref.current
    if (!s) return
    const m = s.material as THREE.SpriteMaterial
    m.opacity = THREE.MathUtils.damp(m.opacity, 1, 5, dt)
    if (m.opacity > 0.995) {
      m.opacity = 1
      doneRef.current = true
    }
  })
  return (
    <sprite ref={ref} position={position} scale={scale} renderOrder={renderOrder}>
      <spriteMaterial map={skin.texture} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </sprite>
  )
}

// ---------------------------------------------------------------------------
// 单层平面内容:房间单元格(InstancedMesh)+ 走廊条带 + 交通核 + 房间标签
// 坐标约定:组内局部 = 世界坐标(组仅承担 y 方向爆炸抬升)
// 布局在本组件 useMemo 内按需计算(缓存命中即零成本),配合父级分帧挂载,
// 把弧形楼/非矩形楼的多边形合法化重活摊到多帧。
// ---------------------------------------------------------------------------
interface FloorPlanProps {
  building: BakedBuilding
  /** store 全量 rooms(缓存键需要引用稳定) */
  rooms: Room[]
  floor: number
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
  /** 第二段构建信号:true 时才挂载房间标签(逐个淡入) */
  labelsOn: boolean
  /** 本层标签全量显示预算(超过则只显示高亮/选中) */
  maxLabels: number
}

function FloorPlan({
  building,
  rooms,
  floor,
  roomsById,
  ox,
  oz,
  baseY,
  roomH,
  selectedRoomId,
  highlighted,
  hot,
  hasSelected,
  labelsOn,
  maxLabels,
}: FloorPlanProps) {
  // 缓存布局:同 (building, rooms引用, floor) 全场景只算一次
  const layout = useMemo(() => getCachedFloorLayout(building, rooms, floor), [building, rooms, floor])

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

  // 标签预算:超过 maxLabels 的楼层只显示高亮/选中房间的标签(low 档 maxLabels=0)
  const showAll = cells.length <= maxLabels

  return (
    <group>
      {/* 走廊条带地坪(略亮;选中房间所在层加强引导) */}
      {layout.corridor.map((r, i) => (
        <mesh
          key={`corr_${i}`}
          geometry={unitBoxGeo}
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
          geometry={unitBoxGeo}
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
          <primitive object={unitBoxGeo} attach="geometry" />
          <meshStandardMaterial roughness={0.6} metalness={0.05} />
        </instancedMesh>
      )}

      {/* 房间号标签(第二段构建才挂载,逐个淡入;贴 cell 顶面上方 0.5m,字号随面宽缩放) */}
      {labelsOn &&
        cells.map((c) => {
          if (!showAll && c.roomId !== selectedRoomId && !highlighted.has(c.roomId)) return null
          const room = roomsById.get(c.roomId)
          if (!room) return null
          const narrow = Math.min(c.w, c.d) < 5
          const num = room.name.match(/\d+/)?.[0]
          const text = narrow && num ? num : room.name
          const skin = getLabelSkin(`rc:${room.id}:${text}`, text)
          const h = THREE.MathUtils.clamp(Math.min(c.w, c.d) * 0.3, 0.8, 2.0)
          return (
            <FadeInSprite
              key={`rlabel_${c.roomId}`}
              position={[ox + c.x, baseY + roomH + 0.5, oz + c.z]}
              scale={[h * skin.aspect, h, 1]}
              skin={skin}
              renderOrder={12}
            />
          )
        })}
    </group>
  )
}

// ---------------------------------------------------------------------------
// 单楼剖切视图(open/close 两种时间轴模式;实例由父级按 building.id key 保持,
// 收起期间不重建,从当前位置捕获起点平滑回落)
// ---------------------------------------------------------------------------
interface SliceViewProps {
  building: BakedBuilding
  mode: 'open' | 'close'
  /** store 全量 rooms */
  rooms: Room[]
}

function SliceView({ building, mode, rooms }: SliceViewProps) {
  const highlightedRoomIds = useCampusStore((s) => s.highlightedRoomIds)
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const quality = useUIStore((s) => s.quality)

  const buildingRooms = useMemo(
    () => rooms.filter((r) => r.buildingId === building.id),
    [rooms, building],
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

  const slabMode = building.levels > 1
  const levels = building.levels
  const slabH = building.height / Math.max(levels, 1)
  const roomH = Math.min(ROOM_CELL_H, slabH * 0.8)
  const floors = useMemo(
    () => (slabMode ? Array.from({ length: levels }, (_, i) => i + 1) : [1]),
    [slabMode, levels],
  )

  const slabGeoms = useMemo(() => {
    if (!slabMode) return []
    return Array.from({ length: levels }, () => extrudeFootprint(building, slabH * 0.94))
  }, [building, slabMode, levels, slabH])
  const shellGeom = useMemo(
    () => (!slabMode ? extrudeFootprint(building, building.height) : null),
    [building, slabMode],
  )
  useEffect(() => () => slabGeoms.forEach((g) => g.dispose()), [slabGeoms])
  useEffect(() => () => shellGeom?.dispose(), [shellGeom])

  // 选中房间 → 所在单元格与楼层(脉冲光柱锚点;布局走缓存)
  const selectedInfo = useMemo(() => {
    if (!selectedRoomId) return null
    for (const f of floors) {
      const cell = getCachedFloorLayout(building, rooms, f).cells.find((c) => c.roomId === selectedRoomId)
      if (cell) return { cell, idx: f - 1, floor: f }
    }
    return null
  }, [building, rooms, floors, selectedRoomId])

  const slabMeshRefs = useRef<(THREE.Mesh | null)[]>([])
  const slabInitRef = useRef<boolean[]>([])
  const shellRef = useRef<THREE.Mesh | null>(null)
  const floorGroupRefs = useRef<(THREE.Group | null)[]>([])
  const liftRef = useRef<number[]>([]) // 各层当前抬升量(脉冲光柱同步用)
  const columnRef = useRef<THREE.Mesh | null>(null)

  // 时间轴:{t0, fromY[], fromOp[]} —— mode 变化时置空,由 useFrame 以当前实际状态重新捕获
  const animRef = useRef<{ t0: number; fromY: number[]; fromOp: number[] } | null>(null)
  useEffect(() => {
    animRef.current = null // open/close 切换 → 下一帧从当前位置捕获,平滑转向不打断
  }, [mode])

  // 分帧渐进构建:step ∈ [0, levels×2];[0,levels) 挂楼层内容,[levels,2×levels) 补标签
  const [buildStep, setBuildStep] = useState(0)
  const buildRef = useRef(0)
  const buildRate = quality === 'low' ? 1 : 2 // 低档每帧 1 层,其余每帧 2 层

  // 楼层号标签锚点:footprint 西端(x 最小)外侧 6m
  const floorLabelAnchor = useMemo(() => {
    let minX = Infinity
    for (const [x] of building.footprint) if (x < minX) minX = x
    return { x: minX - 6, z: building.center[1] }
  }, [building])

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    const n = floors.length

    // 时间轴捕获:首帧(open:从堆叠态/当前位置起步)或模式切换后首帧(close:从展开位置回落)
    if (!animRef.current) {
      const fromY: number[] = []
      const fromOp: number[] = []
      for (let i = 0; i < n; i++) {
        if (slabMode) {
          const m = slabMeshRefs.current[i]
          fromY.push(m ? m.position.y : i * slabH)
          fromOp.push(m ? (m.material as THREE.MeshStandardMaterial).opacity : 0)
        } else {
          fromY.push(0)
          const m = shellRef.current
          fromOp.push(m ? (m.material as THREE.MeshStandardMaterial).opacity : 0)
        }
      }
      animRef.current = { t0: t, fromY, fromOp }
    }
    const A = animRef.current
    const dur = mode === 'open' ? OPEN_DUR : CLOSE_DUR
    const stagger = mode === 'open' ? OPEN_STAGGER : CLOSE_STAGGER

    if (slabMode) {
      for (let i = 0; i < n; i++) {
        // 展开:1F→顶层依次启动;收起:顶层先落
        const order = mode === 'open' ? i : n - 1 - i
        const p = clamp01((t - A.t0 - order * stagger) / dur)
        const e = easeOutCubic(p)
        const stackedY = i * slabH
        const targetY = mode === 'open' ? stackedY + i * EXPAND_GAP : stackedY
        const y = A.fromY[i] + (targetY - A.fromY[i]) * e
        const opTarget = mode === 'open' ? SLAB_OPACITY : 0
        const op = A.fromOp[i] + (opTarget - A.fromOp[i]) * e

        const mesh = slabMeshRefs.current[i]
        if (mesh) {
          mesh.position.y = y
          ;(mesh.material as THREE.MeshStandardMaterial).opacity = op
        }
        const g = floorGroupRefs.current[i]
        if (g) {
          g.position.y = y - stackedY
          liftRef.current[i] = g.position.y
        }
      }
    } else if (shellRef.current) {
      const p = clamp01((t - A.t0) / (mode === 'open' ? 0.5 : CLOSE_DUR))
      const e = easeOutCubic(p)
      const opTarget = mode === 'open' ? SHELL_OPACITY : 0
      const mat = shellRef.current.material as THREE.MeshStandardMaterial
      mat.opacity = A.fromOp[0] + (opTarget - A.fromOp[0]) * e
    }

    // 分帧构建(收起时冻结,保持已有内容平滑回落)
    if (mode === 'open' && buildRef.current < n * 2) {
      buildRef.current = Math.min(buildRef.current + buildRate, n * 2)
      setBuildStep(buildRef.current)
    }

    // 选中房间:地面 → 房间顶的垂直脉冲光柱(呼吸动画)
    const col = columnRef.current
    if (col) {
      if (selectedInfo) {
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

  const baseColor = FEATURE_COLOR[building.feature] ?? '#8a8f94'
  // 标签预算:low 档只保留高亮/选中标签,桌面不减配
  const maxLabels = quality === 'low' ? 0 : MAX_FLOOR_LABELS

  return (
    <group>
      {slabMode &&
        slabGeoms.map((g, i) => (
          <mesh
            key={`slab_${i}`}
            geometry={g}
            ref={(m) => {
              slabMeshRefs.current[i] = m
              // 初始堆叠位只在挂载时设置一次,不进 JSX props——避免构建期重渲染把动画中的位置重置
              if (m && !slabInitRef.current[i]) {
                slabInitRef.current[i] = true
                m.position.set(0, i * slabH, 0)
              }
            }}
          >
            <meshStandardMaterial
              color={baseColor}
              emissive={hotFloors.has(i + 1) ? CANDIDATE_COLOR : '#000000'}
              emissiveIntensity={hotFloors.has(i + 1) ? 0.35 : 0}
              transparent
              opacity={0}
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
            opacity={0}
            roughness={0.85}
            metalness={0.05}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* 逐层真实楼层平面:分帧挂载(未就绪楼层先只有楼板,视觉上随错峰抬升逐层"点亮") */}
      {floors.map((f, i) =>
        buildStep > i ? (
          <group
            key={`fg_${f}`}
            ref={(g) => {
              floorGroupRefs.current[i] = g
            }}
          >
            <FloorPlan
              building={building}
              rooms={rooms}
              floor={f}
              roomsById={roomsById}
              ox={building.center[0]}
              oz={building.center[1]}
              baseY={i * slabH + slabH * 0.04}
              roomH={roomH}
              selectedRoomId={selectedRoomId}
              highlighted={highlighted}
              hot={hotFloors.has(f)}
              hasSelected={selectedInfo?.floor === f}
              labelsOn={buildStep > levels + i}
              maxLabels={maxLabels}
            />
            {/* 楼层号标签(随层组抬升,内容就绪即淡入) */}
            {slabMode && (
              <FadeInSprite
                position={[floorLabelAnchor.x, i * slabH + slabH / 2, floorLabelAnchor.z]}
                scale={[FLOOR_LABEL_H * getLabelSkin(`floor:${building.id}:${f}`, `${f}F`).aspect, FLOOR_LABEL_H, 1]}
                skin={getLabelSkin(`floor:${building.id}:${f}`, `${f}F`)}
                renderOrder={11}
              />
            )}
          </group>
        ) : null,
      )}

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

// ---------------------------------------------------------------------------
// 容器:跟踪 slicedBuildingId,管理 open/close 视图队列
// 切楼/收起时旧楼不清空,转为 close 模式错峰回落,动画结束才卸载
// ---------------------------------------------------------------------------
interface Props {
  buildings: BakedBuilding[]
  /** 缺省读 campusStore.rooms */
  rooms?: Room[]
}

interface ViewEntry {
  id: string
  mode: 'open' | 'close'
}

/**
 * 楼宇分层视图(campusStore.slicedBuildingId 触发):
 * - 多层楼(levels>1):按层拆板,错峰逐层抬高 EXPAND_GAP(cubic ease-out,
 *   1F→顶层花瓣式绽开),每层渲染真实楼层平面——房间单元格(InstancedMesh)、
 *   走廊条带、交通核、房间号标签(分帧挂载 + 淡入);
 * - 单层楼:整楼半透明壳 opacity 0.3 + 一层布局;
 * - 收起/切楼:反向错峰(顶层先落),从当前位置捕获起点,支持中途打断;
 * - AI 联动:highlightedRoomIds 染候选蓝、selectedRoomId 染金并附脉冲光柱;
 * - 状态色:busy 微红 / repair 橙,其余冷灰蓝。
 */
export default function BuildingSlice({ buildings, rooms: roomsProp }: Props) {
  const slicedBuildingId = useCampusStore((s) => s.slicedBuildingId)
  const storeRooms = useCampusStore((s) => s.rooms)
  const rooms = roomsProp ?? storeRooms

  const [views, setViews] = useState<ViewEntry[]>([])
  const byId = useMemo(() => new Map(buildings.map((b) => [b.id, b])), [buildings])
  const closeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  const clearTimer = (id: string) => {
    const t = closeTimers.current.get(id)
    if (t) {
      clearTimeout(t)
      closeTimers.current.delete(id)
    }
  }

  useEffect(() => {
    setViews((prev) => {
      const next: ViewEntry[] = []
      for (const v of prev) {
        if (v.id === slicedBuildingId) {
          // 同楼(含收起中途再展开):取消卸载计时,转回展开
          clearTimer(v.id)
          next.push({ id: v.id, mode: 'open' })
        } else if (v.mode === 'open') {
          // 切楼/收起:转为 close,动画结束后卸载
          next.push({ id: v.id, mode: 'close' })
          const b = byId.get(v.id)
          const n = Math.max(b?.levels ?? 1, 1)
          const total = (CLOSE_DUR + (n - 1) * CLOSE_STAGGER + CLOSE_BUFFER) * 1000
          clearTimer(v.id)
          closeTimers.current.set(
            v.id,
            setTimeout(() => {
              closeTimers.current.delete(v.id)
              setViews((cur) => cur.filter((x) => !(x.id === v.id && x.mode === 'close')))
            }, total),
          )
        } else {
          next.push(v) // 已在收起,继续播完
        }
      }
      if (slicedBuildingId && !prev.some((v) => v.id === slicedBuildingId)) {
        next.push({ id: slicedBuildingId, mode: 'open' })
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slicedBuildingId])

  // 卸载时清理所有收起计时
  useEffect(
    () => () => {
      closeTimers.current.forEach((t) => clearTimeout(t))
      closeTimers.current.clear()
    },
    [],
  )

  return (
    <>
      {views.map((v) => {
        const b = byId.get(v.id)
        return b ? <SliceView key={v.id} building={b} mode={v.mode} rooms={rooms} /> : null
      })}
    </>
  )
}
