// 态势Agent:校园运行概览(admin_overview)——读 simStore 的占用率/能耗
import type { Intent } from '../../lib/agentTypes'
import { ensureRooms, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

export async function overviewHandler(_intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const sim = ctx.sim.getState()
  const named = ctx.buildings.filter((b) => b.name)
  const nameOf = (id: string) => named.find((b) => b.id === id)?.name

  const occEntries = Object.entries(sim.buildingOccupancy)
    .filter(([id]) => nameOf(id))
    .sort((a, b) => b[1] - a[1])

  // ---------- 仿真快照可用 ----------
  if (occEntries.length) {
    const avg = occEntries.reduce((s, [, v]) => s + v, 0) / occEntries.length
    const top3 = occEntries.slice(0, 3)
    const topLines = top3.map(([id, v], i) => `${i + 1}. ${nameOf(id)} ${(v * 100).toFixed(0)}%`).join(';')

    const energyEntries = Object.entries(sim.buildingEnergy).filter(([id]) => nameOf(id))
    const totalEnergy = energyEntries.reduce((s, [, v]) => s + v, 0)
    energyEntries.sort((a, b) => b[1] - a[1])
    const topEnergy = energyEntries[0]

    const energyNote = energyEntries.length
      ? `今日累计能耗 ${totalEnergy.toFixed(0)} kWh,能耗最高:${nameOf(topEnergy[0])} ${topEnergy[1].toFixed(0)} kWh。`
      : ''
    const message =
      `校园运行态势:平均楼宇占用率 ${(avg * 100).toFixed(0)}%。最紧张楼宇:${topLines}。${energyNote}态势面板已展开,热力图切换为占用率模式。`

    return {
      result: { type: 'overview', message, buildingIds: top3.map(([id]) => id) },
      trace: [
        { title: '读取仿真快照', detail: `${occEntries.length} 栋楼宇占用率、${energyEntries.length} 栋能耗` },
        { title: '计算排名', detail: `最紧张:${nameOf(top3[0][0])} ${(top3[0][1] * 100).toFixed(0)}%` },
        { title: '生成概览', detail: '态势面板 + 占用率热力已开启' },
      ],
    }
  }

  // ---------- 仿真未启动:静态排期兜底 ----------
  const rooms = await ensureRooms(ctx)
  if (!rooms.length) {
    return {
      result: { type: 'overview', message: '仿真引擎尚未启动,房间数据也未就绪,暂时无法生成态势概览。' },
      trace: [{ title: '读取仿真快照', detail: '无数据' }],
    }
  }
  const byBuilding = new Map<string, { total: number; busy: number }>()
  for (const r of rooms) {
    const e = byBuilding.get(r.buildingId) ?? { total: 0, busy: 0 }
    e.total += 1
    if (r.status === 'busy') e.busy += 1
    byBuilding.set(r.buildingId, e)
  }
  const ranked = [...byBuilding.entries()]
    .filter(([id]) => nameOf(id))
    .map(([id, v]) => ({ id, ...v, ratio: v.total ? v.busy / v.total : 0 }))
    .sort((a, b) => b.ratio - a.ratio)
  const top = ranked.slice(0, 3)
  const topLines = top.map((x, i) => `${i + 1}. ${nameOf(x.id)}(${x.busy}/${x.total} 间占用)`).join(';')
  const message =
    `仿真引擎尚未启动,以下为静态排期概览:纳管房间 ${rooms.length} 间,当前最紧张楼宇:${topLines || '暂无'}。启动人群仿真后可查看实时占用率与能耗热力。`

  return {
    result: { type: 'overview', message, buildingIds: top.map((x) => x.id) },
    trace: [
      { title: '读取仿真快照', detail: '仿真未启动,改用静态排期' },
      { title: '静态统计', detail: `${rooms.length} 间房间,按楼宇占用数排名` },
    ],
  }
}
