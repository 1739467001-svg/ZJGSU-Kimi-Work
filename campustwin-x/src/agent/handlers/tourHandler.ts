// 导游Agent:校训巡礼(campus_tour)+ 校园知识问答(ask_knowledge)
import type { Intent } from '../../lib/agentTypes'
import type { BakedLandmark } from '../../lib/campusData'
import { useTourStore } from '../../store/tourStore'
import { loadLandmarks, type HandlerContext, type HandlerOutput } from '../dispatchIntent'

/** 校训「诚毅勤朴」巡礼固定途径点(按 landmarks.json id) */
const TOUR_WAYPOINTS = [
  'gate_south',        // 飞翔门(南大门)——起点
  'gate_centennial',   // 百年校庆纪念门——朴
  'ding_centennial',   // 百年纪念鼎——诚
  'statue_zhang',      // 章乃器铜像——毅
  'statue_confucius',  // 孔子铜像
  'clock_flower',      // 花坛钟——勤
  'lake_mohu',         // 墨湖——终点
]

/** 讲稿取 story 首句 */
function oneSentence(l: BakedLandmark): string {
  const story = l.story ?? ''
  const first = story.split(/[;,.!?;,.!?]/)[0]?.trim()
  return first || `${l.name}到了`
}

function landmarkTerms(l: BakedLandmark): string[] {
  const terms = [l.name]
  const paren = /^(.*?)\((.*?)\)$/.exec(l.name)
  if (paren) terms.push(paren[1], paren[2])
  return terms.filter((x) => !!x)
}

// ---------------------------------------------------------------------------
// 校训巡礼
// ---------------------------------------------------------------------------
async function startTour(_intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const landmarks = await loadLandmarks()
  const waypoints = TOUR_WAYPOINTS.map((id) => landmarks.find((l) => l.id === id)).filter(
    (l): l is BakedLandmark => !!l,
  )
  if (!waypoints.length) {
    return {
      result: { type: 'unknown', message: '地标数据尚未就绪,暂时无法开始巡礼。' },
      trace: [{ title: '加载地标', detail: 'landmarks.json 为空' }],
    }
  }

  const script = waypoints.map((l, i) => `${i + 1}. ${l.name}——${oneSentence(l)}`).join('\n')
  const message = `校训巡礼路线已生成(诚·毅·勤·朴,共 ${waypoints.length} 站):\n${script}\n导游面板已展开,镜头将逐站巡航,讲到哪飞到哪。`

  // 逐站巡航:途径点写入 tourStore,TourCruise 接管镜头逐站飞行
  useTourStore.getState().start(
    waypoints.map((l) => ({ id: l.id, name: l.name, position: l.position, script: oneSentence(l) })),
  )

  // 镜头联动:先拉到全校视角,巡礼途径点周边楼宇同步高亮
  ctx.campus.getState().focusCamera({ type: 'campus' })

  // 高亮途径点附近 80m 内的具名楼宇
  const ids: string[] = []
  for (const l of waypoints) {
    for (const b of ctx.buildings) {
      if (!b.name || ids.includes(b.id)) continue
      if (Math.hypot(b.center[0] - l.position[0], b.center[1] - l.position[1]) <= 80) ids.push(b.id)
    }
  }

  return {
    result: { type: 'tour_started', message, buildingIds: ids.slice(0, 8) },
    trace: [
      { title: '规划路线', detail: `${waypoints.length} 站:诚→毅→勤→朴` },
      { title: '生成讲稿', detail: `每站一句,共 ${waypoints.length} 句` },
      { title: '启动巡礼', detail: '镜头即将按途径点巡航' },
    ],
  }
}

// ---------------------------------------------------------------------------
// 校园知识问答
// ---------------------------------------------------------------------------
const FEATURE_LABEL: Record<string, string> = {
  teaching: '教学楼', college: '学院楼', library: '图书馆', admin: '行政楼',
  venue: '场馆', sport: '体育设施', dorm: '学生公寓', canteen: '食堂',
  service: '后勤服务设施', unknown: '建筑',
}

