#!/usr/bin/env node
// gen-simulation.mjs —— 生成校园生命体仿真种子数据
// 输入: public/data/campus/buildings.json
// 输出(覆盖): public/data/sim/{rooms,canteen,library,events}.json
//   rooms.json 保留已有 12 个样例房间,追加生成房间(按 id / buildingId+name 去重)
// 种子固定(mulberry32(20250520)),重复运行结果一致。
// 运行: node tools/etl/gen-simulation.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CAMPUS_DIR = join(ROOT, 'public', 'data', 'campus')
const OUT_DIR = join(ROOT, 'public', 'data', 'sim')

// ---------- 可复现随机 ----------
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(20250520)
const ri = (a, b) => a + Math.floor(rand() * (b - a + 1)) // 含端点整数
const pick = (arr) => arr[Math.floor(rand() * arr.length)]
const chance = (p) => rand() < p
const round2 = (v) => Math.round(v * 100) / 100

// ---------- 作息锚点(与 src/sim/schedule.ts 严格一致) ----------
const CLASS_SLOTS = [
  ['0800', '0935'], ['0955', '1130'], ['1310', '1445'], ['1505', '1640'], ['1800', '2035'],
]

const COURSES = [
  '高等数学A', '线性代数', '概率论与数理统计', '大学英语', '大学物理', '数据结构',
  '计算机组成原理', '操作系统', '微观经济学', '宏观经济学', '管理学原理', '财务会计',
  '统计学', '市场营销学', '民法总论', '马克思主义基本原理', '日语精读', '英语视听说',
  '信号与系统', '数字电路', '食品化学', '环境监测', '现代汉语', '设计基础',
]
const LAB_COURSES = ['嵌入式实验', '网络攻防实验', '软件工程实验', '电子线路实验', '数据处理实验']
const MEETINGS = [
  '校长办公室', '教务处', '研究生院', '国际交流处', '学工部', '后勤保障处',
  '学院党政联席会', '学科建设研讨会', '人才引进评审会', '就业工作推进会',
]

// 学院楼简称 → 房间 id 前缀(样例风格:信电楼 → xd)
const COLLEGE_CODE = {
  信电楼: 'xd', 信息楼: 'xx', 经济楼: 'jj', 管理楼: 'gl', 外语楼: 'wy',
  东语楼: 'dy', 艺术楼: 'ys', 食品楼: 'sp', 环境楼: 'hj', 文科实验楼: 'wk',
  网络信息中心: 'wl',
}

// ---------- 读入 ----------
const buildings = JSON.parse(readFileSync(join(CAMPUS_DIR, 'buildings.json'), 'utf8')).buildings
const byId = new Map(buildings.map((b) => [b.id, b]))

const existingPath = join(OUT_DIR, 'rooms.json')
const existing = JSON.parse(readFileSync(existingPath, 'utf8'))
const sampleRooms = existing.rooms ?? []
const seenIds = new Set(sampleRooms.map((r) => r.id))
const seenNames = new Set(sampleRooms.map((r) => `${r.buildingId}|${r.name}`))

/** 楼体局部偏移(相对楼心,用于 3D 浮出标记) */
function positionHint(b, floor) {
  const xs = b.footprint.map((p) => p[0])
  const zs = b.footprint.map((p) => p[1])
  const w = Math.max(...xs) - Math.min(...xs)
  const d = Math.max(...zs) - Math.min(...zs)
  const floorH = b.levels > 0 ? b.height / b.levels : 3.6
  return [
    round2((rand() - 0.5) * 0.6 * w),
    round2((floor - 0.5) * floorH),
    round2((rand() - 0.5) * 0.6 * d),
  ]
}

function makeSchedule(byPool, fillRate) {
  const s = []
  for (const [start, end] of CLASS_SLOTS) {
    if (chance(fillRate)) s.push({ start, end, by: pick(byPool) })
  }
  return s
}

function equipmentFor(type) {
  if (type === 'meeting') {
    const eq = ['projector', 'ac', 'mic']
    if (chance(0.5)) eq.push('screen')
    return eq
  }
  if (type === 'lab') {
    const eq = ['ac', 'screen']
    if (chance(0.5)) eq.push('projector')
    return eq
  }
  if (type === 'venue') return ['mic', 'screen', 'light']
  const eq = ['projector', 'ac'] // classroom
  if (chance(0.4)) eq.push('mic')
  if (chance(0.3)) eq.push('screen')
  return eq
}

const generated = []
function addRoom(room) {
  if (seenIds.has(room.id) || seenNames.has(`${room.buildingId}|${room.name}`)) return false
  seenIds.add(room.id)
  seenNames.add(`${room.buildingId}|${room.name}`)
  generated.push(room)
  return true
}

