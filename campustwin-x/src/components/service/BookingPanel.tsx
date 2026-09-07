import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { AirVent, CalendarCheck, CheckCircle2, Lightbulb, Mic, Monitor, Projector, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import type { Booking, DeviceType, Room } from '../../lib/agentTypes'
import { DEVICE_NAME } from '../../lib/rooms'
import { requestRooms } from '../../lib/roomsLoader'
import { LocateButton } from './LocateButton'

const DEVICE_ICON: Record<DeviceType, LucideIcon> = {
  projector: Projector,
  ac: AirVent,
  light: Lightbulb,
  mic: Mic,
  screen: Monitor,
}

const STATUS_COLOR: Record<Room['status'], string> = {
  free: '#3fd08c',
  busy: '#e8b84b',
  repair: '#ff3b30',
}
const STATUS_NAME: Record<Room['status'], string> = { free: '空闲', busy: '占用', repair: '维修' }

const toHHmm = (hhColon: string) => hhColon.replace(':', '')
const fmtHHmm = (hhmm: string) => (hhmm.length === 4 ? `${hhmm.slice(0, 2)}:${hhmm.slice(2)}` : hhmm)

/** 预约面板:候选房间列表 → 点选聚焦 → 确认生成预约凭证 */
export function BookingPanel() {
  const rooms = useCampusStore((s) => s.rooms)
  const buildings = useCampusStore((s) => s.buildings)
  const highlightedRoomIds = useCampusStore((s) => s.highlightedRoomIds)
  const selectedRoomId = useCampusStore((s) => s.selectedRoomId)
  const locatingRoomId = useCampusStore((s) => s.locatingRoomId)
  const selectRoom = useCampusStore((s) => s.selectRoom)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const createBooking = useCampusStore((s) => s.createBooking)

  const now = new Date()
  const defStart = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const later = new Date(now.getTime() + 60 * 60 * 1000)
  const defEnd = `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`

  const [start, setStart] = useState(defStart)
  const [end, setEnd] = useState(defEnd)
  const [voucher, setVoucher] = useState<Booking | null>(null)

  // 预约面板首次打开 = rooms 懒加载触发点(幂等);加载期间空态显示"加载中"
  useEffect(() => {
    void requestRooms()
  }, [])
  const roomsLoading = rooms.length === 0

  const buildingName = useMemo(() => {
    const m = new Map(buildings.map((b) => [b.id, b.name ?? b.id]))
    return (id: string) => m.get(id) ?? id
  }, [buildings])

  const candidates = useMemo(
    () => highlightedRoomIds.map((id) => rooms.find((r) => r.id === id)).filter((r): r is Room => !!r),
    [highlightedRoomIds, rooms],
  )

  const pick = (room: Room) => {
    selectRoom(room.id)
    focusCamera({ type: 'room', id: room.id })
    setVoucher(null)
  }

  const confirm = () => {
    if (!selectedRoomId) return
    const b = createBooking({ roomId: selectedRoomId, user: '演示用户', start: toHHmm(start), end: toHHmm(end) })
    setVoucher(b)
  }

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) ?? null
  const voucherRoom = voucher ? (rooms.find((r) => r.id === voucher.roomId) ?? null) : null

  return (
    <div style={S.root}>
      {candidates.length === 0 ? (
        <div style={S.empty}>
          {roomsLoading ? (
            <span style={{ opacity: 0.6 }}>房间数据加载中…</span>
          ) : (
            <>
              暂无候选空间。
              <br />
              <span style={{ opacity: 0.6 }}>在指令台试试:「帮我找一个现在空着、有投影、能坐 8 个人的会议室」</span>
            </>
          )}
        </div>
      ) : (
        <>
          <div style={S.sectionTitle}>候选空间 · {candidates.length}</div>
          <div style={S.list}>
            {candidates.map((r) => {
              const active = r.id === selectedRoomId
              return (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => pick(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') pick(r)
                  }}
                  style={{ ...S.card, borderColor: active ? '#e8b84b' : '#2a323b' }}
                >
                  <div style={S.cardHead}>
                    <span style={S.cardName}>{r.name}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <LocateButton
                        locating={locatingRoomId === r.id}
                        onClick={() => pick(r)}
                        title={`定位到 ${r.name}`}
                      />
                      <span style={{ ...S.dot, background: STATUS_COLOR[r.status] }} title={STATUS_NAME[r.status]} />
                    </span>
                  </div>
                  <div style={S.cardSub}>
                    {buildingName(r.buildingId)} · {r.floor}F · {STATUS_NAME[r.status]}
                  </div>
                  <div style={S.cardMeta}>
                    <span style={S.meta}><Users size={12} /> {r.capacity} 人</span>
                    {r.equipment.map((d) => {
                      const Icon = DEVICE_ICON[d]
                      return (
                        <span key={d} style={S.meta} title={DEVICE_NAME[d]}>
                          <Icon size={12} /> {DEVICE_NAME[d]}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>

          <div style={S.sectionTitle}>预约时段</div>
          <div style={S.timeRow}>
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={S.timeInput} />
            <span style={{ opacity: 0.5 }}>至</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={S.timeInput} />
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={!selectedRoom}
            style={{ ...S.primaryBtn, opacity: selectedRoom ? 1 : 0.4 }}
          >
            <CalendarCheck size={14} /> 确认预约{selectedRoom ? ` · ${selectedRoom.name}` : ''}
          </button>

          {voucher && (
            <div style={S.voucher}>
              <div style={S.voucherHead}>
                <CheckCircle2 size={15} color="#3fd08c" />
                <span style={{ color: '#3fd08c', fontWeight: 600 }}>预约成功</span>
                <span style={{ marginLeft: 'auto', opacity: 0.5, fontSize: 11 }}>{voucher.id}</span>
              </div>
              <div style={S.voucherRow}>
                空间:{voucherRoom ? `${voucherRoom.name}(${buildingName(voucherRoom.buildingId)})` : voucher.roomId}
              </div>
              <div style={S.voucherRow}>时段:{fmtHHmm(voucher.start)} – {fmtHHmm(voucher.end)}</div>
              <div style={S.voucherRow}>预约人:{voucher.user}</div>
              <div style={S.voucherRow}>凭证时间:{new Date(voucher.createdAt).toLocaleString('zh-CN')}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  empty: { fontSize: 13, lineHeight: 1.8, opacity: 0.85, padding: '18px 6px' },
  sectionTitle: { fontSize: 12, opacity: 0.55, letterSpacing: 1 },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  card: {
    textAlign: 'left', background: '#161b21', border: '1px solid #2a323b', borderRadius: 8,
    padding: '10px 12px', cursor: 'pointer', color: '#dde3e8', display: 'flex', flexDirection: 'column', gap: 4,
  },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  cardName: { fontSize: 14, fontWeight: 600 },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  cardSub: { fontSize: 12, opacity: 0.6 },
  cardMeta: { display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 2 },
  meta: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, opacity: 0.75 },
  timeRow: { display: 'flex', alignItems: 'center', gap: 8 },
  timeInput: {
    flex: 1, background: '#0e1114', border: '1px solid #2a323b', borderRadius: 6,
    color: '#dde3e8', padding: '7px 10px', fontSize: 13, colorScheme: 'dark',
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: '#3aa7ff', color: '#0e1114', border: 'none', borderRadius: 6,
    padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  voucher: {
    background: '#161b21', border: '1px solid #3fd08c55', borderRadius: 8,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 5,
  },
  voucherHead: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 2 },
  voucherRow: { fontSize: 12.5, opacity: 0.85 },
}
