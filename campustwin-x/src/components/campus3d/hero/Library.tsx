import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeroBuildingProps } from './HeroBuildings'

export const LIBRARY_ID = 'w563533987'

/* ------------------------------------------------------------------ */
/* 尺寸与布局(局部米制,origin = footprint 质心,x 东,z 南)              */
/* 视觉修正:烘焙 8 层/34m 与官方照片(13 层白色主塔)不符,               */
/* 按任务约定「以照片视觉比例为准」塔身做 42m(仍低于综合大楼 48m),      */
/* 数据 height 不动。                                                  */
/* ------------------------------------------------------------------ */
const PODIUM_H = 13 // 裙楼(1~5 层阅览区,白色竖向线条)
const TOWER_H = 42 // 主塔 13 层 × 3.23m
const RIBBON_H = 12.4 // 弧形玻璃幕廊(低于裙楼檐口,悬浮 0.55m)

/** 主塔:64m × 22m,落于地块北部(南侧留出前广场轴) */
const TOWER = { minX: -23, maxX: 41, minZ: -38, maxZ: -16 }
/** 中部内凹深色竖向条带:8m 宽,对齐主入口轴 x≈9,南北面各退 1.4m */
const CORE = { minX: 5, maxX: 13 }
const CORE_RECESS = 1.4

/** footprint 点位索引(烘焙 w563533987):9..28 南侧大弧(临前广场),14..18 锯齿噪声点,32..40 西南弧(临墨湖) */
const SOUTH_ARC = { from: 9, to: 28, skip: [14, 15, 16, 17, 18] }
const LAKE_ARC = { from: 32, to: 40 }

/* ------------------------------------------------------------------ */
/* 工具                                                                 */
/* ------------------------------------------------------------------ */
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

function finalize(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

interface TexturePair {
  map: THREE.CanvasTexture
  emissiveMap: THREE.CanvasTexture
}

function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  if (merged) {
    for (const g of parts) g.dispose()
    return merged
  }
  return parts[0]
}

/** 矩形(局部 x/z)→ Shape(约定 (x, -z)) */
function rectShape(minX: number, maxX: number, minZ: number, maxZ: number): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(minX, -minZ)
  s.lineTo(maxX, -minZ)
  s.lineTo(maxX, -maxZ)
  s.lineTo(minX, -maxZ)
  s.closePath()
  return s
}

/* ------------------------------------------------------------------ */
/* 程序化贴图(断网红线:全部本地 CanvasTexture)                          */
/* ------------------------------------------------------------------ */
/** 主塔立面:暖白金属板 + 13 条横向条窗(一层一条),夜景按「层 × 8 段」亮灯 */
function makeTowerTextures(seed: number): TexturePair {
  const W = 512
  const H = 512 // 一瓦片 = 32m × TOWER_H(42m)
  const BANDS = 13
  const day = document.createElement('canvas')
  day.width = W
  day.height = H
  const night = document.createElement('canvas')
  night.width = W
  night.height = H
  const d = day.getContext('2d')
  const n = night.getContext('2d')
  if (!d || !n) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(seed)

  d.fillStyle = '#eae6dc'
  d.fillRect(0, 0, W, H)
  n.fillStyle = '#000000'
  n.fillRect(0, 0, W, H)

  const bandH = H / BANDS
  for (let r = 0; r < BANDS; r++) {
    // r=0 为地面层 → 画布底部(flipY)
    const yTop = H - (r + 1) * bandH
    // 层间板阴影线
    d.fillStyle = 'rgba(92,86,72,0.18)'
    d.fillRect(0, yTop + bandH - 3, W, 3)
    // 横向条窗(占层高约 44%)
    const winY = yTop + bandH * 0.3
    const winH = bandH * 0.44
    const j = 0.92 + rand() * 0.12
    d.fillStyle = `rgb(${Math.round(58 * j)},${Math.round(70 * j)},${Math.round(79 * j)})`
    d.fillRect(0, winY, W, winH)
    // 窗上口高光
    d.fillStyle = 'rgba(255,255,255,0.26)'
    d.fillRect(0, winY, W, 2)
    // 竖向窗梃(≈1m 一梃)
    d.fillStyle = 'rgba(234,230,220,0.5)'
    for (let x = 0; x <= W; x += 16) d.fillRect(x, winY, 1.5, winH)
    // 夜景:条窗 8 段,按概率暖亮点亮
    for (let s = 0; s < 8; s++) {
      if (rand() >= 0.42) continue
      const warm = 0.75 + rand() * 0.4
      n.globalAlpha = 0.55 + rand() * 0.45
      n.fillStyle = `rgb(${Math.round(255 * warm)},${Math.round(196 * warm)},${Math.round(120 * warm)})`
      n.fillRect(s * (W / 8) + 2, winY + 1, W / 8 - 4, winH - 2)
    }
    n.globalAlpha = 1
  }
  return { map: finalize(day), emissiveMap: finalize(night) }
}

