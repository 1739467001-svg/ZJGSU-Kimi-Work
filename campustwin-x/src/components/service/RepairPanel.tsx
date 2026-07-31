import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowRight, CheckCircle2, Wrench } from 'lucide-react'
import { useCampusStore } from '../../store/campusStore'
import type { DeviceType, Ticket, TicketStatus } from '../../lib/agentTypes'
import { DEVICE_NAME } from '../../lib/rooms'

const DEVICE_OPTIONS = Object.entries(DEVICE_NAME) as [DeviceType, string][]

const STATUS_META: Record<TicketStatus, { name: string; color: string }> = {
  new: { name: '待受理', color: '#ff3b30' },
  doing: { name: '处理中', color: '#e8b84b' },
  done: { name: '已办结', color: '#3fd08c' },
}

/** 报修面板:工单表单(告警自动填充)+ 工单列表与状态推进 new→doing→done */
export function RepairPanel() {
  const rooms = useCampusStore((s) => s.rooms)
  const buildings = useCampusStore((s) => s.buildings)
  const tickets = useCampusStore((s) => s.tickets)
  const alarmRoomId = useCampusStore((s) => s.alarmRoomId)
  const alarmBuildingId = useCampusStore((s) => s.alarmBuildingId)
  const createTicket = useCampusStore((s) => s.createTicket)
  const advanceTicket = useCampusStore((s) => s.advanceTicket)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const selectRoom = useCampusStore((s) => s.selectRoom)

  const [buildingId, setBuildingId] = useState('')
  const [roomId, setRoomId] = useState('')
  const [deviceId, setDeviceId] = useState<DeviceType | ''>('')
  const [desc, setDesc] = useState('')
  const [justCreated, setJustCreated] = useState<string | null>(null)

  // 告警联动:红色定位告警时自动填充楼宇/房间
  useEffect(() => {
    if (!alarmRoomId) return
    const room = rooms.find((r) => r.id === alarmRoomId)
    if (room) {
      setBuildingId(room.buildingId)
      setRoomId(room.id)
    }
  }, [alarmRoomId, rooms])

  useEffect(() => {
    if (alarmBuildingId && !alarmRoomId) setBuildingId(alarmBuildingId)
  }, [alarmBuildingId, alarmRoomId])

  const buildingOptions = useMemo(
    () => buildings.filter((b) => b.name).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'zh')),
    [buildings],
  )
  const roomOptions = useMemo(
    () => (buildingId ? rooms.filter((r) => r.buildingId === buildingId) : rooms),
    [rooms, buildingId],
  )
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name ?? id
  const buildingNameOf = (id: string) => buildings.find((b) => b.id === id)?.name ?? id

  const submit = () => {
    if (!roomId || !desc.trim()) return
    const t = createTicket({ roomId, deviceId: deviceId || undefined, desc: desc.trim() })
    setJustCreated(t.id)
    setDesc('')
    focusCamera({ type: 'room', id: t.roomId })
  }

  const sorted = useMemo(() => [...tickets].reverse(), [tickets])

  return (
    <div style={S.root}>
      <div style={S.sectionTitle}>新建工单{alarmRoomId ? '(已按告警位置填充)' : ''}</div>
      <div style={S.form}>
        <select value={buildingId} onChange={(e) => { setBuildingId(e.target.value); setRoomId('') }} style={S.input}>
          <option value="">选择楼宇</option>
          {buildingOptions.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={S.input}>
          <option value="">选择房间</option>
          {roomOptions.map((r) => <option key={r.id} value={r.id}>{r.name}({r.floor}F)</option>)}
        </select>
        <select value={deviceId} onChange={(e) => setDeviceId(e.target.value as DeviceType | '')} style={S.input}>
          <option value="">故障设备(可选)</option>
          {DEVICE_OPTIONS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
        </select>
        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="故障描述,如:投影无法开机"
          rows={3}
          style={{ ...S.input, resize: 'vertical' }}
        />
        <button
          type="button"
          onClick={submit}
          disabled={!roomId || !desc.trim()}
          style={{ ...S.primaryBtn, opacity: roomId && desc.trim() ? 1 : 0.4 }}
        >
          <Wrench size={14} /> 提交报修
        </button>
        {justCreated && <div style={S.createdTip}><CheckCircle2 size={13} color="#3fd08c" /> 工单 {justCreated} 已创建,后勤值班已受理</div>}
      </div>

      <div style={S.sectionTitle}>工单列表 · {tickets.length}</div>
      {sorted.length === 0 ? (
        <div style={S.empty}>暂无工单。</div>
      ) : (
        <div style={S.list}>
          {sorted.map((t) => <TicketRow key={t.id} ticket={t} roomName={roomName(t.roomId)}
            buildingName={buildingNameOf(rooms.find((r) => r.id === t.roomId)?.buildingId ?? '')}
            onAdvance={() => advanceTicket(t.id)}
            onLocate={() => { selectRoom(t.roomId); focusCamera({ type: 'room', id: t.roomId }) }} />)}
        </div>
      )}
    </div>
  )
}

function TicketRow(props: {
  ticket: Ticket
  roomName: string
  buildingName: string
  onAdvance: () => void
  onLocate: () => void
}) {
  const { ticket: t, roomName, buildingName, onAdvance, onLocate } = props
  const meta = STATUS_META[t.status]
  const deviceLabel = t.deviceId
    ? (DEVICE_NAME[t.deviceId as DeviceType] ?? t.deviceId)
    : null
  return (
    <div style={S.ticket}>
      <div style={S.ticketHead}>
        <span style={{ ...S.badge, color: meta.color, borderColor: `${meta.color}66` }}>{meta.name}</span>
        <span style={{ opacity: 0.45, fontSize: 11, marginLeft: 'auto' }}>{t.id}</span>
      </div>
      <button type="button" onClick={onLocate} style={S.ticketLoc}>
        {buildingName} · {roomName}{deviceLabel ? ` · ${deviceLabel}` : ''}
      </button>
      <div style={S.ticketDesc}>{t.desc}</div>
      <div style={S.ticketFoot}>
        <span style={{ opacity: 0.5, fontSize: 11 }}>{t.assignee} · {new Date(t.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        {t.status !== 'done' ? (
          <button type="button" onClick={onAdvance} style={S.advanceBtn}>
            {t.status === 'new' ? '开始处理' : '办结'} <ArrowRight size={12} />
          </button>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#3fd08c' }}>
            <CheckCircle2 size={11} /> 已完成
          </span>
        )}
      </div>
    </div>
  )
}

const S: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, overflowY: 'auto', flex: 1 },
  sectionTitle: { fontSize: 12, opacity: 0.55, letterSpacing: 1 },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  input: {
    background: '#0e1114', border: '1px solid #2a323b', borderRadius: 6,
    color: '#dde3e8', padding: '8px 10px', fontSize: 13, colorScheme: 'dark', width: '100%',
  },
  primaryBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    background: '#3aa7ff', color: '#0e1114', border: 'none', borderRadius: 6,
    padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  createdTip: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#3fd08c' },
  empty: { fontSize: 12.5, opacity: 0.6, padding: '8px 2px' },
  list: { display: 'flex', flexDirection: 'column', gap: 8 },
  ticket: { background: '#161b21', border: '1px solid #2a323b', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 },
  ticketHead: { display: 'flex', alignItems: 'center', gap: 8 },
  badge: { fontSize: 11, border: '1px solid', borderRadius: 4, padding: '1px 6px' },
  ticketLoc: { background: 'none', border: 'none', padding: 0, textAlign: 'left', color: '#3aa7ff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  ticketDesc: { fontSize: 12.5, opacity: 0.85, lineHeight: 1.5 },
  ticketFoot: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  advanceBtn: {
    display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
    background: 'none', border: '1px solid #3aa7ff66', color: '#3aa7ff',
    borderRadius: 5, padding: '3px 8px', cursor: 'pointer',
  },
}
