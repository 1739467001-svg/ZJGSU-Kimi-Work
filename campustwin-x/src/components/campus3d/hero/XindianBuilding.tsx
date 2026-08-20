import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeroBuildingProps } from './HeroBuildings'
import { useCampusStore } from '../../../store/campusStore'

export const XINDIAN_ID = 'w563515417'

/** mulberry32 可复现随机(与 ZongheBuilding 同源,亮窗位置每次构建一致) */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------ */
/* 主体立面:暖米砂面砖 + 深色竖向窗带(证据:bing 小图「信电学院」挂牌  */
/* 立面)。1 贴图格 = 1 开间 3.9m × 2 层 7.2m;emissiveMap 夜景竖带亮窗 */
/* ------------------------------------------------------------------ */
interface StripTextures {
  map: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
}

function makeStripFacadeTextures(seed: number, litRatio: number): StripTextures {
  const W = 256
  const H = 128
  const day = document.createElement('canvas')
  day.width = W
  day.height = H
  const night = document.createElement('canvas')
  night.width = W
  night.height = H
  const dctx = day.getContext('2d')
  const nctx = night.getContext('2d')
  if (!dctx || !nctx) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(seed)

  dctx.fillStyle = '#b3a78f' // 暖米砂面砖(低饱和)
  dctx.fillRect(0, 0, W, H)
  nctx.fillStyle = '#000000'
  nctx.fillRect(0, 0, W, H)

  const rows = 2 // 每贴图 2 层,层高 3.6m
  const cols = 4 // 每贴图 4 开间(夜景亮窗按开间独立随机,避免整面同亮同灭)
  const rh = H / rows
  const cw = W / cols
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh
    // 层线(混凝土层间线脚)
    dctx.fillStyle = '#9c9176'
    dctx.fillRect(0, y0, W, 2)
    // 窗带:窗台 ≈1.0m,窗高 ≈2.2m
    const wy0 = y0 + 18
    const wy1 = y0 + 58
    for (let c = 0; c < cols; c++) {
      const winX0 = Math.round(c * cw + cw * 0.27)
      const winX1 = Math.round(c * cw + cw * 0.73) // 竖向窗带宽 ≈1.77m
      dctx.fillStyle = '#39424b' // 深蓝灰玻璃
      dctx.fillRect(winX0, wy0, winX1 - winX0, wy1 - wy0)
      // 竖梃分格(4 扇)
      dctx.fillStyle = '#55626d'
      for (let k = 1; k < 4; k++) {
        dctx.fillRect(winX0 + Math.round((k * (winX1 - winX0)) / 4) - 1, wy0, 3, wy1 - wy0)
      }
      // 窗台板(浅色挑线)
      dctx.fillStyle = '#c6b9a0'
      dctx.fillRect(winX0 - 4, wy1, winX1 - winX0 + 8, 5)
      // 夜景:整开间竖带窗随机点亮(办公/实验室内透)
      if (rand() < litRatio) {
        nctx.globalAlpha = 0.5 + rand() * 0.5
        nctx.fillStyle = '#ffc46e'
        nctx.fillRect(winX0, wy0, winX1 - winX0, wy1 - wy0)
        nctx.globalAlpha = 1
      }
    }
  }

  const map = new THREE.CanvasTexture(day)
  map.wrapS = THREE.RepeatWrapping
  map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const emissiveMap = new THREE.CanvasTexture(night)
  emissiveMap.wrapS = THREE.RepeatWrapping
  emissiveMap.wrapT = THREE.RepeatWrapping
  emissiveMap.colorSpace = THREE.SRGBColorSpace
  emissiveMap.anisotropy = 4
  return { map, emissiveMap }
}

