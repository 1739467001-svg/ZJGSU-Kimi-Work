// 报修Agent:解析房间/设备 → 创建工单 → 3D 告警定位(repair)
import type { DeviceType, Intent, Room } from '../../lib/agentTypes'
import { DEVICE_NAME } from '../../lib/rooms'
import { matchBuildings } from '../parseIntent'
import { ensureRooms, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

function findRoom(rooms: Room[], mention: string, buildingId?: string): Room | undefined {
  const pool = buildingId ? rooms.filter((r) => r.buildingId === buildingId) : rooms
  const m = mention.toLowerCase()
  return (
    pool.find((r) => r.name.toLowerCase() === m) ??
    pool.find((r) => r.name.toLowerCase().endsWith(m)) ??
    (/^\d{3}$/.test(m) ? pool.find((r) => r.name.includes(m)) : undefined)
  )
}

export async function repairHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const { slots } = intent
  const rooms = await ensureRooms(ctx)

  // 楼宇歧义(『三号楼』)→ clarify
  let buildingId = slots.buildingId
  if (slots.building && !buildingId) {
    const cands = matchBuildings(slots.building, ctx.buildings)
    if (cands.length === 1) buildingId = cands[0].id
    else if (cands.length > 1) {
      // 展示去重:同名多栋(如两栋『文体中心』)只列一次
      const opts = [...new Set(cands.slice(0, 4).map((b) => `${b.name}(${b.zone || '校园'})`))].join('、')
      return {
        result: {
          type: 'unknown',
          message: `你说的「${slots.building}」可能指:${opts}。请补充具体楼宇和房间号,例如「C302空调坏了」。`,
        },
        trace: [{ title: '楼宇消歧', detail: `「${slots.building}」命中 ${cands.length} 栋楼` }],
      }
    }
  }

  const device = slots.equipment?.[0] as DeviceType | undefined
  const deviceLabel = device ? DEVICE_NAME[device] : '设施'

  if (!slots.room) {
    return {
      result: {
        type: 'unknown',
        message: `听清了,是${deviceLabel}故障,但没听清具体房间。请补充房间号,例如「C302的${deviceLabel}坏了」。`,
      },
      trace: [{ title: '故障解析', detail: `设备=${deviceLabel},缺少房间号,等待澄清` }],
    }
  }

  const room = findRoom(rooms, slots.room, buildingId)
  if (!room) {
    return {
      result: {
        type: 'unknown',
        message: `没有在房源里找到房间「${slots.room}」。请确认房间号(如 C302、国际会议中心101)。`,
      },
      trace: [{ title: '房间匹配', detail: `「${slots.room}」未匹配到任何房间` }],
    }
  }

  const campus = ctx.campus.getState()
  const ticket = campus.createTicket({
    roomId: room.id,
    deviceId: device,
    desc: intent.rawText,
  })
  // 3D 告警定位:alarmRoomId / alarmBuildingId
  campus.setAlarm(room.id, room.buildingId)

  const bName = ctx.buildings.find((b) => b.id === room.buildingId)?.name ?? '未知楼宇'
  const message =
    `报修工单 ${ticket.id} 已创建:${bName}·${room.name} 的${deviceLabel}故障,已派单给「${ticket.assignee}」。3D 场景中已定位告警点位,可在报修面板跟进进度。`

  return {
    result: {
      type: 'ticket_created',
      message,
      roomIds: [room.id],
      buildingIds: [room.buildingId],
      ticketId: ticket.id,
    },
    trace: [
      { title: '故障解析', detail: `${bName}·${room.name},设备:${deviceLabel}` },
      { title: '创建工单', detail: `${ticket.id} 已派单给${ticket.assignee}` },
      { title: '告警定位', detail: `3D 场景已标记 ${bName}·${room.name}` },
    ],
  }
}