/** 裙楼立面:暖白竖向线条 + 中部条窗带 + 檐口/基座 */
function makePodiumTextures(seed: number): TexturePair {
  const W = 512
  const H = 256 // 一瓦片 = 24m × PODIUM_H(13m)
  const day = document.createElement('canvas')
  day.width = W
  day.height = H
  const night = document.createElement('canvas')
  night.width = W
  night.height = H
  const d = day.getContext('2d')
  const n = night.getContext('2d')
  if (!d || !n) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(seed)

  d.fillStyle = '#e7e2d6'
  d.fillRect(0, 0, W, H)
  n.fillStyle = '#000000'
  n.fillRect(0, 0, W, H)

  const pxPerM = W / 24
  // 竖向线条:1m 密线 + 3m 主线(照片裙楼特征)
  for (let x = 0; x <= W; x += pxPerM) {
    d.fillStyle = 'rgba(106,99,83,0.15)'
    d.fillRect(x, 0, 1.5, H)
  }
  for (let x = 0; x <= W; x += pxPerM * 3) {
    d.fillStyle = 'rgba(96,89,73,0.28)'
    d.fillRect(x, 0, 3, H)
  }
  // 中部条窗带(真实高度 4.5~7.5m)
  const winY = H * (1 - 7.5 / PODIUM_H)
  const winH = H * (3 / PODIUM_H)
  d.fillStyle = '#3f4c55'
  d.fillRect(0, winY, W, winH)
  d.fillStyle = 'rgba(255,255,255,0.22)'
  d.fillRect(0, winY, W, 2)
  d.fillStyle = 'rgba(231,226,214,0.55)'
  for (let x = 0; x <= W; x += pxPerM) d.fillRect(x, winY, 1.5, winH)
  // 顶部檐口线脚 + 基座
  d.fillStyle = '#f0ece1'
  d.fillRect(0, 0, W, H * (0.8 / PODIUM_H))
  d.fillStyle = 'rgba(90,84,70,0.2)'
  d.fillRect(0, H * (0.8 / PODIUM_H), W, 2)
  d.fillStyle = '#d3cec2'
  d.fillRect(0, H * (1 - 1 / PODIUM_H), W, H * (1 / PODIUM_H))
  // 夜景:条窗带按 3m 段点亮
  for (let s = 0; s < 8; s++) {
    if (rand() >= 0.32) continue
    const warm = 0.75 + rand() * 0.4
    n.globalAlpha = 0.5 + rand() * 0.5
    n.fillStyle = `rgb(${Math.round(255 * warm)},${Math.round(198 * warm)},${Math.round(122 * warm)})`
    n.fillRect(s * (W / 8) + 2, winY + 2, W / 8 - 4, winH - 4)
  }
  n.globalAlpha = 1
  return { map: finalize(day), emissiveMap: finalize(night) }
}

/** 中部竖向条带夜景:黑底 + 逐层暖光横线(内庭透光感) */
function makeCoreNightTexture(seed: number): THREE.CanvasTexture {
  const W = 128
  const H = 512
  const BANDS = 13
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  const rand = mulberry32(seed)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, W, H)
  const bandH = H / BANDS
  for (let r = 0; r < BANDS; r++) {
    if (rand() >= 0.55) continue
    const yTop = H - (r + 1) * bandH
    const warm = 0.75 + rand() * 0.4
    ctx.globalAlpha = 0.5 + rand() * 0.5
    ctx.fillStyle = `rgb(${Math.round(255 * warm)},${Math.round(199 * warm)},${Math.round(125 * warm)})`
    ctx.fillRect(4, yTop + bandH * 0.34, W - 8, bandH * 0.36)
  }
  ctx.globalAlpha = 1
  return finalize(canvas)
}