/* ------------------------------------------------------------------ */
/* 弧形玻璃翼贴图:蓝灰玻璃 + 米白横向层带(证据:wechat 庭院照左侧弧   */
/* 形转角楼,层层白色弧带)。1 贴图格 = 8m 宽 × 2 层 7.2m                */
/* ------------------------------------------------------------------ */
function makeArcGlassTexture(): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#66767f' // 蓝灰玻璃(低饱和)
  ctx.fillRect(0, 0, S, S)
  // 竖梃(每 2m 一条)
  ctx.fillStyle = '#4d5a63'
  for (let x = 0; x <= S; x += 64) ctx.fillRect(x - 2, 0, 4, S)
  // 横向米白层带(每层一条,照片中最显眼的特征)
  for (let y = 0; y < S; y += 128) {
    ctx.fillStyle = '#d3c9b6'
    ctx.fillRect(0, y, S, 22)
    ctx.fillStyle = '#b7ac97'
    ctx.fillRect(0, y + 22, S, 3)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* 入口不锈钢学院牌(证据:wechat 入口照,不锈钢牌蚀刻校名+学院名) */
function makePlaqueTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 160
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const grad = ctx.createLinearGradient(0, 0, 0, c.height)
  grad.addColorStop(0, '#d9dadb')
  grad.addColorStop(0.5, '#c3c4c2')
  grad.addColorStop(1, '#b0b1af')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.strokeStyle = 'rgba(70,74,76,0.35)'
  ctx.lineWidth = 3
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16)
  ctx.fillStyle = '#2e3438'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = '700 64px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  ctx.fillText('信息与电子工程学院', c.width / 2, 62)
  ctx.font = '400 30px "Helvetica Neue", Arial, sans-serif'
  ctx.fillStyle = '#4a5054'
  ctx.fillText('School of Information and Electronic Engineering', c.width / 2, 122)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/**
 * 信电楼(信息与电子工程学院 / 萨塞克斯人工智能学院,约 1.2 万㎡ 独立学院大楼):
 * 证据建模(ref-photos/xindian-*):
 *  ① 主体 6 层长条板楼:暖米砂面砖 + 深色竖向窗带(bing「信电学院」挂牌照)
 *  ② 南立面西段通高弧形玻璃翼,米白横向层带(footprint 西南外鼓段 + 庭院照)
 *  ③ 屋顶周边挑檐飘板 + 中部设备间(挂牌照顶部)
 *  ④ 南立面中部 2 层通高玻璃入口 + 不锈钢学院牌 + 两级台阶(入口牌照)
 *  夜景:竖带窗随机暖亮 + 弧形翼整体内透 + 入口常亮暖光
 */
