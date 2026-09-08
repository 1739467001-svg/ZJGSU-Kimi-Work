// 意图调度器:按 intent 路由到领域 handler,并向 campusStore 渐进 patch AgentStep 时间线
// 节奏:调度Agent 起手(200-500ms)→ 领域Agent 逐步推进(每步 200-500ms)
import type { AgentStep, Intent, IntentName, Room, TaskResult } from '../lib/agentTypes'
import { DEPLOY_BASE } from '../lib/deployBase'
import type { BakedBuilding, BakedLandmark } from '../lib/campusData'
import { requestRooms } from '../lib/roomsLoader'
import type { useCampusStore } from '../store/campusStore'
import type { useUIStore } from '../store/uiStore'
import type { useSimStore } from '../store/simStore'
import { bookingHandler } from './handlers/bookingHandler'
import { repairHandler } from './handlers/repairHandler'
import { overviewHandler } from './handlers/overviewHandler'
import { navigationHandler } from './handlers/navigationHandler'
import { tourHandler } from './handlers/tourHandler'
import { sceneHandler } from './handlers/sceneHandler'
import { simHandler } from './handlers/simHandler'

// ---------------------------------------------------------------------------
// Handler 上下文与输出契约
// ---------------------------------------------------------------------------
export interface HandlerContext {
  buildings: BakedBuilding[]
  campus: typeof useCampusStore
  ui: typeof useUIStore
  sim: typeof useSimStore
}

export interface TraceStep {
  title: string
  detail: string
}

export interface HandlerOutput {
  result: TaskResult
  /** 领域 Agent 的执行轨迹,将按序渐进地写进 agentSteps 时间线 */
  trace: TraceStep[]
}

export type IntentHandler = (intent: Intent, ctx: HandlerContext) => Promise<HandlerOutput>

/** 房间数据兜底:store 为空时经共享缓存懒加载 /data/sim/rooms.json 并回写 store */
export async function ensureRooms(ctx: HandlerContext): Promise<Room[]> {
  const existing = ctx.campus.getState().rooms
  if (existing.length) return existing
  // requestRooms 内部走 ensureRoomsLoaded 的全局 Promise 缓存:
  // 与剖切/选房/面板等触发点共享,不会重复 fetch
  return requestRooms()
}

// ---------------------------------------------------------------------------
// landmarks 懒加载缓存(tour / navigation / drill 共用,本地 JSON,无外链)
// ---------------------------------------------------------------------------
let landmarksCache: BakedLandmark[] | null = null

export async function loadLandmarks(): Promise<BakedLandmark[]> {
  if (landmarksCache) return landmarksCache
  try {
    const res = await fetch(`${DEPLOY_BASE}data/campus/landmarks.json`)
    const data: unknown = await res.json()
    landmarksCache = (data as { landmarks?: BakedLandmark[] }).landmarks ?? []
  } catch {
    landmarksCache = []
  }
  return landmarksCache
}

// ---------------------------------------------------------------------------
// 意图中文名(时间线展示用)
// ---------------------------------------------------------------------------
const INTENT_LABEL: Record<IntentName, string> = {
  book_room: '会议室/房间预约',
  find_free_classroom: '空教室查询',
  repair: '故障报修',
  navigate: '校园导航',
  admin_overview: '校园运行态势',
  campus_tour: '校园巡礼',
  tour_control: '巡礼控制',
  ask_knowledge: '校园知识问答',
  scene_director: '场景导演',
  set_quality: '画质调节',
  canteen_crowd: '食堂人流查询',
  library_seat: '图书馆座位查询',
  emergency_drill: '应急疏散演练',
  event_info: '校园活动查询',
  unknown: '未识别意图',
}

// ---------------------------------------------------------------------------
// 兜底 handler
// ---------------------------------------------------------------------------
const unknownHandler: IntentHandler = async (intent) => ({
  result: {
    type: 'unknown',
    message: `暂时没听懂「${intent.rawText}」。可以试试:订会议室、找空教室、故障报修、校园导航、运行态势、食堂人流、图书馆座位、校园活动、场景切换(夜晚/下雨/秋天)、画质调节(高/中/低)或校训巡礼。`,
  },
  trace: [{ title: '兜底回复', detail: '未匹配到明确意图,已给出能力提示' }],
})

const HANDLERS: Record<IntentName, IntentHandler> = {
  book_room: bookingHandler,
  find_free_classroom: bookingHandler,
  repair: repairHandler,
  navigate: navigationHandler,
  admin_overview: overviewHandler,
  campus_tour: tourHandler,
  tour_control: tourHandler,
  ask_knowledge: tourHandler,
  scene_director: sceneHandler,
  set_quality: sceneHandler,
  canteen_crowd: simHandler,
  library_seat: simHandler,
  emergency_drill: simHandler,
  event_info: simHandler,
  unknown: unknownHandler,
}

// ---------------------------------------------------------------------------
// 时间线推进
// ---------------------------------------------------------------------------
let stepSeq = 1
const sid = () => `step_${stepSeq++}`
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
/** 每步 200-500ms 的渐进节奏 */
const pace = () => sleep(200 + Math.floor(Math.random() * 301))

export async function dispatchIntent(intent: Intent, ctx: HandlerContext): Promise<TaskResult> {
  const handler = HANDLERS[intent.intent] ?? unknownHandler
  const steps: AgentStep[] = []
  const sync = () => ctx.campus.getState().setAgentSteps([...steps])

  // ① 调度Agent 起手:意图解析
  const s0: AgentStep = {
    id: sid(), agent: '调度Agent', title: '意图解析',
    detail: `收到指令:「${intent.rawText}」`, status: 'running',
  }
  steps.push(s0)
  sync()
  await pace()

  s0.status = 'done'
  s0.detail = `识别为「${INTENT_LABEL[intent.intent]}」,置信度 ${(intent.confidence * 100).toFixed(0)}%,分派给${intent.agent}`
  sync()

  // ② 领域Agent 跟进
  const run: AgentStep = {
    id: sid(), agent: intent.agent, title: '任务执行', detail: '处理中…', status: 'running',
  }
  steps.push(run)
  sync()
  await pace()

  let output: HandlerOutput
  try {
    output = await handler(intent, ctx)
  } catch (e) {
    run.status = 'error'
    run.detail = e instanceof Error ? e.message : String(e)
    sync()
    return { type: 'unknown', message: '执行出错了,请换个说法再试一次。' }
  }

  const traces = output.trace.length
    ? output.trace
    : [{ title: '处理完成', detail: output.result.message.slice(0, 48) }]

  run.title = traces[0].title
  run.detail = traces[0].detail
  run.status = 'done'
  sync()

  for (const tr of traces.slice(1)) {
    const st: AgentStep = { id: sid(), agent: intent.agent, title: tr.title, detail: '…', status: 'running' }
    steps.push(st)
    sync()
    await pace()
    st.status = 'done'
    st.detail = tr.detail
    sync()
  }

  return output.result
}
