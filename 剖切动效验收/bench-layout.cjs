// 诊断①:computeFloorLayout 逐楼逐层耗时测量(Node 微基准,量化点击瞬间同步重活)
// 原理同 scripts/verify-floorLayout.cjs:tsc 编译 floorLayout 为 CJS 后逐楼计时
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', 'campustwin-x')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'bench-layout')

fs.rmSync(OUT, { recursive: true, force: true })
execSync(
  `npx tsc src/lib/floorLayout.ts --ignoreConfig --outDir "${OUT}" ` +
    `--module commonjs --target es2020 --moduleResolution node --ignoreDeprecations 6.0 --esModuleInterop --skipLibCheck`,
  { cwd: ROOT, stdio: 'inherit' },
)
const { computeFloorLayout } = require(path.join(OUT, 'floorLayout.js'))

const buildings = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/campus/buildings.json'), 'utf8'),
).buildings
const roomsRaw = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/data/sim/rooms.json'), 'utf8'),
).rooms
const roomsByBuilding = new Map()
for (const r of roomsRaw) {
  if (!roomsByBuilding.has(r.buildingId)) roomsByBuilding.set(r.buildingId, [])
  roomsByBuilding.get(r.buildingId).push(r)
}

const rows = []
for (const b of buildings) {
  const rooms = roomsByBuilding.get(b.id) ?? []
  if (b.levels < 2) continue
  // 预热 1 次再计时,取 3 次中位数
  for (let f = 1; f <= b.levels; f++) computeFloorLayout(b, rooms, f)
  const samples = []
  for (let k = 0; k < 3; k++) {
    const t0 = performance.now()
    for (let f = 1; f <= b.levels; f++) computeFloorLayout(b, rooms, f)
    samples.push(performance.now() - t0)
  }
  samples.sort((a, b2) => a - b2)
  rows.push({
    id: b.id,
    name: b.name ?? b.id,
    levels: b.levels,
    rooms: rooms.length,
    verts: b.footprint.length,
    ms: samples[1],
  })
}
rows.sort((a, b) => b.ms - a.ms)
console.log('楼(全层一次性 computeFloorLayout 耗时,中位数):')
for (const r of rows) {
  console.log(
    `  ${r.name.padEnd(12)} ${String(r.levels).padStart(2)}层 ${String(r.rooms).padStart(3)}房间 ${String(r.verts).padStart(2)}顶点  ${r.ms.toFixed(1)}ms`,
  )
}
