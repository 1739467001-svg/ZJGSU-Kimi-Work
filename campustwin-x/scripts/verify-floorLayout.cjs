// 一次性验收脚本:floorLayout 楼层布局引擎全量回归
// 用法:node scripts/verify-floorLayout.cjs
// 原理:先用 tsc 把 floorLayout 编译成 CJS(同 verify-parseIntent 的做法),
// 再对 rooms.json 全部 21 栋楼 × 全部楼层跑 computeFloorLayout 并断言:
//   ① 每个 cell 在 bounds 内(1cm 误差)
//   ② 任意两 cell 不重叠(1cm 误差)
//   ③ 每个 cell 与 corridor 至少一边相邻(门能开向走廊)
//   ④ 每个房间都有 cell(不丢房间)
// 附加:门在单元格边上、楼电梯核在 bounds 内、确定性(两次调用结果一致)
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'verify-floorLayout')
const EPS = 0.01 // 1cm 容差

function ensureBuild() {
  fs.rmSync(OUT, { recursive: true, force: true })
  execSync(
    `npx tsc src/lib/floorLayout.ts --ignoreConfig --outDir "${OUT}" ` +
      `--module commonjs --target es2020 --moduleResolution node --ignoreDeprecations 6.0 --esModuleInterop --skipLibCheck`,
    { cwd: ROOT, stdio: 'inherit' },
  )
}

ensureBuild()
const { computeFloorLayout } = require(path.join(OUT, 'floorLayout.js'))

const buildings = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/campus/buildings.json'), 'utf8'),
).buildings
const roomsRaw = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/sim/rooms.json'), 'utf8'),
).rooms

const buildingById = new Map(buildings.map((b) => [b.id, b]))
const roomsByBuilding = new Map()
for (const r of roomsRaw) {
  if (!roomsByBuilding.has(r.buildingId)) roomsByBuilding.set(r.buildingId, [])
  roomsByBuilding.get(r.buildingId).push(r)
}

const left = (c) => c.x - c.w / 2
const right = (c) => c.x + c.w / 2
const top = (c) => c.z - c.d / 2
const bottom = (c) => c.z + c.d / 2
const overlap1d = (a1, a2, b1, b2) => Math.min(a2, b2) - Math.max(a1, b1)

function checkFloor(building, rooms, floor) {
  const layout = computeFloorLayout(building, rooms, floor)
  const layout2 = computeFloorLayout(building, rooms, floor)
  const errs = []
  const { bounds, cells, corridor, cores } = layout
  const floorRooms = rooms.filter((r) => r.floor === floor)

  // ④ 不丢房间
  const ids = new Set(cells.map((c) => c.roomId))
  for (const r of floorRooms) {
    if (!ids.has(r.id)) errs.push(`房间缺失: ${r.name}(${r.id})`)
  }
  if (cells.length !== floorRooms.length) {
    errs.push(`cell 数 ${cells.length} ≠ 房间数 ${floorRooms.length}`)
  }

  for (const c of cells) {
    // ① cell 在 bounds 内
    if (
      left(c) < bounds.minX - EPS ||
      right(c) > bounds.maxX + EPS ||
      top(c) < bounds.minZ - EPS ||
      bottom(c) > bounds.maxZ + EPS
    ) {
      errs.push(`cell 越界: ${c.roomId} [${left(c).toFixed(2)},${right(c).toFixed(2)}]x[${top(c).toFixed(2)},${bottom(c).toFixed(2)}]`)
    }
    // 门在单元格边界上
    const onEdge =
      Math.abs(c.door.x - left(c)) < EPS ||
      Math.abs(c.door.x - right(c)) < EPS ||
      Math.abs(c.door.z - top(c)) < EPS ||
      Math.abs(c.door.z - bottom(c)) < EPS
    const inside =
      c.door.x >= left(c) - EPS && c.door.x <= right(c) + EPS &&
      c.door.z >= top(c) - EPS && c.door.z <= bottom(c) + EPS
    if (!onEdge || !inside) errs.push(`门不在 cell 边上: ${c.roomId}`)

    // ③ cell 与 corridor 至少一边相邻(共享一条有长度的边)
    const adjacent = corridor.some((k) => {
      const xOv = overlap1d(left(c), right(c), left(k), right(k))
      const zOv = overlap1d(top(c), bottom(c), top(k), bottom(k))
      const xTouch =
        (Math.abs(right(c) - left(k)) < EPS || Math.abs(left(c) - right(k)) < EPS) && zOv > 0.05
      const zTouch =
        (Math.abs(bottom(c) - top(k)) < EPS || Math.abs(top(c) - bottom(k)) < EPS) && xOv > 0.05
      return xTouch || zTouch
    })
    if (!adjacent) errs.push(`cell 不与走廊相邻: ${c.roomId}`)
  }

  // ② 两两不重叠
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      const ox = overlap1d(left(cells[i]), right(cells[i]), left(cells[j]), right(cells[j]))
      const oz = overlap1d(top(cells[i]), bottom(cells[i]), top(cells[j]), bottom(cells[j]))
      if (ox > EPS && oz > EPS) {
        errs.push(`cell 重叠: ${cells[i].roomId} × ${cells[j].roomId} (${ox.toFixed(2)}m × ${oz.toFixed(2)}m)`)
      }
    }
  }

  // 交通核在 bounds 内
  for (const c of cores) {
    if (
      c.x < bounds.minX - EPS || c.x > bounds.maxX + EPS ||
      c.z < bounds.minZ - EPS || c.z > bounds.maxZ + EPS
    ) {
      errs.push(`交通核越界: (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`)
    }
  }

  // 确定性:同输入恒同输出
  if (JSON.stringify(layout) !== JSON.stringify(layout2)) errs.push('非确定性:两次结果不一致')

  return { layout, errs }
}

let totalFloors = 0
let totalCells = 0
let passFloors = 0
const failures = []

for (const [buildingId, rooms] of [...roomsByBuilding.entries()].sort()) {
  const b = buildingById.get(buildingId)
  if (!b) {
    failures.push(`${buildingId}: buildings.json 中不存在`)
    continue
  }
  const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b)
  let bCells = 0
  let bErr = 0
  for (const f of floors) {
    const { layout, errs } = checkFloor(b, rooms, f)
    totalFloors++
    totalCells += layout.cells.length
    bCells += layout.cells.length
    if (errs.length === 0) {
      passFloors++
    } else {
      bErr += errs.length
      failures.push(`${b.name ?? buildingId} F${f}: ${errs.join(' | ')}`)
    }
  }
  const mark = bErr === 0 ? 'PASS' : 'FAIL'
  console.log(
    `${mark} | ${(b.name ?? buildingId).padEnd(8)} | 楼层 ${floors.length} | cells ${bCells} | 模式 ${bErr === 0 ? '' : ''}` +
      `${(() => { const l = checkFloor(b, rooms, floors[0]).layout; return l.corridor.length > 1 ? '周边式' : '一字走廊' })()}`,
  )
}

console.log('\n' + '='.repeat(60))
if (failures.length > 0) {
  console.log('失败明细:')
  for (const f of failures) console.log('  ' + f)
}
console.log(
  `${failures.length === 0 ? 'PASS' : 'FAIL'} 汇总: ${passFloors}/${totalFloors} 楼层通过, ${totalCells} 个房间单元格, ${roomsByBuilding.size} 栋楼`,
)
process.exit(failures.length === 0 ? 0 : 1)
