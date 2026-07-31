// 分析 raw-osm.json:列出所有带 name 的建筑及其中心点,辅助画红线与建白名单
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(await readFile(join(__dir, 'out/raw-osm.json'), 'utf8'))

function center(el) {
  const g = el.geometry
  if (!g?.length) return null
  let x = 0, y = 0
  for (const p of g) { x += p.lon; y += p.lat }
  return [x / g.length, y / g.length]
}

const named = []
for (const el of raw.elements) {
  if (el.type === 'way' && el.tags?.building && el.tags?.name) {
    const c = center(el)
    named.push({ id: `w${el.id}`, name: el.tags.name, lng: +c[0].toFixed(6), lat: +c[1].toFixed(6) })
  }
}
named.sort((a, b) => a.lat - b.lat || a.lng - b.lng)
console.log(`named buildings: ${named.length}`)
console.log('name | lng | lat | id')
for (const b of named) console.log(`${b.name} | ${b.lng} | ${b.lat} | ${b.id}`)

// 校区大致范围统计(帮助画红线)
const lngs = named.map((b) => b.lng), lats = named.map((b) => b.lat)
console.log('\nname-tag bbox:', Math.min(...lngs), Math.min(...lats), '->', Math.max(...lngs), Math.max(...lats))
