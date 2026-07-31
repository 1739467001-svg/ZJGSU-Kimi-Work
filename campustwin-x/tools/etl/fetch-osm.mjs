// M0-D1 拉取浙江工商大学下沙校区全域 OSM 数据
// 用法: node tools/etl/fetch-osm.mjs
// 产物: tools/etl/out/raw-osm.json
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dir, 'out')

// 覆盖教学区 + 钱江湾/金沙港/玉屏洲生活区,并含少量邻校边缘(供 L3 远景)
const BBOX = '30.298,120.372,30.320,120.402' // s,w,n,e

const MIRRORS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

const QUERY = `
[out:json][timeout:180];
(
  way[building](${BBOX});
  relation[building](${BBOX});
  way[highway](${BBOX});
  way[natural=water](${BBOX});
  relation[natural=water](${BBOX});
  way[waterway](${BBOX});
  way[leisure](${BBOX});
  node[natural=tree](${BBOX});
  way[landuse](${BBOX});
);
out geom;`

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function tryMirror(url) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'User-Agent': 'CampusTwinX-ETL/1.0 (educational demo, contact: local-dev)',
    },
    body: `data=${encodeURIComponent(QUERY)}`,
    signal: AbortSignal.timeout(240_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

let lastErr
for (let attempt = 0; attempt < MIRRORS.length * 2 && !lastErr?.done; attempt++) {
  const mirror = MIRRORS[attempt % MIRRORS.length]
  process.stdout.write(`[fetch-osm] attempt ${attempt + 1} via ${mirror} ... `)
  try {
    const data = await tryMirror(mirror)
    await mkdir(OUT_DIR, { recursive: true })
    const file = join(OUT_DIR, 'raw-osm.json')
    await writeFile(file, JSON.stringify(data))
    const kinds = {}
    for (const el of data.elements ?? []) {
      const k = `${el.type}:${el.tags?.building ? 'building' : el.tags?.highway ? 'highway' : el.tags?.natural ?? el.tags?.waterway ? 'water' : el.tags?.leisure ? 'leisure' : el.tags?.landuse ? 'landuse' : 'other'}`
      kinds[k] = (kinds[k] ?? 0) + 1
    }
    console.log('OK')
    console.log('[fetch-osm] saved to', file)
    console.log('[fetch-osm] osm_base =', data.osm3s?.timestamp_osm_base)
    console.table(kinds)
    process.exit(0)
  } catch (e) {
    console.log('FAILED:', e.message)
    lastErr = e
    await sleep(2000 * (attempt + 1))
  }
}
console.error('[fetch-osm] all mirrors failed')
process.exit(1)
