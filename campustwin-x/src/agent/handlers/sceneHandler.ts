// 场景导演Agent:天气/季节/昼夜切换(scene_director)+ 画质调节(set_quality)
// 昼夜通过 simStore.simClock 锁定当日对应时刻(与 TimeSwitch 同一契约);
// 画质通过 uiStore.setQuality 并退出自动档(与 QualitySwitch 同一契约)
import type { Intent } from '../../lib/agentTypes'
import type { Quality, Season, Weather } from '../../store/uiStore'
import type { HandlerContext, HandlerOutput } from '../dispatchIntent'
import { getDuskMs, getNightMs } from '../../lib/sun'

type SceneKind = NonNullable<Intent['slots']['scene']>

const SCENE_LABEL: Record<SceneKind, string> = {
  day: '白天', night: '夜晚', dusk: '黄昏',
  rain: '下雨', snow: '下雪', fog: '大雾',
  spring: '春', summer: '夏', autumn: '秋', winter: '冬',
}

const SEASON_OF: Partial<Record<SceneKind, Season>> = {
  spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter',
}
const WEATHER_OF: Partial<Record<SceneKind, Weather>> = {
  rain: 'rain', snow: 'snow', fog: 'fog',
}

/**
 * 昼夜相位 → 当日锁定时刻(与 TimeSwitch 按钮共用同一套动态时刻逻辑):
 * 白天固定 10:00;黄昏 = 当日日落前约 25 分钟;夜晚 = 当日日落后约 90 分钟(suncalc 动态计算)。
 */
function phaseLockMs(scene: SceneKind): { nowMs: number; label: string } | null {
  const fmt = (ms: number): string => {
    const d = new Date(ms)
    return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (scene === 'day') {
    const d = new Date()
    d.setHours(10, 0, 0, 0)
    return { nowMs: d.getTime(), label: '10:00' }
  }
  if (scene === 'dusk') {
    const nowMs = getDuskMs()
    return { nowMs, label: `${fmt(nowMs)}(当日日落前 25 分钟)` }
  }
  if (scene === 'night') {
    const nowMs = getNightMs()
    return { nowMs, label: `${fmt(nowMs)}(当日日落后 90 分钟)` }
  }
  return null
}

const QUALITY_LABEL: Record<Quality, string> = { high: '高', medium: '中', low: '低' }

// ---------------------------------------------------------------------------
// 画质调节(set_quality)
// ---------------------------------------------------------------------------
function setQuality(intent: Intent, ctx: HandlerContext): HandlerOutput {
  const q = intent.slots.quality
  if (!q) {
    return {
      result: { type: 'unknown', message: '想调到哪一档画质?可以说「画质调到最高」「画质调低一点」或「中等画质」。' },
      trace: [{ title: '解析画质档位', detail: '缺少档位词,等待澄清' }],
    }
  }
  const ui = ctx.ui.getState()
  ui.setQuality(q)
  if (ui.autoQuality) ui.setAutoQuality(false) // 手动选档即退出自动档,避免性能监控立刻降回去
  return {
    result: {
      type: 'scene_changed',
      message: `画质已切换为「${QUALITY_LABEL[q]}」档(已关闭自动画质)。可随时说「画质调到最高/中/低」再调整。`,
    },
    trace: [
      { title: '解析画质档位', detail: `quality=${q}` },
      { title: '应用画质', detail: `渲染画质→${QUALITY_LABEL[q]},自动画质已关闭` },
    ],
  }
}

// ---------------------------------------------------------------------------
// 场景导演(scene_director)
// ---------------------------------------------------------------------------
export async function sceneHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  if (intent.intent === 'set_quality') return setQuality(intent, ctx)

  const scene = intent.slots.scene
  if (!scene) {
    return {
      result: {
        type: 'unknown',
        message: '想切换什么场景?支持:白天/夜晚/黄昏,下雨/下雪/大雾,以及春夏秋冬四季。例如「切换到夜晚场景」。',
      },
      trace: [{ title: '解析场景', detail: '缺少场景词,等待澄清' }],
    }
  }

  const ui = ctx.ui.getState()
  const applied: string[] = []

  // 天气槽位 → uiStore.setWeather
  const weather = WEATHER_OF[scene]
  if (weather) {
    ui.setWeather(weather)
    applied.push(`天气→${SCENE_LABEL[scene]}`)
  } else if (scene === 'day' || scene === 'night' || scene === 'dusk') {
    ui.setWeather('clear') // 昼夜指令附带晴朗天气,避免与雨雪叠加冲突
  }

  // 季节槽位 → uiStore.setSeason;同句再补扫一次季节词(『秋天下雨』两季都切)
  const seasonChar = /(春|夏|秋|冬)(?:天|季|日)?/.exec(intent.rawText)?.[1] as
    | '春' | '夏' | '秋' | '冬'
    | undefined
  const SEASON_CN: Record<'春' | '夏' | '秋' | '冬', Season> = {
    春: 'spring', 夏: 'summer', 秋: 'autumn', 冬: 'winter',
  }
  const season: Season | undefined = SEASON_OF[scene] ?? (seasonChar ? SEASON_CN[seasonChar] : undefined)
  if (season) {
    ui.setSeason(season)
    applied.push(`季节→${SCENE_LABEL[season]}`)
  }

  // 昼夜槽位 → simStore.simClock 锁定当日对应时刻(光照系统按 simClock 实时计算太阳方位;
  // 锁定同时恢复 speed=60,避免从自动模式的高速循环带过来)
  const phase = phaseLockMs(scene)
  if (phase) {
    ctx.sim.getState().setSimClock({ nowMs: phase.nowMs, speed: 60, locked: true })
    applied.push(`昼夜→${SCENE_LABEL[scene]}(锁定 ${phase.label})`)
  }

  const message = `场景导演执行完毕:${applied.join(',')}。`

  return {
    result: { type: 'scene_changed', message },
    trace: [
      { title: '解析场景', detail: `scene=${scene}(${SCENE_LABEL[scene]})` },
      { title: '下发指令', detail: applied.join('、') || '无可用槽位' },
    ],
  }
}
