// 仿真Agent:食堂人流 / 图书馆座位 / 校园活动 / 应急疏散演练
// 数据来源:simStore(canteenCrowd / librarySeats / events),空则提示仿真未启动
import type { Intent, Room, TaskResult } from '../../lib/agentTypes'
import { DEPLOY_BASE } from '../../lib/deployBase'
import { ensureRooms, loadLandmarks, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

const SIM_OFF = '仿真引擎尚未启动,暂时没有实时数据。请先启动人群仿真,再来查询。'

function buildingName(ctx: HandlerContext, id: string): string | undefined {
  return ctx.buildings.find((b) => b.id === id)?.name ?? undefined
}

// ---------------------------------------------------------------------------
// 食堂 placeId → 楼宇 id 映射(canteenCrowd 只带 placeId,3D 高亮需要楼宇 id)
// ---------------------------------------------------------------------------
let canteenMapCache: Map<string, string> | null = null

async function loadCanteenBuildingMap(): Promise<Map<string, string>> {
  if (canteenMapCache) return canteenMapCache
  const map = new Map<string, string>()
  try {
    const res = await fetch(`${DEPLOY_BASE}data/sim/canteen.json`)
    const data: unknown = await res.json()
    const list = (data as { canteens?: { placeId: string; buildingId: string }[] }).canteens ?? []
    for (const c of list) if (c.placeId && c.buildingId) map.set(c.placeId, c.buildingId)
  } catch {
    // 映射加载失败则退化为不高亮,不影响文字回答
  }
  canteenMapCache = map
  return map
}

// ---------------------------------------------------------------------------
async function canteenCrowd(_intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const crowds = ctx.sim.getState().canteenCrowd
  if (!crowds.length) {
    return { result: { type: 'canteen', message: SIM_OFF }, trace: [{ title: '读取食堂人流', detail: '仿真未启动' }] }
  }
  const sorted = [...crowds].sort((a, b) => a.level - b.level)
  const lines = sorted
    .map((c) => `${c.name}:繁忙度 ${(c.level * 100).toFixed(0)}%,预计等 ${c.waitMin} 分钟`)
    .join(';')
  const best = sorted[0]
  const message = `${lines}。现在最空的是「${best.name}」,推荐前往。`
  // placeId(如 xingyun)不是楼宇 id,需经 canteen.json 映射后再高亮
  const place2Building = await loadCanteenBuildingMap()
  const buildingIds = [
    ...new Set(
      crowds
        .map((c) => place2Building.get(c.placeId) ?? c.placeId)
        .filter((id) => buildingName(ctx, id)),
    ),
  ]
  return {
    result: { type: 'canteen', message, buildingIds },
    trace: [
      { title: '读取食堂人流', detail: `${crowds.length} 个食堂实时排队数据` },
      { title: '生成建议', detail: `推荐 ${best.name}(等 ${best.waitMin} 分钟)` },
    ],
  }
}

// ---------------------------------------------------------------------------
function librarySeat(_intent: Intent, ctx: HandlerContext): HandlerOutput {
  const seats = ctx.sim.getState().librarySeats
  const lib = ctx.buildings.find((b) => b.feature === 'library' && b.name)
  if (!seats.length) {
    return {
      result: { type: 'library', message: SIM_OFF, buildingIds: lib ? [lib.id] : undefined },
      trace: [{ title: '读取座位数据', detail: '仿真未启动' }],
    }
  }
  const lines = [...seats]
    .sort((a, b) => a.floor - b.floor)
    .map((s) => `${s.floor}F:剩 ${s.total - s.used} 座/共 ${s.total}`)
    .join(';')
  const totalFree = seats.reduce((acc, s) => acc + (s.total - s.used), 0)
  const bestFloor = [...seats].sort((a, b) => b.total - b.used - (a.total - a.used))[0]
  const message = `${lib?.name ?? '图书馆'}实时座位:${lines}。全馆剩余 ${totalFree} 座,${bestFloor.floor}F 最空,建议直奔。`
  return {
    result: { type: 'library', message, buildingIds: lib ? [lib.id] : undefined },
    trace: [
      { title: '读取座位数据', detail: `${seats.length} 个楼层,剩 ${totalFree} 座` },
      { title: '生成建议', detail: `推荐 ${bestFloor.floor}F` },
    ],
  }
}

// ---------------------------------------------------------------------------
/** venueId 可能是楼宇 id 也可能是房间 id(如 r_micc_201),统一解析出展示名与楼宇 id */
async function eventInfo(_intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const events = ctx.sim.getState().events
  if (!events.length) {
    return { result: { type: 'events', message: SIM_OFF }, trace: [{ title: '读取活动列表', detail: '仿真未启动' }] }
  }
  const rooms = await ensureRooms(ctx)
  const roomOf = new Map<string, Room>(rooms.map((r) => [r.id, r]))
  const resolve = (venueId: string): { label: string; buildingId: string } => {
    const bName = buildingName(ctx, venueId)
    if (bName) return { label: bName, buildingId: venueId }
    const room = roomOf.get(venueId)
    if (room) {
      return { label: room.name, buildingId: room.buildingId }
    }
    return { label: venueId, buildingId: '' }
  }
  const lines = [...events]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((e) => `${e.start}-${e.end}《${e.title}》@${resolve(e.venueId).label}(约 ${e.crowd} 人)`)
    .join('\n')
  const message = `今日校园活动共 ${events.length} 场:\n${lines}\n相关场馆已在 3D 场景高亮。`
  return {
    result: {
      type: 'events',
      message,
      buildingIds: [...new Set(events.map((e) => resolve(e.venueId).buildingId).filter(Boolean))],
    },
    trace: [
      { title: '读取活动列表', detail: `${events.length} 场活动` },
      { title: '高亮场馆', detail: '已在 3D 场景标记' },
    ],
  }
}

// ---------------------------------------------------------------------------
async function emergencyDrill(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  // 演练楼栋:优先 slots 指定,否则默认 C 教学楼
  const teachings = ctx.buildings.filter((b) => b.feature === 'teaching' && b.name)
  const target =
    (intent.slots.buildingId ? teachings.find((b) => b.id === intent.slots.buildingId) : undefined) ??
    teachings.find((b) => b.name === 'C教学楼') ??
    teachings[0]

  const landmarks = await loadLandmarks()
  // 集合点:以『体育场/广场』结尾的开阔场地(排除『中心广场金字塔』这类标志物)
  const assembly = landmarks.filter((l) => /(体育场|广场)$/.test(l.name)).slice(0, 2).map((l) => l.name)

  const buildingIds = [...new Set([...(target ? [target.id] : []), ...teachings.map((b) => b.id)])]
  const place = target?.name ?? '目标楼宇'
  const message =
    `应急疏散演练流程(${place}):① 听到警报后沿最近安全出口有序撤离,不乘电梯;② 低姿捂口鼻,按疏散指示行进;③ 前往集合点:${assembly.join(' 或 ') || '就近开阔广场'};④ 清点人数并上报指挥部。相关楼宇已在 3D 场景高亮。`

  return {
    result: { type: 'drill', message, buildingIds },
    trace: [
      { title: '确定演练楼栋', detail: place },
      { title: '规划疏散集合点', detail: assembly.join('、') || '就近开阔场地' },
      { title: '下发演练指令', detail: '等待确认开始' },
    ],
  }
}

// ---------------------------------------------------------------------------
export async function simHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  switch (intent.intent) {
    case 'canteen_crowd':
      return canteenCrowd(intent, ctx)
    case 'library_seat':
      return librarySeat(intent, ctx)
    case 'event_info':
      return eventInfo(intent, ctx)
    case 'emergency_drill':
      return emergencyDrill(intent, ctx)
    default: {
      const r: TaskResult = { type: 'unknown', message: '仿真Agent暂时处理不了这个请求。' }
      return { result: r, trace: [{ title: '兜底', detail: `未支持的意图 ${intent.intent}` }] }
    }
  }
}
