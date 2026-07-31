// M0-D3/D4 高度估算 + 烘焙运行时产物
// 输入: out/campus-geo.json, campus-redline.geojson, landmarks.json
// 输出: public/data/campus/{buildings,roads,water,green,trees,landmarks}.json(局部米制坐标)
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dir, '../../public/data/campus')
const geo = JSON.parse(await readFile(join(__dir, 'out/campus-geo.json'), 'utf8'))
const landmarksRaw = JSON.parse(await readFile(join(__dir, 'landmarks.json'), 'utf8'))

// ---------- 坐标系:以 OSM 综合大楼质心为原点(WGS-84 自洽;高德锚点仅作外部校验) ----------
const ORIGIN = { lng: 120.383573, lat: 30.311163 }
const M_LAT = 110540
const M_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
const toLocal = (lng, lat) => [+((lng - ORIGIN.lng) * M_LNG).toFixed(2), +(-(lat - ORIGIN.lat) * M_LAT).toFixed(2)]

// ---------- 高度估算引擎 ----------
const FLOOR_H = { teaching: 3.6, college: 3.6, library: 4.2, admin: 3.6, venue: 6.0, sport: 8.0, dorm: 3.0, canteen: 4.5, service: 3.0, unknown: 3.2 }
const DEFAULT_LEVELS = { teaching: 5, college: 5, library: 8, admin: 12, venue: 2, sport: 2, dorm: 6, canteen: 3, service: 1, unknown: 4 }
const estHeight = (b) => b.heightM ?? ((b.levels ?? DEFAULT_LEVELS[b.feature] ?? 4) * (FLOOR_H[b.feature] ?? 3.2))
const estLevels = (b) => b.levels ?? DEFAULT_LEVELS[b.feature] ?? 4

// ---------- 通用工具 ----------
function closeRing(geom) {
  const pts = geom.map((p) => toLocal(p.lon, p.lat))
  const dedup = pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1])
  const [fx, fz] = dedup[0], [lx, lz] = dedup[dedup.length - 1]
  if (fx !== lx || fz !== lz) dedup.push([fx, fz])
  return dedup
}
function pip(x, z, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
const ringCenter = (ring) => {
  let x = 0, z = 0
  for (const p of ring) { x += p[0]; z += p[1] }
  return [x / ring.length, z / ring.length]
}
// 确定性伪随机(LCG),保证每次烘焙结果一致
let seed = 42
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)

// ---------- 楼宇 ----------
const buildings = geo.buildings.map((b) => {
  const footprint = closeRing(b.geom)
  const center = ringCenter(footprint)
  const levels = estLevels(b)
  return {
    id: b.id, name: b.name, alias: b.alias ?? [], feature: b.feature,
    lod: b.lod, levels, height: +estHeight({ ...b, levels }).toFixed(1),
    hero: b.hero ?? false, zone: b.zone, footprint, center,
  }
})
const namedCount = buildings.filter((b) => b.name).length

// ---------- 道路 ----------
const ROAD_W = { motorway: 14, trunk: 14, primary: 12, secondary: 9, tertiary: 7, unclassified: 5, residential: 5, service: 4, footway: 2, path: 2, cycleway: 2.5, pedestrian: 4, track: 3, steps: 1.5, living_street: 5 }
const roads = geo.roads.map((r) => ({
  id: r.id, name: r.name, kind: r.kind,
  width: ROAD_W[r.kind] ?? 4,
  points: r.geom.map((p) => toLocal(p.lon, p.lat)),
}))

// ---------- 水系(墨湖标记 hero) ----------
const mohuLocal = toLocal(120.3843, 30.3122) // 墨湖 POI(图书馆西侧)
const water = geo.water.map((w) => {
  const ring = closeRing(w.geom)
  const c = ringCenter(ring)
  const dMohu = Math.hypot(c[0] - mohuLocal[0], c[1] - mohuLocal[1])
  return { id: w.id, name: w.name, kind: w.kind, hero: dMohu < 120, ring, center: c }
})

// ---------- 绿地/运动场 ----------
const green = geo.green.map((g) => ({ id: g.id, name: g.name, kind: g.kind, ring: closeRing(g.geom) }))

