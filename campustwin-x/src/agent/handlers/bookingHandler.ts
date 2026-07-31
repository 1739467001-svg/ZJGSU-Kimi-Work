// 预约Agent:会议室/教室候选检索(book_room / find_free_classroom)
import type { DeviceType, Intent, Room, RoomType } from '../../lib/agentTypes'
import type { RoomQuery } from '../../lib/rooms'
import { DEVICE_NAME, searchRooms } from '../../lib/rooms'
import { matchBuildings } from '../parseIntent'
import { ensureRooms, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

const TYPE_LABEL: Record<RoomType, string> = {
  meeting: '会议室', classroom: '教室', venue: '场馆', lab: '实验室',
}

function buildingName(ctx: HandlerContext, id: string): string {
  return ctx.buildings.find((b) => b.id === id)?.name ?? '未知楼宇'
}

function describe(r: Room, ctx: HandlerContext): string {
  const devs = r.equipment.length ? r.equipment.map((d) => DEVICE_NAME[d]).join('/') : '无特殊设备'
  return `${r.name}(${buildingName(ctx, r.buildingId)}·${r.floor}F,${r.capacity}人,${devs})`
}

export async function bookingHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const { slots } = intent
  const rooms = await ensureRooms(ctx)
  if (!rooms.length) {
    return {
      result: { type: 'unknown', message: '房间数据尚未就绪,请稍后再试。' },
      trace: [{ title: '加载房源', detail: 'rooms.json 未加载到任何房间' }],
    }
  }

  // 房型:找教室/自习 → classroom;报告厅 → venue;默认 → meeting
  const isClassroom = intent.intent === 'find_free_classroom' || /教室|自习/.test(intent.rawText)
  const type: RoomType = isClassroom ? 'classroom' : /报告厅|剧院|场地/.test(intent.rawText) ? 'venue' : 'meeting'

  // 楼宇槽位:歧义说法(『三号楼』)→ clarify
  let buildingId = slots.buildingId
  if (slots.building && !buildingId) {
    const cands = matchBuildings(slots.building, ctx.buildings)
    if (cands.length === 1) buildingId = cands[0].id
    else if (cands.length > 1) {
      // 展示去重:同名多栋(如两栋『文体中心』)只列一次,避免重复选项
      const opts = [...new Set(cands.slice(0, 4).map((b) => `${b.name}(${b.zone || '校园'})`))].join('、')
      return {
        result: {
          type: 'unknown',
          message: `你说的「${slots.building}」可能指:${opts}。请说全一点,例如「${cands[0].name}」。`,
        },
        trace: [{ title: '楼宇消歧', detail: `「${slots.building}」命中 ${cands.length} 栋楼,等待用户澄清` }],
      }
    }
  }

  const query: RoomQuery = {
    type,
    capacity: slots.capacity,
    equipment: slots.equipment as DeviceType[] | undefined,
    buildingId,
    slot: slots.start && slots.end ? { start: slots.start, end: slots.end } : undefined,
  }

  ctx.campus.getState().triggerScan()
  let candidates = searchRooms(rooms, query)
  const relaxNotes: string[] = []
  if (!candidates.length && query.slot) {
    relaxNotes.push('指定时段无空闲,已放宽为全天可订')
    const { slot: _drop, ...rest } = query
    candidates = searchRooms(rooms, rest)
  }
  if (!candidates.length && (query.buildingId || query.equipment?.length)) {
    relaxNotes.push('已放宽楼宇/设备限制')
    candidates = searchRooms(rooms, { type, capacity: query.capacity })
  }

  // 排序:当前空闲优先,再按容量贴合度(够用且不过剩)
  const need = slots.capacity ?? 0
  candidates.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'free' ? -1 : 1
    return Math.abs(a.capacity - need) - Math.abs(b.capacity - need)
  })

  if (!candidates.length) {
    return {
      result: {
        type: 'unknown',
        message: `没有找到符合条件的${TYPE_LABEL[type]}${need ? `(≥${need}人)` : ''},可以换个条件再试试。`,
      },
      trace: [{ title: '检索候选', detail: '全量检索后仍无匹配' }],
    }
  }

  const top = candidates.slice(0, 6)
  const top3 = candidates.slice(0, 3).map((r, i) => `${i + 1}) ${describe(r, ctx)}`).join(';')
  const timeNote = query.slot ? `${slots.time ?? '指定时段'}空闲` : '当前可订'
  const relaxNote = relaxNotes.length ? `(${relaxNotes.join(';')})` : ''
  const message =
    `共找到 ${candidates.length} 间${timeNote}的${TYPE_LABEL[type]}${relaxNote}。Top3:${top3}。请在预约面板挑选并确认下单。`

  return {
    result: {
      type: 'booking_candidates',
      message,
      roomIds: top.map((r) => r.id),
      buildingIds: [...new Set(top.map((r) => r.buildingId))],
    },
    trace: [
      {
        title: '解析需求',
        detail: `${TYPE_LABEL[type]}${need ? `·≥${need}人` : ''}${slots.equipment?.length ? `·设备:${slots.equipment.join('/')}` : ''}${slots.time ? `·${slots.time}` : ''}`,
      },
      { title: '检索候选', detail: `命中 ${candidates.length} 间,取前 ${top.length} 间高亮` },
      { title: '等待确认', detail: '候选已送入预约面板,待用户下单' },
    ],
  }
}