// ---------- 房间生成 ----------
for (const b of buildings) {
  const feature = b.feature ?? 'unknown'
  const name = b.name ?? ''
  const levels = b.levels || 1

  if (feature === 'teaching') {
    // 教学楼每层 8 间 × 层数;编号:楼名首字母 + 楼层 + 两位序号(C302)
    const letter = name.charAt(0).toUpperCase()
    for (let f = 1; f <= levels; f++) {
      for (let i = 1; i <= 8; i++) {
        const nn = String(i).padStart(2, '0')
        addRoom({
          id: `r_${letter.toLowerCase()}${f}${nn}`,
          buildingId: b.id,
          name: `${letter}${f}${nn}`,
          floor: f,
          type: 'classroom',
          capacity: pick([40, 45, 50, 60, 80, 100, 120]),
          equipment: equipmentFor('classroom'),
          status: 'free',
          schedule: makeSchedule(COURSES, 0.65),
          positionHint: positionHint(b, f),
        })
      }
    }
  } else if (feature === 'college') {
    // 学院楼每层 4 间教学/研讨室;信电楼/信息楼每层另加 2 个实验室
    const code = COLLEGE_CODE[name] ?? b.id
    const hasLab = name === '信电楼' || name === '信息楼'
    for (let f = 1; f <= levels; f++) {
      for (let i = 1; i <= 4; i++) {
        const nn = String(i).padStart(2, '0')
        addRoom({
          id: `r_${code}${f}${nn}`,
          buildingId: b.id,
          name: `${name}${f}${nn}`,
          floor: f,
          type: 'classroom',
          capacity: pick([30, 40, 50, 60]),
          equipment: equipmentFor('classroom'),
          status: 'free',
          schedule: makeSchedule(COURSES, 0.65),
          positionHint: positionHint(b, f),
        })
      }
      if (hasLab) {
        for (let i = 1; i <= 2; i++) {
          const nn = String(i).padStart(2, '0')
          addRoom({
            id: `r_${code}${f}lab${nn}`,
            buildingId: b.id,
            name: `${name}${f}${nn}实验室`,
            floor: f,
            type: 'lab',
            capacity: pick([30, 40, 50]),
            equipment: equipmentFor('lab'),
            status: 'free',
            schedule: makeSchedule(LAB_COURSES, 0.65),
            positionHint: positionHint(b, f),
          })
        }
      }
    }
  } else if (feature === 'admin' && name === '综合大楼') {
    // 综合大楼 9/12 楼会议室(含真实「九楼第一会议室」,由样例保留)
    const rooms = [
      { id: 'r_zh_901', name: '九楼第一会议室', floor: 9, capacity: 16 },
      { id: 'r_zh_902', name: '九楼第二会议室', floor: 9, capacity: 12 },
      { id: 'r_zh_903', name: '九楼第三会议室', floor: 9, capacity: 10 },
      { id: 'r_zh_904', name: '九楼第四会议室', floor: 9, capacity: 20 },
      { id: 'r_zh_1201', name: '十二楼会议室', floor: 12, capacity: 30 },
      { id: 'r_zh_1202', name: '十二楼第二会议室', floor: 12, capacity: 12 },
    ]
    for (const r of rooms) {
      addRoom({
        ...r,
        buildingId: b.id,
        type: 'meeting',
        equipment: equipmentFor('meeting'),
        status: 'free',
        schedule: makeSchedule(MEETINGS, 0.65),
        positionHint: positionHint(b, r.floor),
      })
    }
  } else if (feature === 'venue' && name === '国际会议中心') {
    // 6 个 8–30 人会议室(样例 101/205 保留,此处生成另外 6 个)
    const rooms = [
      { id: 'r_micc_101', name: '国际会议中心101', floor: 1, capacity: 20 },
      { id: 'r_micc_102', name: '国际会议中心102', floor: 1, capacity: 12 },
      { id: 'r_micc_103', name: '国际会议中心103', floor: 1, capacity: 16 },
      { id: 'r_micc_201', name: '国际会议中心201', floor: 2, capacity: 24 },
      { id: 'r_micc_202', name: '国际会议中心202', floor: 2, capacity: 8 },
      { id: 'r_micc_203', name: '国际会议中心203', floor: 2, capacity: 30 },
      { id: 'r_micc_205', name: '国际会议中心205', floor: 2, capacity: 8 },
      { id: 'r_micc_301', name: '国际会议中心301', floor: 3, capacity: 14 },
    ]
    for (const r of rooms) {
      addRoom({
        ...r,
        buildingId: b.id,
        type: 'meeting',
        equipment: equipmentFor('meeting'),
        status: 'free',
        schedule: makeSchedule(MEETINGS, 0.65),
        positionHint: positionHint(b, r.floor),
      })
    }
  } else if (feature === 'venue' && name === '学生活动中心') {
    // 1 个 832 座 venue(样例 r_sa_hall 已承载,重复则去重跳过)
    addRoom({
      id: 'r_sa_hall',
      buildingId: b.id,
      name: '剧院报告厅',
      floor: 1,
      type: 'venue',
      capacity: 832,
      equipment: equipmentFor('venue'),
      status: 'free',
      schedule: makeSchedule(['艺术团排练', '新年音乐会彩排', '话剧社演出', '讲座'], 0.65),
      positionHint: positionHint(b, 1),
    })
  } else if (feature === 'library') {
    // 图书馆每层 1 个阅览室(占座仿真见 library.json)
    for (let f = 1; f <= levels; f++) {
      addRoom({
        id: `r_lib_${f}01`,
        buildingId: b.id,
        name: `图书馆${f}层阅览室`,
        floor: f,
        type: 'classroom',
        capacity: 240,
        equipment: ['ac', 'light'],
        status: 'free',
        schedule: [],
        positionHint: positionHint(b, f),
      })
    }
  }
}

