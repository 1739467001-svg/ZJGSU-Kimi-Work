// 楼层选择器(M4 房间级定位)——剖切楼宇时显示在视口左缘
// 契约来源:campusStore.slicedBuildingId / selectedRoomId / highlightedRoomIds /
//          rooms / buildings / focusCamera / setSlicedBuilding;
//          lib/floorLayout.computeFloorLayout 提供各层房间数。
// 点击某层:focusCamera 暂无楼层级模式,退化为「该层第一个高亮房间」,
// 无高亮房间则回落到已有的 {type:'building'} 聚焦。
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { FoldVertical } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import { computeFloorLayout } from '../../lib/floorLayout'

const COLORS = {
  panel: '#161b21cc',
  border: '#2a323b',
  text: '#dde3e8',
  brand: '#3aa7ff',
}

export default function FloorSelector() {
  const slicedBuildingId = useCampusStore((s) => s.slicedBuildingId)
  const buildings = useCampusStore((s) => s.buildings)
  const rooms = useCampusStore((s) => s.rooms)
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const highlightedRoomIds = useCampusStore((s) => s.highlightedRoomIds)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)

  const building = slicedBuildingId
    ? (buildings.find((b) => b.id === slicedBuildingId) ?? null)
    : null

  // 该楼各层房间数(布局引擎保证每房一格,cells.length 即该层房间数)
  const roomCountByFloor = useMemo(() => {
    const m = new Map<number, number>()
    if (!building) return m
    for (let f = 1; f <= building.levels; f++) {
      m.set(f, computeFloorLayout(building, rooms, f).cells.length)
    }
    return m
  }, [building, rooms])

  if (!building) return null

  const buildingRooms = rooms.filter((r) => r.buildingId === building.id)
  const selectedFloor = selectedRoomId
    ? (buildingRooms.find((r) => r.id === selectedRoomId)?.floor ?? null)
    : null
  const highlightedFloors = new Set(
    buildingRooms.filter((r) => highlightedRoomIds.includes(r.id)).map((r) => r.floor),
  )

  const goFloor = (floor: number) => {
    // 楼层级聚焦尚不支持:优先落到该层第一个高亮房间,否则回到楼宇级聚焦
    const target = buildingRooms.find(
      (r) => r.floor === floor && highlightedRoomIds.includes(r.id),
    )
    focusCamera(target ? { type: 'room', id: target.id } : { type: 'building', id: building.id })
  }

  // 顶层在上
  const floors = Array.from({ length: building.levels }, (_, i) => building.levels - i)

  return (
    <div style={S.wrap} aria-label="楼层选择器">
      <div style={S.title}>{building.name ?? '未命名楼宇'}</div>
      <div style={S.list}>
        {floors.map((f) => {
          const active = f === selectedFloor
          const marked = active || highlightedFloors.has(f)
          return (
            <button
              key={f}
              type="button"
              onClick={() => goFloor(f)}
              title={`${f}F · ${roomCountByFloor.get(f) ?? 0} 个房间`}
              style={active ? { ...S.btn, ...S.btnActive } : S.btn}
            >
              <span style={{ ...S.dot, opacity: marked ? 1 : 0 }} />
              {f}F
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => setSlicedBuilding(null)}
        style={S.collapseBtn}
        title="退出分层剖切视图"
      >
        <FoldVertical size={12} style={{ marginRight: 4, verticalAlign: -1.5 }} />
        收起剖切
      </button>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  wrap: {
    position: 'absolute',
    left: 16,
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 6,
    padding: '8px 6px',
    maxHeight: '72%',
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 8,
    color: COLORS.text,
    fontSize: 11,
    fontFamily: 'inherit',
    userSelect: 'none',
    boxShadow: '0 8px 30px #00000066',
  },
  title: {
    fontSize: 11,
    opacity: 0.65,
    textAlign: 'center',
    padding: '0 4px 2px',
    borderBottom: `1px solid ${COLORS.border}`,
    maxWidth: 96,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflowY: 'auto',
    scrollbarWidth: 'thin',
  },
  btn: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    border: `1px solid transparent`,
    background: 'transparent',
    color: COLORS.text,
    fontSize: 11,
    lineHeight: 1,
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    opacity: 0.65,
    fontFamily: 'inherit',
    minWidth: 44,
  },
  btnActive: {
    border: `1px solid ${COLORS.brand}`,
    background: 'rgba(58, 167, 255, 0.12)',
    color: COLORS.brand,
    opacity: 1,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: '50%',
    background: COLORS.brand,
    flexShrink: 0,
    boxShadow: `0 0 4px ${COLORS.brand}`,
  },
  collapseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px solid ${COLORS.border}`,
    background: 'transparent',
    color: COLORS.text,
    fontSize: 11,
    lineHeight: 1,
    padding: '5px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    opacity: 0.8,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
}
