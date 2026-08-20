// 规则意图解析引擎:12 种意图的关键词/正则识别 + 中文槽位抽取
// 纯函数、零依赖外部服务;楼宇识别基于 buildings 的 name + alias 双向映射
import type { AgentName, Intent, IntentName } from '../lib/agentTypes'
import type { BakedBuilding } from '../lib/campusData'
import { DEVICE_WORDS } from '../lib/rooms'

type Slots = Intent['slots']
type SceneKind = NonNullable<Slots['scene']>

// ---------------------------------------------------------------------------
// 中文数字规整:三号楼 → 3号楼、十二点 → 12点(支持 X十Y / 十Y / X十)
// ---------------------------------------------------------------------------
const CN_DIGIT: Record<string, string> = {
  零: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
  六: '6', 七: '7', 八: '8', 九: '9',
}

export function normalizeCnDigits(s: string): string {
  const withTen = s.replace(
    /([零一二两三四五六七八九])?十([零一二两三四五六七八九])?/g,
    (_m, hi: string | undefined, lo: string | undefined) =>
      `${hi ? CN_DIGIT[hi] ?? hi : '1'}${lo ? CN_DIGIT[lo] ?? lo : '0'}`,
  )
  return withTen.replace(/[零一二两三四五六七八九]/g, (c) => CN_DIGIT[c] ?? c)
}

