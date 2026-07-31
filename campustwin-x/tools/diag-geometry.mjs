// Node 诊断:复刻 CampusBuildings 的几何管线,定位楼体不可见原因
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { readFileSync } from 'fs'

const data = JSON.parse(readFileSync('./public/data/campus/buildings.json', 'utf8'))
const buildings = data.buildings
const HERO = new Set(['w1018218617', 'w1018218618', 'w561932273', 'w563533987'])
const list = buildings.filter((b) => !HERO.has(b.id))
console.log('楼总数(剔 hero):', list.length, '实名:', list.filter((b) => b.name).length)

function buildingGeometry(b) {
  const shape = new THREE.Shape(b.footprint.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: b.height, bevelEnabled: false })
  g.rotateX(-Math.PI / 2)
  return g
}

// 1) 逐楼检查:顶点数 / NaN / groups / uv
let zeroPos = 0, nanPos = 0, noUV = 0, badGroups = 0, tinyFoot = 0
for (const b of list) {
  if (!b.footprint || b.footprint.length < 3) { tinyFoot++; continue }
  const g = buildingGeometry(b)
  const pos = g.getAttribute('position')
  if (!pos || pos.count === 0) zeroPos++
  else {
    for (let i = 0; i < pos.array.length; i++) {
      if (!Number.isFinite(pos.array[i])) { nanPos++; break }
    }
  }
  if (!g.getAttribute('uv')) noUV++
  if (g.groups.length !== 2) badGroups++
  g.dispose()
}
console.log({ tinyFoot, zeroPos, nanPos, noUV, badGroups })

// 2) 复刻 splitGeometry + merge(未命名 inside)
function splitGeometry(b) {
  const g = buildingGeometry(b)
  const slice = (matIndex) => {
    const out = new THREE.BufferGeometry()
    for (const name of ['position', 'normal', 'uv']) {
      const attr = g.getAttribute(name)
      const itemSize = attr.itemSize
      const src = attr.array
      const chunks = []
      let total = 0
      for (const grp of g.groups) {
        if (grp.materialIndex !== matIndex) continue
        const c = src.slice(grp.start * itemSize, (grp.start + grp.count) * itemSize)
        chunks.push(c); total += c.length
      }
      const merged = new Float32Array(total)
      let off = 0
      for (const c of chunks) { merged.set(c, off); off += c.length }
      out.setAttribute(name, new THREE.BufferAttribute(merged, itemSize))
    }
    return out
  }
  const parts = { cap: slice(0), side: slice(1) }
  g.dispose()
  return parts
}

const unnamed = list.filter((b) => !b.name && b.zone !== 'outside')
const caps = [], sides = []
for (const b of unnamed) {
  const p = splitGeometry(b)
  caps.push(p.cap); sides.push(p.side)
}
const capMerged = mergeGeometries(caps, false)
const sideMerged = mergeGeometries(sides, false)
console.log('未命名 inside:', unnamed.length,
  'capMerged:', capMerged ? capMerged.getAttribute('position').count : null,
  'sideMerged:', sideMerged ? sideMerged.getAttribute('position').count : null)

// 3) 实名楼单 mesh:检查 scaleSideUVs 后 groups 与材质数
const named = list.filter((b) => b.name)
const g0 = buildingGeometry(named[0])
console.log('实名样例:', named[0].name, 'groups:', JSON.stringify(g0.groups), 'verts:', g0.getAttribute('position').count)
