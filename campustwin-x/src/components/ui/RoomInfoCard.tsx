// 房间信息卡(M4 房间级定位)——选中房间时浮于 3D 视口右下
// (与 SelectedCard 同位,App.tsx 中两者互斥:有房间选中时优先本卡)
// 契约来源:campusStore.selectedRoomId / rooms / buildings / focusCamera / selectRoom。
import type { CSSProperties } from 'react'
import {
  AirVent, CalendarClock, Lightbulb, Mic, Monitor, Navigation, Projector, Users, X,
} from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import type { DeviceType, RoomStatus, RoomType } from '../../lib/agentTypes'

const COLORS = {
  panel: '#161b21ee',
  border: '#2a323b',
  text: '#dde3e8',
  brand: '#3aa7ff',
}

const TYPE_NAME: Record<RoomType, string> = {
  classroom: '教室',
  meeting: '会议室',
  venue: '场馆/报告厅',
  lab: '实验室',
}

const DEVICE_META: Record<DeviceType, { icon: typeof Projector; label: string }> = {
  projector: { icon: Projector, label: '投影' },
  ac: { icon: AirVent, label: '空调' },
  mic: { icon: Mic, label: '麦克风' },
  screen: { icon: Monitor, label: '屏幕' },
  light: { icon: Lightbulb, label: '灯光' },
}

const STATUS_META: Record<RoomStatus, { label: string; color: string }> = {
  free: { label: '空闲', color: '#46c878' },
  busy: { label: '占用', color: '#ff5a5a' },
  repair: { label: '维修中', color: '#f5a524' },
}

/** "0800" → "08:00";已是 HH:MM 或异常格式则原样返回 */
function fmtTime(t: string): string {
  return /^\d{4}$/.test(t) ? `${t.slice(0, 2)}:${t.slice(2)}` : t
}

/** 楼层号:1 → "1F" */
const fmtFloor = (f: number) => `${f}F`

export default function RoomInfoCard() {
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const rooms = useCampusStore((s) => s.rooms)
  const buildings = useCampusStore((s) => s.buildings)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const selectRoom = useCampusStore((s) => s.selectRoom)

  const room = selectedRoomId ? (rooms.find((r) => r.id === selectedRoomId) ?? null) : null
  if (!room) return null

  const building = buildings.find((b) => b.id === room.buildingId) ?? null
  const status = STATUS_META[room.status]
  const schedule = [...room.schedule].sort((a, b) => a.start.localeCompare(b.start))

  return (
    <div style={S.card} aria-label="房间信息">
      <div style={S.head}>
        <div style={{ fontSize: 17, fontWeight: 700 }}>{room.name}</div>
        <button
          type="button"
          onClick={() => selectRoom(null)}
          style={S.closeBtn}
          title="取消选中"
          aria-label="关闭房间信息卡"
        >
          <X size={13} />
        </button>
      </div>
      <div style={S.row}>
        {building ? `${building.name ?? '未命名楼宇'} · ` : ''}
        {fmtFloor(room.floor)} · {TYPE_NAME[room.type] ?? room.type}
      </div>
      <div style={S.row}>
        <Users size={12} style={{ marginRight: 4, verticalAlign: -1.5 }} />
        容量 {room.capacity} 人
        <span style={{ margin: '0 6px', opacity: 0.35 }}>|</span>
        <span style={{ ...S.statusDot, background: status.color, boxShadow: `0 0 5px ${status.color}` }} />
        <span style={{ color: status.color }}>{status.label}</span>
      </div>
      {room.equipment.length > 0 && (
        <div style={S.devices}>
          {room.equipment.map((d) => {
            const meta = DEVICE_META[d]
            if (!meta) return null
            const Icon = meta.icon
            return (
              <span key={d} style={S.deviceTag} title={meta.label}>
                <Icon size={12} style={{ marginRight: 3, verticalAlign: -1.5 }} />
                {meta.label}
              </span>
            )
          })}
        </div>
      )}
      <div style={S.scheduleBox}>
        <div style={S.scheduleTitle}>
          <CalendarClock size={12} style={{ marginRight: 4, verticalAlign: -1.5 }} />
          今日课程/预约
        </div>
        {schedule.length === 0 ? (
          <div style={{ ...S.row, opacity: 0.55 }}>今日暂无安排</div>
        ) : (
          schedule.map((it, i) => (
            <div key={`${it.start}-${it.end}-${i}`} style={S.scheduleItem}>
              <span style={S.scheduleTime}>
                {fmtTime(it.start)}–{fmtTime(it.end)}
              </span>
              <span style={S.scheduleBy}>
                {it.title ? `${it.title} · ` : ''}
                {it.by}
              </span>
            </div>
          ))
        )}
      </div>
      <button
        type="button"
        onClick={() => focusCamera({ type: 'room', id: room.id })}
        style={S.navBtn}
        title="聚焦相机到该房间(导航路线由导航模块完善)"
      >
        <Navigation size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
        导航到此房间
      </button>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  card: {
    position: 'absolute',
    right: 16,
    bottom: 40,
    minWidth: 240,
    maxWidth: 300,
    background: COLORS.panel,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: '13px 15px',
    boxShadow: '0 8px 30px #00000088',
    zIndex: 15,
    color: COLORS.text,
    fontFamily: 'inherit',
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  closeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    border: 'none',
    borderRadius: 4,
    background: 'transparent',
    color: COLORS.text,
    opacity: 0.55,
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  row: { fontSize: 12.5, marginTop: 6, opacity: 0.85 },
  statusDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    marginRight: 4,
    verticalAlign: 0,
  },
  devices: { display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 },
  deviceTag: {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: 11,
    padding: '3px 7px',
    borderRadius: 4,
    border: `1px solid ${COLORS.border}`,
    background: '#ffffff08',
    opacity: 0.9,
    lineHeight: 1,
  },
  scheduleBox: {
    marginTop: 10,
    paddingTop: 8,
    borderTop: `1px solid ${COLORS.border}`,
  },
  scheduleTitle: { fontSize: 12, opacity: 0.7 },
  scheduleItem: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
    fontSize: 12,
    marginTop: 5,
  },
  scheduleTime: {
    fontVariantNumeric: 'tabular-nums',
    color: COLORS.brand,
    flexShrink: 0,
  },
  scheduleBy: {
    opacity: 0.85,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    marginTop: 12,
    padding: '7px 12px',
    fontSize: 12.5,
    cursor: 'pointer',
    background: '#3aa7ff22',
    color: COLORS.brand,
    border: '1px solid #3aa7ff55',
    borderRadius: 6,
    fontFamily: 'inherit',
  },
}