export default function XindianBuilding({ building, nightFactor }: HeroBuildingProps) {
  const H = building.height // 21.6m = 6 层 × 3.6m

  /* 局部化 footprint(shape 约定:(x, -z) 建形)与弧形段提取 */
  const { shape, arcPts } = useMemo(() => {
    const pts = building.footprint.map(
      ([x, z]) => new THREE.Vector2(x - building.center[0], -(z - building.center[1])),
    )
    // 南立面外鼓弧形段:局部 z > 5(shape.y < -5),按 x 排序,向外(+z 南)偏移 0.35m
    const arc = building.footprint
      .map(([x, z]) => ({ x: x - building.center[0], z: z - building.center[1] }))
      .filter((p) => p.z > 5.0)
      .sort((a, b) => a.x - b.x)
      .map((p) => ({ x: p.x, z: p.z + 0.35 }))
    return { shape: new THREE.Shape(pts), arcPts: arc }
  }, [building])

  /* ① 主体:footprint 拉伸 21.6m */
  const mainGeometry = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: H, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [shape, H])

  /* ③ 屋顶挑檐飘板:footprint 外扩 3% 薄板,出挑形成檐口阴影线 */
  const canopyGeometry = useMemo(() => {
    const pts = building.footprint.map(
      ([x, z]) =>
        new THREE.Vector2((x - building.center[0]) * 1.03, -(z - building.center[1]) * 1.03),
    )
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.55, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    g.translate(0, H, 0)
    return g
  }, [building, H])

  /* ② 弧形玻璃翼:沿弧形段采样的通高竖直面片(底部 0.25m 至 H-0.7m) */
  const arcGlassGeometry = useMemo(() => {
    const yB = 0.25
    const yT = H - 0.7
    const n = arcPts.length
    const positions = new Float32Array(n * 2 * 3)
    const uvs = new Float32Array(n * 2 * 2)
    let u = 0
    for (let i = 0; i < n; i++) {
      const p = arcPts[i]
      if (i > 0) {
        const q = arcPts[i - 1]
        u += Math.hypot(p.x - q.x, p.z - q.z)
      }
      positions.set([p.x, yB, p.z], i * 6)
      positions.set([p.x, yT, p.z], i * 6 + 3)
      uvs.set([u, yB], i * 4)
      uvs.set([u, yT], i * 4 + 2)
    }
    const idx: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [arcPts, H])

  /* ③ 屋顶设备间 + 入口雨棚 + 入口台阶:同色系合并(1 DrawCall) */
  const annexGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const plant = new THREE.BoxGeometry(12, 2.6, 8)
    plant.translate(30, H + 1.3, -2)
    parts.push(plant)
    const canopy = new THREE.BoxGeometry(22, 0.4, 3.6)
    canopy.translate(33, 7.45, 8.6)
    parts.push(canopy)
    const step1 = new THREE.BoxGeometry(24, 0.3, 2.6)
    step1.translate(33, 0.15, 8.3)
    parts.push(step1)
    const step2 = new THREE.BoxGeometry(24, 0.3, 1.3)
    step2.translate(33, 0.45, 7.65)
    parts.push(step2)
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [H])

  /* ④ 入口:2 层通高玻璃盒(凸出南墙 0.5m) */
  const entryGeometry = useMemo(() => {
    const g = new THREE.BoxGeometry(20, 7.2, 1.2)
    g.translate(33, 3.6, 6.35)
    return g
  }, [])

  const facade = useMemo(() => {
    const t = makeStripFacadeTextures(563515417, 0.34)
    // ExtrudeGeometry 侧面 UV ≈ 米制:1 贴图格 = 4 开间 15.6m × 7.2m(2 层)
    t.map.repeat.set(1 / 15.6, 1 / 7.2)
    t.emissiveMap.repeat.set(1 / 15.6, 1 / 7.2)
    return t
  }, [])

  const arcTexture = useMemo(() => {
    const t = makeArcGlassTexture()
    t.repeat.set(1 / 8, 1 / 7.2) // uv 已是米制(弧长 × 高度)
    return t
  }, [])

  const plaqueTexture = useMemo(() => makePlaqueTexture(), [])

  const mainMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: facade.map,
        emissiveMap: facade.emissiveMap,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0,
        roughness: 0.78,
        metalness: 0.06,
      }),
    [facade],
  )

  const arcMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: arcTexture,
        metalness: 0.55,
        roughness: 0.22,
        envMapIntensity: 1.2,
        emissive: new THREE.Color('#ffcf96'),
        emissiveIntensity: 0,
        side: THREE.DoubleSide,
      }),
    [arcTexture],
  )

  const annexMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#c9c0ac',
        roughness: 0.85,
        metalness: 0.05,
      }),
    [],
  )

  /* 屋顶盖面:ExtrudeGeometry group1 = 顶/底 cap,避免立面窗带贴图铺满屋顶 */
  const roofMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#a99f8a',
        roughness: 0.92,
        metalness: 0.04,
      }),
    [],
  )

  const entryMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#6f8f8a', // 青灰 Low-E 玻璃(庭院照连廊色)
        metalness: 0.9,
        roughness: 0.12,
        envMapIntensity: 1.4,
        emissive: new THREE.Color('#ffc98a'),
        emissiveIntensity: 0.06,
      }),
    [],
  )

  const plaqueMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: plaqueTexture,
        emissiveMap: plaqueTexture,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.05,
        metalness: 0.6,
        roughness: 0.35,
      }),
    [plaqueTexture],
  )

  useFrame(() => {
    const n = THREE.MathUtils.clamp(nightFactor, 0, 1)
    mainMaterial.emissiveIntensity = 0.04 + n * 1.15 // 竖带窗随机暖亮
    arcMaterial.emissiveIntensity = 0.03 + n * 0.6 // 弧形翼整体内透
    entryMaterial.emissiveIntensity = 0.06 + n * 0.95 // 入口常亮暖光
    plaqueMaterial.emissiveIntensity = 0.05 + n * 0.35 // 牌匾微亮
  })

  useEffect(
    () => () => {
      mainGeometry.dispose()
      canopyGeometry.dispose()
      arcGlassGeometry.dispose()
      annexGeometry.dispose()
      entryGeometry.dispose()
      facade.map.dispose()
      facade.emissiveMap.dispose()
      arcTexture.dispose()
      plaqueTexture.dispose()
      mainMaterial.dispose()
      arcMaterial.dispose()
      annexMaterial.dispose()
      roofMaterial.dispose()
      entryMaterial.dispose()
      plaqueMaterial.dispose()
    },
    [
      mainGeometry,
      canopyGeometry,
      arcGlassGeometry,
      annexGeometry,
      entryGeometry,
      facade,
      arcTexture,
      plaqueTexture,
      mainMaterial,
      arcMaterial,
      annexMaterial,
      roofMaterial,
      entryMaterial,
      plaqueMaterial,
    ],
  )

  const plaqueZ = 7.0 // 入口玻璃盒前表面外侧

  // 分层试点:点击信电楼 → 选中 + 镜头聚焦 + 自动进入全楼分层视图(逐层展开,显示各层房间位置)
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const s = useCampusStore.getState()
    s.selectBuilding(building.id)
    s.focusCamera({ type: 'building', id: building.id })
    s.setSlicedBuilding(building.id)
  }

  return (
    <group name="xindian" position={[building.center[0], 0, building.center[1]]} onClick={handleClick}>
      {/* ① 主体 6 层板楼:侧面米砂面砖 + 竖向窗带,顶面素色屋面 */}
      <mesh geometry={mainGeometry} material={[mainMaterial, roofMaterial]} />
      {/* ② 南立面西段通高弧形玻璃翼 */}
      <mesh geometry={arcGlassGeometry} material={arcMaterial} />
      {/* ③ 屋顶挑檐飘板 */}
      <mesh geometry={canopyGeometry} material={annexMaterial} />
      {/* ③ 设备间 / 入口雨棚 / 台阶(合并) */}
      <mesh geometry={annexGeometry} material={annexMaterial} />
      {/* ④ 南立面中部 2 层通高玻璃入口 */}
      <mesh geometry={entryGeometry} material={entryMaterial} />
      {/* ④ 不锈钢学院牌(挂在入口玻璃盒上方) */}
      <mesh material={plaqueMaterial} position={[33, 8.6, plaqueZ]}>
        <planeGeometry args={[14, 2.2]} />
      </mesh>
    </group>
  )
}

export { XindianBuilding }