// ---------------------------------------------------------------------------
// 楼宇匹配:name / alias 双向映射 + 宽松后缀匹配(『3号楼』→『3号学生公寓』)
// 返回按匹配强度降序的去重楼宇列表;>1 条时调用方应走 clarify 分支
// ---------------------------------------------------------------------------
export function matchBuildings(mentionRaw: string, buildings: BakedBuilding[]): BakedBuilding[] {
  const mention = normalizeCnDigits(mentionRaw).toLowerCase().replace(/[\s的地得]/g, '')
  if (mention.length < 2) return []
  const scored: { b: BakedBuilding; s: number }[] = []
  for (const b of buildings) {
    const terms = [b.name, ...(b.alias ?? [])].filter((x): x is string => !!x)
    let best = 0
    for (const term of terms) {
      const tl = normalizeCnDigits(term).toLowerCase()
      if (mention.includes(tl) || tl.includes(mention)) {
        best = Math.max(best, tl.length)
        continue
      }
      const m2 = mention.replace(/(大楼|楼|栋|座)$/, '')
      // 数字开头需数字边界:『3号』不应命中『33号学生公寓』
      if (m2.length >= 2) {
        const hit = /^\d/.test(m2)
          ? new RegExp(`(?<!\\d)${m2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(tl)
          : tl.includes(m2)
        if (hit) best = Math.max(best, m2.length * 0.9)
      }
    }
    if (best > 0) scored.push({ b, s: best })
  }
  scored.sort((x, y) => y.s - x.s)
  // 分数悬殊(头名 ≥ 次名 2 倍)时直接取头名:『综合大楼』应压过『钱江湾综合楼』的弱模糊命中
  const top = scored.length > 1 && scored[0].s >= scored[1].s * 2 ? [scored[0]] : scored
  const seen = new Map<string, BakedBuilding>()
  for (const { b } of top) if (!seen.has(b.id)) seen.set(b.id, b)
  return [...seen.values()]
}

// ---------------------------------------------------------------------------
// 槽位抽取
// ---------------------------------------------------------------------------
const SCENE_WORDS: [RegExp, SceneKind][] = [
  [/夜晚|夜里|夜景|夜间|晚上/, 'night'],
  [/黄昏|傍晚|夕阳|落日/, 'dusk'],
  [/清晨|白天|日间|正午/, 'day'],
  [/下雪|雪天|大雪|雪花/, 'snow'],
  [/下雨|雨天|暴雨|小雨|大雨|降雨/, 'rain'],
  [/大雾|起雾|雾天|雾气/, 'fog'],
  [/春天|春季|春日/, 'spring'],
  [/夏天|夏季|夏日/, 'summer'],
  [/秋天|秋季|秋日|落叶/, 'autumn'],
  [/冬天|冬季|冬日/, 'winter'],
]

function extractScene(t: string, slots: Slots): void {
  for (const [re, kind] of SCENE_WORDS) {
    if (re.test(t)) { slots.scene = kind; return }
  }
}

function extractCapacity(t: string, slots: Slots): void {
  const m = /(?:能坐|可容纳|容纳|坐下|坐|能装)?\s*(\d{1,3})\s*(?:个人|人)/.exec(t)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n > 0 && n <= 500) slots.capacity = n
  }
}

/** 画质槽位:需出现画质类语境词,档位词映射 high/medium/low */
function extractQuality(t: string, slots: Slots): void {
  if (!/(画质|清晰度|分辨率|流畅度)/.test(t)) return
  if (/(最高|极致|超清|最好|拉高|调高|高)/.test(t)) slots.quality = 'high'
  else if (/(最低|省电|调低|低)/.test(t)) slots.quality = 'low'
  else if (/(流畅|顺滑)/.test(t)) slots.quality = 'low'
  else if (/中/.test(t)) slots.quality = 'medium'
}

function extractEquipment(t: string, slots: Slots): void {
  const words = Object.keys(DEVICE_WORDS).sort((a, b) => b.length - a.length)
  const found: string[] = []
  for (const w of words) {
    if (t.includes(w)) {
      const dev = DEVICE_WORDS[w]
      if (!found.includes(dev)) found.push(dev)
    }
  }
  if (found.length) slots.equipment = found
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (h: number, m: number) => `${pad2(Math.min(h, 23))}${pad2(m)}`

const PERIOD_RANGE: Record<string, [number, number]> = {
  上午: [9, 12], 中午: [12, 13], 下午: [14, 17], 晚上: [18, 21],
}

function extractTime(t: string, slots: Slots): void {
  // 现在 / 马上
  if (/(现在|马上|立刻|立马)/.test(t)) {
    const d = new Date()
    slots.time = '现在'
    slots.start = hhmm(d.getHours(), d.getMinutes())
    slots.end = hhmm(d.getHours() + 1, d.getMinutes())
    return
  }
  // (今天|明天)?(上午|下午|…)?N点(半)?
  const m = /(今天|明天)?\s*(上午|中午|下午|晚上)?\s*(\d{1,2})\s*点(半)?/.exec(t)
  if (m) {
    // 『调低一点/快一点』里的『1点』是程度副词,不是时间(无日期/时段语境时拦截)
    if (!m[1] && !m[2] && m[3] === '1' && !m[4]) {
      const di = t.indexOf('1', m.index)
      if (di > 0 && '低高快慢大小多少早晚远近亮暗'.includes(t[di - 1])) {
        // 落入程度副词,继续走下方时段兜底
      } else {
        slots.time = `今天${m[3]}点`
        slots.start = hhmm(1, 0)
        slots.end = hhmm(2, 0)
        return
      }
    } else {
      let h = parseInt(m[3], 10)
      const half = !!m[4]
      const period = m[2] ?? ''
      if ((period === '下午' || period === '晚上') && h < 12) h += 12
      if (period === '中午' && h <= 6) h += 12
      slots.time = `${m[1] ?? '今天'}${period}${m[3]}点${half ? '半' : ''}`
      slots.start = hhmm(h, half ? 30 : 0)
      slots.end = hhmm(h + 1, half ? 30 : 0)
      return
    }
  }
  // 今天下午 / 明天上午 …(无具体钟点,给默认窗口)
  const dp = /(今天|明天)(上午|中午|下午|晚上)/.exec(t)
  if (dp) {
    const [s, e] = PERIOD_RANGE[dp[2]]
    slots.time = `${dp[1]}${dp[2]}`
    slots.start = hhmm(s, 0)
    slots.end = hhmm(e, 0)
  }
}

/** 字母楼房间号(C302)→ 顺带锁定字母教学楼(C教学楼) */
function findLetterBuilding(letter: string, buildings: BakedBuilding[]): BakedBuilding | undefined {
  const u = letter.toUpperCase()
  return buildings.find(
    (b) => b.name === `${u}教学楼` || (b.alias ?? []).includes(`${u}教`),
  )
}

function extractRoomAndBuilding(t: string, buildings: BakedBuilding[], slots: Slots): void {
  const lower = t.toLowerCase()
  // 1) 字母 + 三位数房间号(C302 / c 302)——先记房间号,楼宇归属延后裁定
  let letterB: BakedBuilding | undefined
  const lr = /([a-fA-F])\s?(\d{3})/.exec(t)
  if (lr) {
    slots.room = `${lr[1].toUpperCase()}${lr[2]}`
    letterB = findLetterBuilding(lr[1], buildings)
  }
  // 2) name / alias 精确包含(最长匹配优先;并列最长 → 歧义)
  //    显式说出的楼名优先于房间号字母推断(『综合大楼 A301』应锁定综合大楼)
  if (!slots.buildingId) {
    const hits: { b: BakedBuilding; term: string }[] = []
    for (const b of buildings) {
      for (const term of [b.name, ...(b.alias ?? [])]) {
        if (term && lower.includes(normalizeCnDigits(term).toLowerCase())) hits.push({ b, term })
      }
    }
    if (hits.length) {
      const maxLen = Math.max(...hits.map((h) => h.term!.length))
      const top = hits.filter((h) => h.term!.length === maxLen)
      const uniq = [...new Map(top.map((h) => [h.b.id, h])).values()]
      if (uniq.length === 1) {
        slots.building = uniq[0].b.name ?? uniq[0].term ?? undefined
        slots.buildingId = uniq[0].b.id
      } else {
        slots.building = top[0].term ?? undefined // 歧义:只记说法,待 clarify
      }
    }
  }
  // 2b) 楼名未命中/歧义时,回退到房间号字母推断的字母教学楼
  if (!slots.buildingId && letterB) {
    slots.building = letterB.name ?? undefined
    slots.buildingId = letterB.id
  }
  // 3) 『N号楼』模糊说法(三号楼 → 3号学生公寓;同名多栋 → 歧义)
  if (!slots.buildingId && !slots.building) {
    const mh = /(\d{1,2})号楼?/.exec(t)
    if (mh) {
      const boundary = new RegExp(`(?<!\\d)${mh[1]}号`) // 『3号』不命中『33号』
      const cands = buildings.filter((b) => b.name && boundary.test(b.name))
      if (cands.length === 1) { slots.building = cands[0].name ?? undefined; slots.buildingId = cands[0].id }
      else if (cands.length > 1) slots.building = `${mh[1]}号楼`
    }
  }
  // 4) 裸三位数房间号(302),需房间/设备语境
  if (!slots.room && /(室|房间|坏|修|空调|投影|灯|麦克|屏)/.test(t)) {
    const br = /(?<![a-zA-Z0-9])(\d{3})(?!\d)/.exec(t)
    if (br) slots.room = br[1]
  }
}

/** 同名多栋(如两栋『文体中心』)无法靠名字消歧,视作同一目的地取第一栋 */
export function dedupeSameName(cands: BakedBuilding[]): BakedBuilding[] {
  return cands.length > 1 && new Set(cands.map((b) => b.name)).size === 1 ? [cands[0]] : cands
}

/** 从 X 到 Y 的路径槽位:building/buildingId = 起点,target/targetId = 终点 */
function extractRoute(t: string, buildings: BakedBuilding[], slots: Slots): void {
  const m =
    /从\s*([^,，。.?？!！]+?)\s*(?:到|去)\s*([^,，。.?？!！]+?)\s*(?:怎么走|怎么去|咋走|多远|怎么走法|呢|$)/.exec(t)
    ?? /([^,，。.?？!！]+?)\s*(?:到|去)\s*([^,，。.?？!！]+?)\s*(?:怎么走|怎么去|咋走|多远)/.exec(t)
  if (m) {
    const [, fromRaw, toRaw] = m
    if (!/(我|这里|当前|现在位置)/.test(fromRaw)) {
      const from = dedupeSameName(matchBuildings(fromRaw, buildings))
      if (from.length === 1) { slots.building = from[0].name ?? fromRaw; slots.buildingId = from[0].id }
      else if (from.length > 1) {
        // 歧义起点:只记说法,清掉 name 匹配可能留下的 buildingId,保持槽位一致
        slots.building = fromRaw.trim()
        delete slots.buildingId
      }
    }
    const to = dedupeSameName(matchBuildings(toRaw, buildings))
    if (to.length === 1) { slots.target = to[0].name ?? toRaw; slots.targetId = to[0].id }
    else if (to.length > 1) { slots.target = toRaw.trim(); delete slots.targetId }
    else if (!slots.target) slots.target = toRaw.trim()
    return
  }
  // 单目的地口语:『图书馆怎么走』『去文体中心怎么走』『游泳馆多远』
  const solo = /^(?:我想|我要|请问|帮我)?\s*(?:去|到)?\s*([^,，。.?？!！]{2,12}?)\s*(?:怎么走|怎么去|咋走|多远)$/.exec(t)
  if (!solo) return
  const to = dedupeSameName(matchBuildings(solo[1], buildings))
  if (to.length === 1) { slots.target = to[0].name ?? solo[1]; slots.targetId = to[0].id }
  else slots.target = solo[1].trim()
}

// ---------------------------------------------------------------------------
// 意图规则表(自上而下,先命中先赢)
// ---------------------------------------------------------------------------
interface Rule {
  name: IntentName
  agent: AgentName
  test: (t: string, slots: Slots) => boolean
}

const RULES: Rule[] = [
  {
    name: 'emergency_drill', agent: '仿真Agent',
    test: (t) => /(消防|应急|疏散|逃生|急救)|演练/.test(t),
  },
  {
    name: 'repair', agent: '报修Agent',
    test: (t) => /(报修|维修|修一下|修理|故障|坏了|漏水|漏电|不亮|不制冷|不制热|失灵|跳闸)/.test(t),
  },
  {
    // 画质调节:『把画质调到最高』『流畅一点,画质低点』
    name: 'set_quality', agent: '场景导演Agent',
    test: (t) => /(画质|清晰度|分辨率|流畅度)/.test(t),
  },
  {
    // 场景词 + 场景语境;或短句直接说场景(『下雨吧』)
    // 守卫:句中若含订房/报修动作词,场景词(如『晚上』)只是时间状语,不当场景指令
    name: 'scene_director', agent: '场景导演Agent',
    test: (t, s) =>
      !!s.scene &&
      !/(预约|预订|预定|订|报修|维修)/.test(t) &&
      (/(场景|模式|切换|换成|变成|调成|调到|效果|看看|看下|看一下|模样|样子)/.test(t) || t.length <= 10),
  },
  {
    name: 'navigate', agent: '导航Agent',
    test: (t, s) => /(怎么走|怎么去|咋走|导航|路线|多远)/.test(t) || !!s.target,
  },
  {
    name: 'book_room', agent: '预约Agent',
    test: (t) =>
      /(预约|预订|预定|订|借用|借)[^,。]*(会议室|教室|房间|报告厅|场地|研讨室)/.test(t) ||
      /(会议室|教室|报告厅|研讨室)[^,。]*(预约|预订|预定|订)/.test(t) ||
      /(找|申请|租|有)[^,。]*(会议室|研讨室|报告厅|房间)/.test(t),
  },
  {
    name: 'find_free_classroom', agent: '预约Agent',
    test: (t) => /(空教室|自习室|自习|找[^,。]*教室|哪里有[^,。]*教室|教室[^,。]*(空|闲))/.test(t),
  },
  {
    name: 'canteen_crowd', agent: '仿真Agent',
    test: (t) => /(食堂|餐厅|吃饭|就餐|干饭|排队)/.test(t),
  },
  {
    name: 'library_seat', agent: '仿真Agent',
    test: (t) => /(图书馆[^,。]*(座|位|空位)|座位|占座|空位)/.test(t),
  },
  {
    name: 'event_info', agent: '仿真Agent',
    test: (t) => /(活动|演出|讲座|晚会|日程|event)/i.test(t),
  },
  {
    name: 'admin_overview', agent: '态势Agent',
    test: (t) => /(态势|概览|总览|概况|占用率|能耗|大屏|指挥中心|运行情况|运行状况|全校|整体情况)/.test(t),
  },
  {
    // 巡礼控制指令(上一站/下一站/暂停/继续),需在 campus_tour 之前拦截
    // 注意:规则匹配发生在中文数字规整之后,『一』已被改写为『1』(『暂停一下』→『暂停1下』)
    name: 'tour_control', agent: '导游Agent',
    test: (t) => /^(上|下)1站$/.test(t) || /^(继续讲解|继续巡礼|暂停|暂停1?下)$/.test(t),
  },
  {
    name: 'campus_tour', agent: '导游Agent',
    // 注意:规则匹配在中文数字规整之后,『逛一逛/转一转/走一走』已成『逛1逛/转1转/走1走』
    test: (t) =>
      /(参观|游览|逛|巡礼|导游|看看校园|转.?转|走.?走)/.test(t) ||
      (/校训/.test(t) && !/是什么/.test(t)),
  },
  {
    name: 'ask_knowledge', agent: '导游Agent',
    test: (t) => /(是什么|为什么|介绍|历史|由来|故事|是谁|哪一年)/.test(t),
  },
]

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------
export function parseIntent(rawText: string, buildings: BakedBuilding[]): Intent {
  const text = rawText.trim()
  const t = normalizeCnDigits(text)
  const slots: Slots = {}

  extractScene(t, slots)
  extractCapacity(t, slots)
  extractEquipment(t, slots)
  extractQuality(t, slots)
  extractTime(t, slots)
  extractRoomAndBuilding(t, buildings, slots)
  extractRoute(t, buildings, slots)

  const rule = RULES.find((r) => r.test(t, slots))
  const intent: IntentName = rule?.name ?? 'unknown'
  const agent: AgentName = rule?.agent ?? '调度Agent'

  let confidence = 0.15
  if (rule) {
    confidence = 0.65
    if (slots.capacity != null || slots.equipment?.length || slots.time) confidence += 0.1
    if (slots.buildingId || slots.targetId) confidence += 0.1
    else if (slots.building || slots.target) confidence += 0.03
    if (slots.room) confidence += 0.05
    if ((slots.building && !slots.buildingId) || (slots.target && !slots.targetId)) confidence -= 0.15
    confidence = Math.min(0.95, Math.max(0.3, confidence))
  }

  return { intent, slots, agent, confidence: Number(confidence.toFixed(2)), rawText: text }
}

// ---------------------------------------------------------------------------
// 12 意图命中例句(每种 ≥2 条,人工回归用)
// ---------------------------------------------------------------------------
// book_room:
//   1. 帮我订一间能坐20人的会议室
//   2. 预约一下明天下午3点的教室,要有投影
// find_free_classroom:
//   1. 下午想找个空教室自习
//   2. 哪里有能坐60个人的空教室
// repair:
//   1. C302的空调坏了,帮我报修
//   2. 302房间投影不亮,麻烦修一下
// navigate:
//   1. 从图书馆到文体中心怎么走
//   2. 综合大楼到游泳馆多远
// admin_overview:
//   1. 看一下全校楼宇占用态势
//   2. 今天校园能耗概览怎么样
// campus_tour:
//   1. 带新生参观一下校园
//   2. 来一段校训巡礼
// ask_knowledge:
//   1. 墨湖的故事是什么
//   2. 介绍一下章乃器铜像的由来
// scene_director:
//   1. 切换到夜晚场景
//   2. 看看秋天下雨的校园
// canteen_crowd:
//   1. 现在食堂人多吗
//   2. 流水苑食堂排队要多久
// library_seat:
//   1. 图书馆还有座位吗
//   2. 帮我看看图书馆的空位
// emergency_drill:
//   1. 在C教学楼发起消防疏散演练
//   2. 组织一次应急逃生演练
// event_info:
//   1. 今天学校有什么活动
//   2. 最近有什么讲座或演出