async function answerKnowledge(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  const text = intent.rawText

  // 优先匹配地标(含括号内别名,如『南大门』)
  const landmarks = await loadLandmarks()
  const lm = landmarks.find((l) => landmarkTerms(l).some((t) => text.includes(t)))
  if (lm) {
    return {
      result: { type: 'knowledge', message: `${lm.name}:${lm.story ?? '暂无更多资料。'}` },
      trace: [{ title: '检索地标', detail: `命中「${lm.name}」` }, { title: '组织回答', detail: '已给出地标故事' }],
    }
  }

  // 校训
  if (/校训/.test(text)) {
    return {
      result: {
        type: 'knowledge',
        message: '浙江工商大学校训是「诚、毅、勤、朴」。校园里各有地标呼应:百年纪念鼎(诚)、章乃器铜像(毅)、花坛钟(勤)、百年校庆纪念门(朴)——对我说「来一段校训巡礼」可以走一遍。',
      },
      trace: [{ title: '检索校训', detail: '诚·毅·勤·朴' }],
    }
  }

  // 楼宇知识
  const b = ctx.buildings.find((x) => x.name && text.includes(x.name))
  if (b) {
    const label = FEATURE_LABEL[b.feature] ?? '建筑'
    return {
      result: {
        type: 'knowledge',
        message: `${b.name}是学校的${label},地上 ${b.levels} 层,建筑高度约 ${b.height} 米${b.alias.length ? `,也叫「${b.alias.join('」「')}」` : ''}。3D 场景中已为你高亮。`,
        buildingIds: [b.id],
      },
      trace: [{ title: '检索楼宇', detail: `命中「${b.name}」` }],
    }
  }

  return {
    result: {
      type: 'knowledge',
      message: '这个问题超出了我的校园知识库。可以问我地标故事(如「墨湖的故事」)、楼宇信息(如「介绍一下图书馆」),或校训由来。',
    },
    trace: [{ title: '检索知识库', detail: '未命中,已给出可问范围' }],
  }
}

// ---------------------------------------------------------------------------
// 巡礼控制(上一站/下一站/暂停/继续)——操作 tourStore,镜头由 TourCruise 响应
// ---------------------------------------------------------------------------
function tourControl(intent: Intent): HandlerOutput {
  const word = intent.rawText.trim()
  const tour = useTourStore.getState()

  // 无进行中巡礼(未开始/已结束):明确反馈而不是「没听懂」
  if (!tour.waypoints.length || tour.status === 'idle') {
    return {
      result: {
        type: 'knowledge',
        message: `已收到「${word}」,但当前没有进行中的巡礼。对我说「带我逛校园」即可开始校训巡礼。`,
      },
      trace: [{ title: '巡礼控制', detail: `「${word}」→ 无进行中巡礼,已提示如何开始` }],
    }
  }

  if (/暂停/.test(word)) {
    tour.pause()
    const wp = tour.waypoints[tour.currentIndex]
    return {
      result: {
        type: 'knowledge',
        message: `巡礼已暂停在第 ${tour.currentIndex + 1}/${tour.waypoints.length} 站「${wp.name}」。说「继续巡礼」或在导游面板点「继续」即可续游。`,
      },
      trace: [{ title: '巡礼控制', detail: `「${word}」→ 已暂停于第 ${tour.currentIndex + 1} 站` }],
    }
  }

  if (/继续|续游|恢复/.test(word)) {
    tour.resume()
    const wp = tour.waypoints[tour.currentIndex]
    return {
      result: {
        type: 'knowledge',
        message: `巡礼继续,镜头正前往第 ${tour.currentIndex + 1}/${tour.waypoints.length} 站「${wp.name}」。`,
      },
      trace: [{ title: '巡礼控制', detail: `「${word}」→ 已继续` }],
    }
  }

  // 上一站/下一站(中文数字规整后 rawText 仍可能带「1」,两种形态都兼容)
  if (/上一站|上1站|上个/.test(word)) tour.prev()
  else tour.next()
  const now = useTourStore.getState()
  const wp = now.waypoints[now.currentIndex]
  return {
    result: {
      type: 'knowledge',
      message: `已跳转到第 ${now.currentIndex + 1}/${now.waypoints.length} 站「${wp.name}」,镜头正在前往。`,
    },
    trace: [{ title: '巡礼控制', detail: `「${word}」→ 跳转第 ${now.currentIndex + 1} 站「${wp.name}」` }],
  }
}

export async function tourHandler(intent: Intent, ctx: HandlerContext): Promise<HandlerOutput> {
  if (intent.intent === 'tour_control') return tourControl(intent)
  return intent.intent === 'ask_knowledge' ? answerKnowledge(intent, ctx) : startTour(intent, ctx)
}
