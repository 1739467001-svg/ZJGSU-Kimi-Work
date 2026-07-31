// 导航Agent:两楼宇间路径描述(navigate)——直线估算 + 方向 + 途经地标
import type { Intent } from '../../lib/agentTypes'
import type { BakedBuilding, BakedLandmark } from '../../lib/campusData'
import { matchBuildings } from '../parseIntent'
import { loadLandmarks, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

/** 点到线段距离(局部米制坐标) */
function distToSegment(p: [number, number], a: [number, number], b: [number, number]): number {
  const vx = b[0] - a[0]
  const vz = b[1] - a[1]
  const wx = p[0] - a[0]
  const wz = p[1] - a[1]
  const len2 = vx * vx + vz * vz
  const t = len2 > 0 ? Math.max(0, Math.min(1, (wx * vx + wz * vz) / len2)) : 0
  const dx = p[0] - (a[0] + t * vx)
  const dz = p[1] - (a[1] + t * vz)
  return Math.hypot(dx, dz)
}

function clarify(mention: string, cands: BakedBuilding[]): HandlerOutput {
  // 展示去重:同名多栋(如两栋『文体中心』)只列一次
  const opts = [...new Set(cands.slice(0, 4).map((b) => `${b.name}(${b.zone || '校园'})`))].join('、')
  return {
    result: { type: 'unknown', message: `你说的「${mention}」可能指:${opts}。请说全一点,例如「从综合大楼到${cands[0].name}怎么走」。` },
    trace: [{ title: '楼宇消歧', detail: `「${mention}」命中 ${cands.length} 栋楼` }],
  }
}

export async function navigationHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const { slots } = intent

  // 终点解析
  let to: BakedBuilding | undefined = slots.targetId
    ? ctx.buildings.find((b) => b.id === slots.targetId)
    : undefined
  if (!to && slots.target) {
    const cands = matchBuildings(slots.target, ctx.buildings)
    if (cands.length === 1) to = cands[0]
    else if (cands.length > 1) return clarify(slots.target, cands)
  }
  if (!to) {
    // 目的地说法未被识别(非法/别名之外的楼名)→ 指明哪一段没听懂
    const message = slots.target
      ? `没认出「${slots.target}」是哪栋楼,可以说楼宇全名或常用别名,例如「从图书馆到文体中心怎么走」。`
      : '请问目的地是哪里?例如「从图书馆到文体中心怎么走」。'
    return {
      result: { type: 'unknown', message },
      trace: [{ title: '解析终点', detail: slots.target ? `「${slots.target}」未匹配到任何楼宇` : '缺少目的地,等待澄清' }],
    }
  }

  // 起点解析:未提及则默认「综合大楼」(坐标原点,校园中枢)
  let from: BakedBuilding | undefined = slots.buildingId
    ? ctx.buildings.find((b) => b.id === slots.buildingId)
    : undefined
  if (!from && slots.building) {
    const cands = matchBuildings(slots.building, ctx.buildings)
    if (cands.length === 1) from = cands[0]
    else if (cands.length > 1) return clarify(slots.building, cands)
  }
  if (!from) from = ctx.buildings.find((b) => b.name === '综合大楼') ?? to

  const dx = to.center[0] - from.center[0]
  const dz = to.center[1] - from.center[1]
  const straight = Math.hypot(dx, dz)
  const route = straight * 1.3 // 路口绕行系数
  const walkMin = Math.max(1, Math.round(route / 80)) // 步行 80m/min

  // 方向描述(x 向东为正,z 向南为正)
  const dirs: string[] = []
  if (Math.abs(dx) > Math.abs(dz)) {
    dirs.push(dx > 0 ? '东' : '西')
    if (Math.abs(dz) > 40) dirs.push(dz > 0 ? '南' : '北')
  } else {
    dirs.push(dz > 0 ? '南' : '北')
    if (Math.abs(dx) > 40) dirs.push(dx > 0 ? '东' : '西')
  }

  // 途经地标:距路径线段 90m 以内,取前 2 个
  const landmarks = await loadLandmarks()
  const via = landmarks
    .filter((l: BakedLandmark) => distToSegment(l.position, from.center, to.center) < 90)
    .slice(0, 2)
    .map((l) => l.name)
  const viaNote = via.length ? `,途经${via.join('、')}` : ''

  const fromNote = slots.building || slots.buildingId ? from.name ?? '起点' : `${from.name}(当前位置)`
  const message =
    `从「${fromNote}」到「${to.name}」:先向${dirs[0]}${dirs[1] ? `、再向${dirs[1]}` : ''}行进${viaNote},即可到达。直线约 ${Math.round(straight)} 米,步行约 ${walkMin} 分钟。导航面板已展开,两栋楼已在 3D 场景高亮。`

  return {
    result: { type: 'navigation', message, buildingIds: [from.id, to.id] },
    trace: [
      { title: '解析起终点', detail: `${from.name ?? '起点'} → ${to.name}` },
      { title: '估算路径', detail: `直线 ${Math.round(straight)}m,步行约 ${walkMin} 分钟` },
      { title: '生成指引', detail: via.length ? `途经 ${via.join('、')}` : '直达路线' },
    ],
  }
}