/** 入口名牌「图书馆」:深灰底 + 暖白字(系统 CJK 字体,无外部加载) */
function makeNameTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#26292e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = 'rgba(242,234,214,0.4)'
  ctx.lineWidth = 3
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  ctx.fillStyle = '#f2ead6'
  ctx.font = '700 74px "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text.split('').join(' '), canvas.width / 2, canvas.height / 2 + 4)
  return finalize(canvas)
}

/* ------------------------------------------------------------------ */
/* 图书馆(重建,证据:官网校园风光「只争朝夕(图书馆)」):                  */
/* ① 13 层白色主塔,横向条窗,中部内凹深色竖向玻璃条带;                  */
/* ② 白色裙楼(竖向线条)按真实 footprint 拉伸,南面前场入口凹口           */
/*    (孔子铜像 / 花坛钟所在前广场,墨湖 landmark 紧贴楼西);             */
/* ③ 南侧弧形玻璃幕廊(临前广场)+ 西南弧形玻璃幕廊(临墨湖),夜景暖光;   */
/* ④ 入口大台阶 + 雨棚 + 玻璃门 + 名牌;主塔女儿墙 + 屋顶设备层。        */
/* ------------------------------------------------------------------ */
export default function Library({ building, nightFactor }: HeroBuildingProps) {
  const cx = building.center[0]
  const cz = building.center[1]

  /* 局部化 footprint */
  const localPts = useMemo(
    () => building.footprint.map(([x, z]) => [x - cx, z - cz] as [number, number]),
    [building, cx, cz],
  )

  /* 入口凹口(点位 8/9 = 凹口后墙两角,孔子铜像正后方) */
  const entrance = useMemo(() => {
    if (localPts.length > 9) {
      const [x8, z8] = localPts[8]
      const [x9, z9] = localPts[9]
      return { x: (x8 + x9) / 2, z: (z8 + z9) / 2, w: Math.abs(x9 - x8) }
    }
    return { x: 9.2, z: 42.2, w: 24 }
  }, [localPts])

  /* ① 裙楼:真实 footprint 拉伸 13m */
  const podiumGeo = useMemo(() => {
    const shape = new THREE.Shape(localPts.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: PODIUM_H, bevelEnabled: false })
    g.rotateX(-Math.PI / 2)
    return g
  }, [localPts])

  /* ② 主塔两翼(中部留 8m 凹带) */
  const westWingGeo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(rectShape(TOWER.minX, CORE.minX, TOWER.minZ, TOWER.maxZ), {
      depth: TOWER_H,
      bevelEnabled: false,
    })
    g.rotateX(-Math.PI / 2)
    return g
  }, [])
  const eastWingGeo = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(rectShape(CORE.maxX, TOWER.maxX, TOWER.minZ, TOWER.maxZ), {
      depth: TOWER_H,
      bevelEnabled: false,
    })
    g.rotateX(-Math.PI / 2)
    return g
  }, [])

  /* ③ 弧形玻璃幕廊:沿 footprint 弧段逐段立面板(锯齿噪声点剔除) */
  const ribbonGeo = useMemo(() => {
    if (localPts.length <= LAKE_ARC.to) return null
    const south = localPts
      .slice(SOUTH_ARC.from, SOUTH_ARC.to + 1)
      .filter((_, i) => !SOUTH_ARC.skip.includes(SOUTH_ARC.from + i))
    const lake = localPts.slice(LAKE_ARC.from, LAKE_ARC.to + 1)
    const ref: [number, number] = [(TOWER.minX + TOWER.maxX) / 2, (TOWER.minZ + TOWER.maxZ) / 2]
    const parts: THREE.BufferGeometry[] = []
    for (const pts of [south, lake]) {
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x1, z1] = pts[i]
        const [x2, z2] = pts[i + 1]
        const dx = x2 - x1
        const dz = z2 - z1
        const len = Math.hypot(dx, dz)
        if (len < 0.6) continue
        const mx = (x1 + x2) / 2
        const mz = (z1 + z2) / 2
        // 外法线 = 背离塔心一侧
        let nx = dz / len
        let nz = -dx / len
        if (nx * (mx - ref[0]) + nz * (mz - ref[1]) < 0) {
          nx = -nx
          nz = -nz
        }
        const g = new THREE.BoxGeometry(len + 0.3, RIBBON_H, 0.45)
        g.translate(0, RIBBON_H / 2, 0)
        g.rotateY(-Math.atan2(dz, dx))
        g.translate(mx + nx * 0.55, 0, mz + nz * 0.55)
        parts.push(g)
      }
    }
    return mergeParts(parts)
  }, [localPts])

  /* ④ 入口大台阶(3 级,自凹口后墙向南下退) */
  const stepsGeo = useMemo(() => {
    const w = Math.min(22, entrance.w - 2.6)
    const tiers: Array<[number, number]> = [
      [4.5, 0.5],
      [3, 1.0],
      [1.5, 1.5],
    ]
    const parts = tiers.map(([d, h]) => {
      const g = new THREE.BoxGeometry(w, h, d)
      g.translate(entrance.x, h / 2, entrance.z + d / 2)
      return g
    })
    return mergeParts(parts)
  }, [entrance])

  /* ⑤ 主塔女儿墙(屋顶周边 4 条薄板) */
  const parapetGeo = useMemo(() => {
    const t = 0.6
    const h = 1.2
    const y = TOWER_H + h / 2
    const w = TOWER.maxX - TOWER.minX
    const d = TOWER.maxZ - TOWER.minZ
    const px = (TOWER.minX + TOWER.maxX) / 2
    const pz = (TOWER.minZ + TOWER.maxZ) / 2
    const mk = (sx: number, sz: number, x: number, z: number) => {
      const g = new THREE.BoxGeometry(sx, h, sz)
      g.translate(x, y, z)
      return g
    }
    return mergeParts([
      mk(w + t, t, px, TOWER.minZ + t / 2),
      mk(w + t, t, px, TOWER.maxZ - t / 2),
      mk(t, d + t, TOWER.minX + t / 2, pz),
      mk(t, d + t, TOWER.maxX - t / 2, pz),
    ])
  }, [])

  /* ⑥ 屋顶设备层(水箱间 + 楼梯间,靠北侧) */
  const equipGeo = useMemo(() => {
    const a = new THREE.BoxGeometry(18, 2.8, 9)
    a.translate(24, TOWER_H + 1.4, -32)
    const b = new THREE.BoxGeometry(8, 3.2, 7)
    b.translate(-12, TOWER_H + 1.6, -31)
    return mergeParts([a, b])
  }, [])

  /* 贴图与材质 */
  const towerTex = useMemo(() => {
    const t = makeTowerTextures(563533987)
    t.map.repeat.set(1 / 32, 1 / TOWER_H)
    t.emissiveMap.repeat.set(1 / 32, 1 / TOWER_H)
    return t
  }, [])
  const podiumTex = useMemo(() => {
    const t = makePodiumTextures(563533988)
    t.map.repeat.set(1 / 24, 1 / PODIUM_H)
    t.emissiveMap.repeat.set(1 / 24, 1 / PODIUM_H)
    return t
  }, [])
  const coreNightTex = useMemo(() => makeCoreNightTexture(563533989), [])
  const nameTex = useMemo(() => makeNameTexture('图书馆'), [])

  const podiumRoofMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#c9c4b8', roughness: 0.92, metalness: 0.04 }),
    [],
  )
  const towerRoofMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#d6d2c8', roughness: 0.85, metalness: 0.06 }),
    [],
  )
  const towerWallMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: towerTex.map,
        emissiveMap: towerTex.emissiveMap,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0.03,
        roughness: 0.52,
        metalness: 0.14,
      }),
    [towerTex],
  )
  const podiumWallMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: podiumTex.map,
        emissiveMap: podiumTex.emissiveMap,
        emissive: new THREE.Color('#ffd9a0'),
        emissiveIntensity: 0.03,
        roughness: 0.68,
        metalness: 0.08,
      }),
    [podiumTex],
  )
  /* 中部内凹深色竖向条带(深色玻璃,夜态内庭暖光) */
  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#242c33',
        emissiveMap: coreNightTex,
        emissive: new THREE.Color('#ffc987'),
        emissiveIntensity: 0.05,
        metalness: 0.85,
        roughness: 0.14,
        envMapIntensity: 1.3,
      }),
    [coreNightTex],
  )
  /* 弧形玻璃幕廊(映湖 / 映广场,夜景暖光) */
  const glassMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#5b7280',
        metalness: 1.0,
        roughness: 0.07,
        envMapIntensity: 1.7,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        emissive: new THREE.Color('#ffb45e'),
        emissiveIntensity: 0.05,
      }),
    [],
  )
  const stepsMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#9d968a', roughness: 0.85, metalness: 0.05 }),
    [],
  )
  const signMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        map: nameTex,
        emissiveMap: nameTex,
        emissive: new THREE.Color('#ffffff'),
        emissiveIntensity: 0.08,
        roughness: 0.6,
        metalness: 0.2,
      }),
    [nameTex],
  )

  useFrame(() => {
    const n = THREE.MathUtils.clamp(nightFactor, 0, 1)
    towerWallMat.emissiveIntensity = 0.03 + n * 1.15
    podiumWallMat.emissiveIntensity = 0.03 + n * 0.85
    coreMat.emissiveIntensity = 0.05 + n * 0.9
    glassMat.emissiveIntensity = 0.05 + n * 1.25 // 夜态幕廊暖光
    signMat.emissiveIntensity = 0.08 + n * 1.1
  })

  useEffect(
    () => () => {
      podiumGeo.dispose()
      westWingGeo.dispose()
      eastWingGeo.dispose()
      ribbonGeo?.dispose()
      stepsGeo?.dispose()
      parapetGeo?.dispose()
      equipGeo?.dispose()
      towerTex.map.dispose()
      towerTex.emissiveMap.dispose()
      podiumTex.map.dispose()
      podiumTex.emissiveMap.dispose()
      coreNightTex.dispose()
      nameTex.dispose()
      podiumRoofMat.dispose()
      towerRoofMat.dispose()
      towerWallMat.dispose()
      podiumWallMat.dispose()
      coreMat.dispose()
      glassMat.dispose()
      stepsMat.dispose()
      signMat.dispose()
    },
    [
      podiumGeo,
      westWingGeo,
      eastWingGeo,
      ribbonGeo,
      stepsGeo,
      parapetGeo,
      equipGeo,
      towerTex,
      podiumTex,
      coreNightTex,
      nameTex,
      podiumRoofMat,
      towerRoofMat,
      towerWallMat,
      podiumWallMat,
      coreMat,
      glassMat,
      stepsMat,
      signMat,
    ],
  )

  return (
    <group name="library" position={[cx, 0, cz]}>
      {/* 裙楼(ExtrudeGeometry 分组:0=顶/底盖 → 素色屋面,1=侧墙 → 竖向线条贴图) */}
      <mesh geometry={podiumGeo} material={[podiumRoofMat, podiumWallMat]} />
      {/* 主塔两翼(13 层横向条窗) */}
      <mesh geometry={westWingGeo} material={[towerRoofMat, towerWallMat]} />
      <mesh geometry={eastWingGeo} material={[towerRoofMat, towerWallMat]} />
      {/* 中部内凹深色竖向条带(南北面各退 1.4m) */}
      <mesh material={coreMat} position={[(CORE.minX + CORE.maxX) / 2, TOWER_H / 2, (TOWER.minZ + TOWER.maxZ) / 2]}>
        <boxGeometry
          args={[CORE.maxX - CORE.minX, TOWER_H, TOWER.maxZ - TOWER.minZ - CORE_RECESS * 2]}
        />
      </mesh>
      {/* 弧形玻璃幕廊(南临前广场 + 西南临墨湖) */}
      {ribbonGeo ? <mesh geometry={ribbonGeo} material={glassMat} /> : null}
      {/* 女儿墙 + 屋顶设备层 */}
      {parapetGeo ? <mesh geometry={parapetGeo} material={towerRoofMat} /> : null}
      {equipGeo ? <mesh geometry={equipGeo} material={towerRoofMat} /> : null}
      {/* 入口:大台阶 + 雨棚 + 玻璃门 + 名牌「图书馆」 */}
      {stepsGeo ? <mesh geometry={stepsGeo} material={stepsMat} /> : null}
      <mesh material={podiumRoofMat} position={[entrance.x, 5.35, entrance.z + 2.3]}>
        <boxGeometry args={[entrance.w - 3.6, 0.5, 4.6]} />
      </mesh>
      <mesh material={coreMat} position={[entrance.x, 3.6, entrance.z + 0.12]}>
        <planeGeometry args={[entrance.w - 6.6, 4.2]} />
      </mesh>
      <mesh material={signMat} position={[entrance.x, 7.7, entrance.z + 0.12]}>
        <planeGeometry args={[11, 2]} />
      </mesh>
    </group>
  )
}
