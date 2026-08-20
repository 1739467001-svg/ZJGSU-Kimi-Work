// 一次性验收脚本:四条核心指令链路 + 场景/画质 端到端(handler → store → 面板状态)
// 用法:node scripts/verify-chains.cjs
// 原理:tsc 编译 agent+store+lib 为 CJS,stub 全局 fetch 指向 public/,用真实 zustand store 跑全链路。
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'verify-chains')

execSync(
  `npx tsc src/agent/index.ts --ignoreConfig --outDir "${OUT}" ` +
    `--module commonjs --target es2020 --moduleResolution node --ignoreDeprecations 6.0 --esModuleInterop --skipLibCheck --jsx react-jsx`,
  { cwd: ROOT, stdio: 'inherit' },
)

// ---- stub fetch:把 /data/... 映射到 public/ 目录 -----------------------------
global.fetch = async (url) => {
  const p = path.join(ROOT, 'public', String(url).replace(/^\//, ''))
  try {
    const text = fs.readFileSync(p, 'utf8')
    return { ok: true, json: async () => JSON.parse(text) }
  } catch {
    return { ok: false, status: 404, json: async () => ({}) }
  }
}

const { createCommandHandler } = require(path.join(OUT, 'agent', 'index.js'))
const { useCampusStore } = require(path.join(OUT, 'store', 'campusStore.js'))
const { useUIStore } = require(path.join(OUT, 'store', 'uiStore.js'))
const { useSimStore } = require(path.join(OUT, 'store', 'simStore.js'))
const { useTourStore } = require(path.join(OUT, 'store', 'tourStore.js'))

const buildings = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/campus/buildings.json'), 'utf8'),
).buildings
useCampusStore.getState().setBuildings(buildings)

const handler = createCommandHandler({ buildings, stores: { campus: useCampusStore, ui: useUIStore, sim: useSimStore } })
const submit = useCampusStore.getState().submitCommand
// submitCommand 内部用的就是注册的 handler;这里直接注册
useCampusStore.getState().registerCommandHandler(handler)

let pass = 0
const rows = []
async function check(chain, text, assertFn) {
  // 每条链路前重置关键状态,避免相互污染
  useCampusStore.setState({
    highlightedBuildingIds: [], highlightedRoomIds: [], alarmRoomId: null, alarmBuildingId: null,
    activePanel: 'empty', sceneMode: 'idle', agentSteps: [],
  })
  const r = await submit(text)
  const state = {
    campus: useCampusStore.getState(),
    ui: useUIStore.getState(),
    sim: useSimStore.getState(),
  }
  let note = ''
  let ok = false
  try {
    note = await assertFn(r, state)
    ok = true
  } catch (e) {
    note = e.message
  }
  if (ok) pass++
  rows.push({ chain, text, ok, note, type: r?.type })
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

async function main() {
  // 链路① 找会议室:解析 → bookingHandler → BookingPanel 数据(highlightedRoomIds)→ 面板打开
  await check('①找会议室', '帮我找间空会议室', (r, s) => {
    assert(r.type === 'booking_candidates', `type=${r.type}`)
    assert(r.roomIds?.length > 0, '无候选 roomIds')
    assert(s.campus.activePanel === 'booking', `panel=${s.campus.activePanel}`)
    assert(s.campus.sceneMode === 'booking', `sceneMode=${s.campus.sceneMode}`)
    assert(s.campus.highlightedRoomIds.length === r.roomIds.length, '高亮房间未同步')
    assert(s.campus.rooms.length > 0, 'rooms 未加载')
    return `候选 ${r.roomIds.length} 间,面板=booking,高亮同步`
  })
  // 链路①变体:带人数/时段/设备
  await check('①找会议室', '帮我找一个明天下午能容纳 10 人有投影的会议室', (r, s) => {
    assert(r.type === 'booking_candidates', `type=${r.type}`)
    assert(s.campus.activePanel === 'booking', `panel=${s.campus.activePanel}`)
    return `时段+设备候选 ${r.roomIds.length} 间`
  })
  // 链路①边界:不存在的条件 → 优雅降级文案
  await check('①边界', '帮我找一间能坐 500 人的会议室', (r) => {
    assert(r.type === 'unknown', `type=${r.type}`)
    assert(/没有找到|换个条件/.test(r.message), `降级文案缺失:${r.message}`)
    return `降级文案:${r.message.slice(0, 30)}…`
  })
  // 链路② 报修:解析 → repairHandler → 工单 + 告警 + RepairPanel
  await check('②报修', '我要报修:C302 的投影仪坏了', (r, s) => {
    assert(r.type === 'ticket_created', `type=${r.type}`)
    assert(!!r.ticketId, '无 ticketId')
    assert(s.campus.tickets.some((t) => t.id === r.ticketId), '工单未入 store')
    assert(s.campus.alarmRoomId === r.roomIds[0], '告警房间未定位')
    assert(s.campus.activePanel === 'repair', `panel=${s.campus.activePanel}`)
    return `工单 ${r.ticketId},告警=${s.campus.alarmRoomId},面板=repair`
  })
  // 链路②边界:缺房间号 → 澄清
  await check('②边界', '我要报修', (r) => {
    assert(r.type === 'unknown', `type=${r.type}`)
    assert(/房间/.test(r.message), `澄清文案缺失:${r.message}`)
    return `澄清:${r.message.slice(0, 30)}…`
  })
  // 链路②边界:非法楼宇名 → 找不到房间的优雅降级
  await check('②边界', '我要报修:综合大楼 A301 的投影仪坏了', (r) => {
    assert(r.type === 'unknown', `type=${r.type}`)
    assert(/没有找到|确认房间号/.test(r.message), `降级文案缺失:${r.message}`)
    return `降级:${r.message.slice(0, 30)}…`
  })
  // 链路③ 校园态势:overviewHandler → OverviewPanel + 占用率热力
  await check('③态势', '看看现在校园态势', (r, s) => {
    assert(r.type === 'overview', `type=${r.type}`)
    assert(s.campus.activePanel === 'overview', `panel=${s.campus.activePanel}`)
    assert(s.campus.heatMode === 'occupancy', `heatMode=${s.campus.heatMode}`)
    return `面板=overview,热力=occupancy`
  })
  await check('③态势', '给我看看校园概览', (r, s) => {
    assert(r.type === 'overview' && s.campus.activePanel === 'overview', `type=${r.type}`)
    return '概览指令同样命中'
  })
  // 链路④ 逛校园:tourHandler → tour_started → TourPanel + 镜头拉回全校
  await check('④逛校园', '带我逛校园', (r, s) => {
    assert(r.type === 'tour_started', `type=${r.type}`)
    assert(s.campus.activePanel === 'tour', `panel=${s.campus.activePanel}`)
    assert(s.campus.sceneMode === 'tour', `sceneMode=${s.campus.sceneMode}`)
    assert(s.campus.cameraFocus?.type === 'campus', '镜头未联动')
    assert(/站/.test(r.message), '巡礼讲稿缺失')
    return `巡礼启动,讲稿 ${r.message.split('\n').length - 1} 站,镜头=campus`
  })
  // 链路④控制:下一站/暂停 → 真实逐站控制(操作 tourStore,依赖上一条链路已启动巡礼)
  await check('④巡礼控制', '下一站', (r) => {
    assert(r.type === 'knowledge', `type=${r.type}`)
    const ts = useTourStore.getState()
    assert(ts.waypoints.length > 0, 'tourStore 无途径点(巡礼未启动)')
    assert(ts.currentIndex === 1, `currentIndex=${ts.currentIndex},应为 1`)
    assert(/第 2\/\d+ 站/.test(r.message), `跳转文案缺失:${r.message}`)
    return `逐站跳转生效:第 ${ts.currentIndex + 1}/${ts.waypoints.length} 站「${ts.waypoints[1].name}」`
  })
  await check('④巡礼控制', '暂停一下', (r) => {
    assert(r.type === 'knowledge', `type=${r.type}`)
    const ts = useTourStore.getState()
    assert(ts.status === 'paused', `status=${ts.status},应为 paused`)
    assert(/已暂停/.test(r.message), `暂停文案缺失:${r.message}`)
    return `巡礼已暂停于第 ${ts.currentIndex + 1} 站`
  })
  // 场景:夜晚 → simClock 锁定「当日日落后 90 分钟」(sun.ts 动态锁定,杭州全年约 18:20~20:35)+ 天气晴
  await check('场景·夜', '切换到夜晚场景', (r, s) => {
    assert(r.type === 'scene_changed', `type=${r.type}`)
    assert(s.sim.simClock.locked === true, 'simClock 未锁定')
    // 换算为东八区小时断言,与运行机器时区无关
    const h = Math.floor(s.sim.simClock.nowMs / 3_600_000 + 8) % 24
    assert(h >= 18 && h <= 21, `锁定小时(东八区)=${h},应在日落后晚间 18~21 区间`)
    assert(s.ui.weather === 'clear', `weather=${s.ui.weather}`)
    return `simClock 锁定日落后 90 分钟(${h} 时),天气 clear`
  })
  // 场景:秋天下雨 → 天气 rain + 季节 autumn
  await check('场景·秋雨', '看看秋天下雨的校园', (r, s) => {
    assert(r.type === 'scene_changed', `type=${r.type}`)
    assert(s.ui.weather === 'rain', `weather=${s.ui.weather}`)
    assert(s.ui.season === 'autumn', `season=${s.ui.season}`)
    return 'weather=rain,season=autumn'
  })
  // 画质:调到最高 → uiStore.quality=high 且退出自动档
  await check('画质', '把画质调到最高', (r, s) => {
    assert(r.type === 'scene_changed', `type=${r.type}`)
    assert(s.ui.quality === 'high', `quality=${s.ui.quality}`)
    assert(s.ui.autoQuality === false, 'autoQuality 未关闭')
    return 'quality=high,自动画质已关'
  })
  // 仿真链路(先注入仿真快照):食堂/图书馆/活动
  useSimStore.getState().setSnapshot({
    canteenCrowd: [
      { placeId: 'xingyun', name: '行云苑食堂', level: 0.8, waitMin: 15 },
      { placeId: 'liushui', name: '流水苑食堂', level: 0.3, waitMin: 5 },
    ],
    librarySeats: [{ floor: 1, total: 500, used: 300 }, { floor: 2, total: 500, used: 100 }],
    events: [
      { id: 'ev_01', venueId: 'w1018218617', title: '手球赛', start: '0900', end: '1130', crowd: 1200 },
      { id: 'ev_04', venueId: 'r_sa_hall', title: '音乐会', start: '1900', end: '2100', crowd: 600 },
    ],
    buildingOccupancy: { w563534009: 0.9, w563533987: 0.6 },
    buildingEnergy: { w563534009: 120 },
  })
  await check('仿真·食堂', '现在食堂人多吗', (r, s) => {
    assert(r.type === 'canteen', `type=${r.type}`)
    assert(r.buildingIds.includes('w563779372'), `高亮楼宇 id 错位:${JSON.stringify(r.buildingIds)}`)
    return `食堂高亮楼宇=${r.buildingIds.join(',')}`
  })
  await check('仿真·活动', '今天学校有什么活动', (r) => {
    assert(r.type === 'events', `type=${r.type}`)
    assert(r.buildingIds.includes('w563530236'), `房间级场馆未映射到楼宇:${JSON.stringify(r.buildingIds)}`)
    assert(/剧院报告厅/.test(r.message), '房间级场馆名未解析')
    return '房间级 venueId 已解析为楼宇高亮'
  })
  // 时间线结构:所有步骤最终 done
  await check('时间线', '我要报修:C305 的空调不制冷', (r, s) => {
    assert(r.type === 'ticket_created', `type=${r.type}`)
    assert(s.campus.agentSteps.length >= 3, `步骤过少:${s.campus.agentSteps.length}`)
    assert(s.campus.agentSteps.every((x) => x.status === 'done'), '存在未完成的步骤')
    assert(s.campus.agentSteps[0].agent === '调度Agent', '首步应为调度Agent')
    return `时间线 ${s.campus.agentSteps.length} 步全部 done`
  })

  for (const r of rows) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} | ${r.chain} | ${r.text} | ${r.note}`)
  }
  console.log(`\n${pass}/${rows.length} 通过`)
  process.exit(pass === rows.length ? 0 : 1)
}

main().catch((e) => {
  console.error('链路验收脚本执行失败:', e)
  process.exit(2)
})