// ---------- 树:沿校内道路行道树 + 绿地撒点(OSM 无 tree 节点,全程序化) ----------
const treePts = []
const buildingRings = buildings.filter((b) => b.zone !== 'outside').map((b) => b.footprint)
const inAnyBuilding = (x, z) => buildingRings.some((r) => pip(x, z, r))
function tryTree(x, z, scale = 1) {
  if (treePts.length >= 3000) return
  if (inAnyBuilding(x, z)) return
  treePts.push([+x.toFixed(1), +z.toFixed(1), +(0.8 + rand() * 0.5 * scale).toFixed(2)])
}
// 行道树:沿道路每 ~18m,两侧各 50% 概率,法向偏移 5m
for (const r of roads) {
  if (!['service', 'residential', 'footway', 'tertiary', 'unclassified', 'pedestrian'].includes(r.kind)) continue
  for (let i = 0; i < r.points.length - 1; i++) {
    const [x1, z1] = r.points[i], [x2, z2] = r.points[i + 1]
    const len = Math.hypot(x2 - x1, z2 - z1)
    if (len < 10) continue
    const nx = -(z2 - z1) / len, nz = (x2 - x1) / len
    const steps = Math.floor(len / 12)
    for (let s = 1; s < steps; s++) {
      const t = s / steps
      const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t
      if (rand() < 0.7) tryTree(px + nx * 5, pz + nz * 5)
      if (rand() < 0.6) tryTree(px - nx * 5, pz - nz * 5)
    }
  }
}
// 绿地撒点:每 800㎡ 一棵(上限 120/块),跳过运动场
for (const g of green) {
  if (['pitch', 'playground', 'track'].includes(g.kind)) continue
  const xs = g.ring.map((p) => p[0]), zs = g.ring.map((p) => p[1])
  const [minX, maxX] = [Math.min(...xs), Math.max(...xs)]
  const [minZ, maxZ] = [Math.min(...zs), Math.max(...zs)]
  const area = Math.abs(g.ring.reduce((s, p, i) => { const q = g.ring[(i + 1) % g.ring.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
  const n = Math.min(200, Math.max(3, Math.round(area / 500)))
  for (let k = 0; k < n; k++) {
    const x = minX + rand() * (maxX - minX), z = minZ + rand() * (maxZ - minZ)
    if (pip(x, z, g.ring)) tryTree(x, z, 1.2)
  }
}

// ---------- 地标 ----------
const landmarks = landmarksRaw.landmarks.map((l) => ({
  ...l, position: toLocal(l.lng, l.lat),
}))

// ---------- 写出 ----------
await mkdir(OUT, { recursive: true })
const write = (name, obj) => writeFile(join(OUT, name), JSON.stringify(obj))
await write('buildings.json', { origin: ORIGIN, buildings })
await write('roads.json', { roads })
await write('water.json', { water })
await write('green.json', { green })
await write('trees.json', { trees: treePts })
await write('landmarks.json', { landmarks })

// ---------- 验收 ----------
console.log('[bake] origin = OSM 综合大楼质心', ORIGIN)
console.log(`[bake] buildings=${buildings.length} (named=${namedCount}, hero=${buildings.filter(b=>b.hero).length}, L0=${buildings.filter(b=>b.lod===0).length} L1=${buildings.filter(b=>b.lod===1).length} L2=${buildings.filter(b=>b.lod===2).length} L3=${buildings.filter(b=>b.lod===3).length})`)
console.log(`[bake] roads=${roads.length} water=${water.length} (hero=${water.filter(w=>w.hero).length}) green=${green.length} trees=${treePts.length} landmarks=${landmarks.length}`)
const lib = buildings.find((b) => b.name === '图书馆')
const bldA = buildings.find((b) => b.name === 'A教学楼')
const gate = landmarks.find((l) => l.id === 'gate_south')
console.log('[bake] 图书馆 center =', lib?.center, '(应为原点东北方向)')
console.log('[bake] A教学楼 center =', bldA?.center, '(应为原点以东)')
console.log('[bake] 飞翔门 position =', gate?.position, '(应为原点以南)')
// 面积校验(教学区建筑总面积,粗校)
const campusBld = buildings.filter((b) => ['teaching','north_teaching','ne_teaching','center','south_colleges','sw_colleges','nw_group','west_sports','east_park'].includes(b.zone))
let totalFoot = 0
for (const b of campusBld) {
  totalFoot += Math.abs(b.footprint.reduce((s, p, i) => { const q = b.footprint[(i + 1) % b.footprint.length]; return s + p[0] * q[1] - q[0] * p[1] }, 0) / 2)
}
console.log(`[bake] 教学区建筑总 footprint ≈ ${(totalFoot / 10000).toFixed(1)} 万㎡(官方规划 9.62 万㎡,允许 ±25%)`)
