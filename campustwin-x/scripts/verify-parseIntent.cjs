// 一次性验收脚本:parseIntent 真实语料回归
// 用法:node scripts/verify-parseIntent.cjs
// 原理:先用 tsc 把 parseIntent 依赖链编译成 CJS(见下方 ensureBuild),再逐句解析比对预期意图。
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'verify-parseIntent')

function ensureBuild() {
  fs.rmSync(OUT, { recursive: true, force: true })
  execSync(
    `npx tsc src/agent/parseIntent.ts src/lib/rooms.ts --ignoreConfig --outDir "${OUT}" ` +
      `--module commonjs --target es2020 --moduleResolution node --ignoreDeprecations 6.0 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: 'inherit' },
  )
}

const buildings = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/campus/buildings.json'), 'utf8'),
).buildings

// [输入句, 预期意图, 预期槽位检查(可选)]
const CASES = [
  // ① 找会议室链路
  ['帮我找间空会议室', 'book_room'],
  ['帮我找一个明天下午能容纳 10 人的会议室', 'book_room', (s) => s.capacity === 10 && !!s.start],
  ['帮我订一间能坐20人的会议室', 'book_room', (s) => s.capacity === 20],
  ['预约一下明天下午3点的教室,要有投影', 'book_room', (s) => s.start === '1500' && s.equipment?.includes('projector')],
  ['想借一间有麦克风的研讨室', 'book_room', (s) => s.equipment?.includes('mic')],
  ['国际会议中心有空会议室吗', 'book_room', (s) => s.building === '国际会议中心'],
  // 空教室
  ['下午想找个空教室自习', 'find_free_classroom'],
  ['哪里有能坐60个人的空教室', 'find_free_classroom', (s) => s.capacity === 60],
  // ② 报修链路
  ['我要报修', 'repair'],
  ['我要报修:C302 的投影仪坏了', 'repair', (s) => s.room === 'C302' && s.building === 'C教学楼' && s.equipment?.includes('projector')],
  ['C302的空调坏了,帮我报修', 'repair', (s) => s.room === 'C302' && s.equipment?.includes('ac')],
  ['302房间投影不亮,麻烦修一下', 'repair', (s) => s.room === '302'],
  ['我要报修:综合大楼 A301 的投影仪坏了', 'repair', (s) => s.building === '综合大楼' && s.room === 'A301'],
  ['信电楼401实验室的空调不制冷', 'repair', (s) => s.building === '信电楼' && s.equipment?.includes('ac')],
  // ③ 校园态势链路
  ['看看现在校园态势', 'admin_overview'],
  ['看一下当前校园运行态势', 'admin_overview'],
  ['给我看看校园概览', 'admin_overview'],
  ['今天校园能耗怎么样', 'admin_overview'],
  ['全校楼宇占用率情况', 'admin_overview'],
  // ④ 逛校园链路
  ['带我逛校园', 'campus_tour'],
  ['带我逛逛商大', 'campus_tour'],
  ['带新生参观一下校园', 'campus_tour'],
  ['来一段校训巡礼', 'campus_tour'],
  ['下一站', 'tour_control'],
  ['上一站', 'tour_control'],
  ['暂停一下', 'tour_control'],
  ['继续巡礼', 'tour_control'],
  // 场景导演:天气/昼夜/季节
  ['切换到夜晚场景', 'scene_director', (s) => s.scene === 'night'],
  ['看看秋天下雨的校园', 'scene_director', (s) => s.scene === 'rain'],
  ['下雨吧', 'scene_director', (s) => s.scene === 'rain'],
  ['我想看看下雪的样子', 'scene_director', (s) => s.scene === 'snow'],
  ['切成黄昏模式', 'scene_director', (s) => s.scene === 'dusk'],
  // 画质
  ['把画质调到最高', 'set_quality', (s) => s.quality === 'high'],
  ['画质调低一点,要流畅', 'set_quality', (s) => s.quality === 'low'],
  ['中等画质就行', 'set_quality', (s) => s.quality === 'medium'],
  // 导航
  ['从图书馆到文体中心怎么走', 'navigate', (s) => s.building === '图书馆' && !!s.targetId],
  ['综合大楼到游泳馆多远', 'navigate', (s) => s.target === '游泳馆'],
  ['去图书馆怎么走', 'navigate', (s) => s.target === '图书馆'],
  ['从三号楼到图书馆怎么走', 'navigate', (s) => !!s.building && !s.buildingId], // 歧义 → clarify
  // 仿真类
  ['现在食堂人多吗', 'canteen_crowd'],
  ['图书馆还有座位吗', 'library_seat'],
  ['今天学校有什么活动', 'event_info'],
  ['在C教学楼发起消防疏散演练', 'emergency_drill', (s) => s.building === 'C教学楼'],
  // 知识问答
  ['墨湖的故事是什么', 'ask_knowledge'],
  ['介绍一下章乃器铜像的由来', 'ask_knowledge'],
  // 守卫:场景词不得劫持订房
  ['订个明天晚上的会议室', 'book_room'],
  // 错别字/口语容错(现有能力边界)
  ['帮我找个会仪室', 'unknown'], // 错别字『会仪室』目前不容错,记录在案
]

ensureBuild()
const { parseIntent } = require(path.join(OUT, 'agent', 'parseIntent.js'))

let pass = 0
const rows = []
for (const [text, expected, slotCheck] of CASES) {
  const r = parseIntent(text, buildings)
  const slotOk = slotCheck ? !!slotCheck(r.slots) : true
  const ok = r.intent === expected && slotOk
  if (ok) pass++
  rows.push({ text, expected, actual: r.intent, slotOk, ok, slots: r.slots, conf: r.confidence })
}

for (const r of rows) {
  const mark = r.ok ? 'PASS' : 'FAIL'
  const slotBrief = JSON.stringify(r.slots)
  console.log(`${mark} | ${r.text} | 预期=${r.expected} 实际=${r.actual}${r.slotOk ? '' : ' 槽位不符'} | conf=${r.conf} | ${slotBrief}`)
}
console.log(`\n${pass}/${rows.length} 通过`)
process.exit(pass === rows.length ? 0 : 1)