const allRooms = [...sampleRooms, ...generated]

// ---------- 食堂容量 ----------
// 注:行云苑在 buildings.json 中为钱江湾未命名「食堂」way,映射至西侧一栋(w563779372)
const canteen = {
  comment: '仿真数据:食堂基础容量(座位数)。placeId 与 simStore.canteenCrowd 对齐。',
  canteens: [
    { placeId: 'xingyun', buildingId: 'w563779372', name: '行云苑食堂', seats: 2200, floors: 3, note: '二楼梅花餐厅' },
    { placeId: 'liushui', buildingId: 'w545969362', name: '流水苑食堂', seats: 1800, floors: 3, note: '含麦当劳' },
    { placeId: 'qingfeng', buildingId: 'w563544653', name: '清风苑食堂', seats: 900, floors: 2 },
    { placeId: 'mingyue', buildingId: 'w563544712', name: '明月苑食堂', seats: 700, floors: 2 },
  ].filter((c) => byId.has(c.buildingId)),
}

// ---------- 图书馆座位(8 层 × 500 = 4000 自习座) ----------
const library = {
  comment: '仿真数据:图书馆自习座位,按楼层分布。',
  buildingId: 'w563533987',
  name: '图书馆',
  floors: Array.from({ length: 8 }, (_, i) => ({ floor: i + 1, seats: 500 })),
}

// ---------- 今日场馆事件(文体中心/剧院/国际会议中心,5–8 场) ----------
const today = new Date()
const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
const events = {
  comment: `仿真数据:今日(${dateStr})场馆事件,时间 HHmm。venueId 为房间 id 或楼宇 id。`,
  events: [
    { id: 'ev_01', venueId: 'w1018218617', title: '校级手球邀请赛(亚运手球馆)', start: '0900', end: '1130', crowd: 1200 },
    { id: 'ev_02', venueId: 'w1018218617', title: '教职工羽毛球公开赛', start: '1400', end: '1700', crowd: 300 },
    { id: 'ev_03', venueId: 'w563515430', title: '篮球联赛小组赛(风雨操场)', start: '1800', end: '2030', crowd: 500 },
    { id: 'ev_04', venueId: 'r_sa_hall', title: '大学生艺术团新年音乐会', start: '1830', end: '2035', crowd: 832 },
    { id: 'ev_05', venueId: 'r_micc_201', title: '钱塘国际学术讲座', start: '1400', end: '1600', crowd: 24 },
    { id: 'ev_06', venueId: 'r_micc_301', title: '留学生文化交流沙龙', start: '1000', end: '1130', crowd: 14 },
    { id: 'ev_07', venueId: 'r_micc_103', title: '校企合作洽谈会', start: '1500', end: '1700', crowd: 16 },
  ],
}

// ---------- 写出 ----------
mkdirSync(OUT_DIR, { recursive: true })
const write = (file, data) => {
  writeFileSync(join(OUT_DIR, file), JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`✔ ${file}`)
}
write('rooms.json', {
  comment: '仿真房间数据(gen-simulation.mjs 生成,保留 12 个样例房间)。时段:HHmm。',
  rooms: allRooms,
})
write('canteen.json', canteen)
write('library.json', library)
write('events.json', events)

const typeCount = {}
for (const r of allRooms) typeCount[r.type] = (typeCount[r.type] ?? 0) + 1
console.log(`rooms: 共 ${allRooms.length}(样例 ${sampleRooms.length} + 新生成 ${generated.length})`, typeCount)
console.log(`canteens: ${canteen.canteens.length}, library floors: ${library.floors.length}, events: ${events.events.length}`)
