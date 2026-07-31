// M0-D2 红线裁剪 + 邻校清洗(零依赖,手写射线法)
// 输入: out/raw-osm.json, campus-redline.geojson, buildings-meta.json
// 输出: out/campus-geo.json(+ 统计与警告)
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(await readFile(join(__dir, 'out/raw-osm.json'), 'utf8'))
const redline = JSON.parse(await readFile(join(__dir, 'campus-redline.geojson'), 'utf8'))
const meta = JSON.parse(await readFile(join(__dir, 'buildings-meta.json'), 'utf8'))

const zones = redline.features.map((f) => ({
  zone: f.properties.zone,
  ring: f.geometry.coordinates[0].map(([lng, lat]) => [lng, lat]),
}))

// 射线法 point-in-polygon
function pip(lng, lat, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const zoneOf = (lng, lat) => zones.find((z) => pip(lng, lat, z.ring))?.zone ?? null

function centroid(geom) {
  let x = 0, y = 0
  for (const p of geom) { x += p.lon; y += p.lat }
  return [x / geom.length, y / geom.length]
}
// 折线与多边形是否相关:任一节点或线段中点落入
function wayTouchesZone(geom) {
  for (let i = 0; i < geom.length; i++) {
    const p = geom[i]
    if (zoneOf(p.lon, p.lat)) return true
    const q = geom[i + 1]
    if (q && zoneOf((p.lon + q.lon) / 2, (p.lat + q.lat) / 2)) return true
  }
  return false
}

function matchMeta(name) {
  if (!name) return null
  if (meta.ignore?.includes(name)) return { strip: true } // 地铁出入口等,去名保留体量
  if (meta.match[name]) return { ...meta.match[name], matchedBy: 'exact' }
  for (const p of meta.patterns) {
    if (new RegExp(p.re).test(name)) {
      const { re, ...rest } = p
      return { ...rest, matchedBy: 'pattern' }
    }
  }
  return null
}

const out = { buildings: [], roads: [], water: [], green: [], trees: [] }
const warnings = []
const stats = { buildingTotal: 0, insideNamed: 0, insideUnnamed: 0, outside: 0, roadsKept: 0, waterKept: 0, greenKept: 0 }

for (const el of raw.elements) {
  const t = el.tags ?? {}
  if (el.type === 'way' && t.building && el.geometry?.length >= 3) {
    stats.buildingTotal++
    const [clng, clat] = centroid(el.geometry)
    const z = zoneOf(clng, clat)
    if (!z) {
      // 校外:去名牌,L3 远景灰盒
      out.buildings.push({ id: `w${el.id}`, zone: 'outside', lod: 3, geom: el.geometry })
      stats.outside++
      continue
    }
    const m = matchMeta(t.name)
    if (t.name && !m) warnings.push(`红线内未匹配白名单: ${t.name} (w${el.id} @${clat.toFixed(5)},${clng.toFixed(5)})`)
    const stripped = m?.strip === true
    const rec = {
      id: `w${el.id}`,
      osmName: t.name ?? null,
      name: stripped ? null : m ? (m.display ?? t.name) : null,
      alias: m?.alias ?? [],
      feature: m?.feature ?? 'unknown',
      lod: m?.lod ?? 2,
      levels: m?.levels ?? t['building:levels'] ?? null,
      heightM: m?.heightM ?? null,
      hero: m?.hero ?? false,
      zone: m?.zone ?? z, // 白名单细分 zone 优先,否则用红线 zone
      geom: el.geometry,
    }
    out.buildings.push(rec)
    if (rec.name) stats.insideNamed++; else stats.insideUnnamed++
  } else if (el.type === 'way' && t.highway && el.geometry?.length >= 2) {
    if (wayTouchesZone(el.geometry)) {
      out.roads.push({ id: `w${el.id}`, name: t.name ?? null, kind: t.highway, geom: el.geometry })
      stats.roadsKept++
    }
  } else if ((el.type === 'way' || el.type === 'relation') && (t.natural === 'water' || t.waterway) && el.geometry?.length >= 3) {
    if (wayTouchesZone(el.geometry)) {
      out.water.push({ id: `${el.type[0]}${el.id}`, name: t.name ?? null, kind: t.natural ?? t.waterway, geom: el.geometry })
      stats.waterKept++
    }
  } else if (el.type === 'way' && (t.leisure || t.landuse) && el.geometry?.length >= 3) {
    const g = t.leisure ?? t.landuse
    if (['park', 'garden', 'grass', 'meadow', 'pitch', 'recreation_ground', 'greenfield', 'playground', 'track'].includes(g) && wayTouchesZone(el.geometry)) {
      out.green.push({ id: `w${el.id}`, name: t.name ?? null, kind: g, geom: el.geometry })
      stats.greenKept++
    }
  }
}

await writeFile(join(__dir, 'out/campus-geo.json'), JSON.stringify(out))
console.log('[clip] stats:', stats)
console.log('[clip] 校外 L3:', stats.outside, '(已去名牌)')
if (warnings.length) {
  console.log('\n[clip] ⚠ 警告(需人工复核是否本校楼宇):')
  for (const w of warnings) console.log('  -', w)
} else {
  console.log('[clip] 红线内命名楼宇全部命中白名单 ✓')
}
