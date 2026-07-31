import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedLandmark } from '../../../lib/campusData'

interface GatesProps {
  landmarks: BakedLandmark[]
  /** 0 = 白天,1 = 夜晚;驱动檐口洗墙灯 */
  nightFactor: number
}

interface GateProps {
  position: [number, number]
  nightFactor: number
}

/* 双门统一色调:暖白灰低饱和,避免高饱和蓝/紫 */
const WING_SILVER = '#f2f4f6' // 翼面金属基色(与贴图相乘,近白保持银灰)
const NAMEWALL_WHITE = '#f4f2ec' // 中央校名墙白色板材
const GRANITE_DARK = '#2b2b30' // 深色花岗岩基座 / 黑色伸缩门
const PORTAL_WHITE = '#f0eee6' // 北门白色低平门廊
const GOLD_TEXT = '#d4af37' // 校名金色书法字

/* 校名匾:本地 CanvasTexture(系统 CJK 字体,无外部字体加载)
   按实景照片改为:白色底板 + 金色书法校名 + 深灰英文小字 */
function makePlaqueTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 192
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  // 白色底板
  ctx.fillStyle = '#f7f5ef'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  // 金色细边框
  ctx.strokeStyle = 'rgba(190,160,80,0.75)'
  ctx.lineWidth = 4
  ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16)
  // 金色书法校名
  ctx.fillStyle = GOLD_TEXT
  ctx.font = '700 92px "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text.split('').join(' '), canvas.width / 2, 86)
  // 深灰英文小字
  ctx.fillStyle = '#8a8578'
  ctx.font = '600 34px "Helvetica Neue", "PingFang SC", sans-serif'
  ctx.fillText('ZHEJIANG GONGSHANG UNIVERSITY', canvas.width / 2, 152)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

/* 翼面金属板分格贴图:银灰底 + 竖向分格缝(实景为竖向铝塑板分格)
   ExtrudeGeometry 的 UV 取 Shape 坐标(米制),repeat 0.5 → 每 2m 一格 */
function makeMetalPanelTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  ctx.fillStyle = '#ccd1d6' // 银灰底
  ctx.fillRect(0, 0, 256, 256)
  // 竖向分格缝(每格 1m)
  ctx.strokeStyle = 'rgba(120,128,136,0.85)'
  ctx.lineWidth = 3
  for (const x of [0, 128]) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 256)
    ctx.stroke()
  }
  // 横向分格缝(较淡)
  ctx.strokeStyle = 'rgba(130,138,146,0.45)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 128)
  ctx.lineTo(256, 128)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(0.5, 0.5)
  tex.anisotropy = 4
  return tex
}

/* ------------------------------------------------------------------ */
/* 飞翔门(南大门,2003 竣工,"外形似展翅高飞的海鸥"):                    */
/* 两片对称银灰金属翼形曲面墙(翼尖上扬、根部落地)+ 中央白色校名墙       */
/* (金色书法校名)+ 深色花岗岩基座 + 门下黑色伸缩门暗示                 */
/* ------------------------------------------------------------------ */

/* 单片翼形曲面墙:Shape 前视轮廓 + 沿 z 拉伸成薄壳
   根部(x≈6.5)落地并藏在校名墙后,翼尖(x≈30)上扬至约 11.5m,总跨约 60m */
function makeWingShape(side: 1 | -1): THREE.Shape {
  const s = new THREE.Shape()
  s.moveTo(6.5 * side, 0) // 翼根内下(落地)
  s.lineTo(6.5 * side, 5.8) // 翼根内上
  s.quadraticCurveTo(18 * side, 6.8, 30 * side, 11.5) // 上缘向翼尖扬起
  s.lineTo(30 * side, 6.2) // 翼尖端面
  s.quadraticCurveTo(16 * side, 1.5, 6.5 * side, 0) // 下缘回落翼根
  s.closePath()
  return s
}

function FlyingGate({ position, nightFactor }: GateProps) {
  /* 双翼合并(1 DrawCall) */
  const wingGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const side of [-1, 1] as const) {
      const g = new THREE.ExtrudeGeometry(makeWingShape(side), {
        depth: 1.4,
        bevelEnabled: false,
        curveSegments: 16,
      })
      g.translate(0, 0, -0.7)
      parts.push(g)
    }
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [])

  /* 深色部分合并(1 DrawCall):中央花岗岩基座 + 两侧黑色伸缩门矮墙 */
  const darkGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    const add = (sx: number, sy: number, sz: number, px: number, py: number, pz: number) => {
      const g = new THREE.BoxGeometry(sx, sy, sz)
      g.translate(px, py, pz)
      parts.push(g)
    }
    add(14.4, 0.55, 2.2, 0, 0.275, 0) // 校名墙下深色花岗岩基座
    add(13, 1.15, 0.28, -13.5, 0.575, 1.6) // 左黑色伸缩门(地面矮暗示)
    add(13, 1.15, 0.28, 13.5, 0.575, 1.6) // 右黑色伸缩门
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [])

  /* 中央白色校名墙(独立,便于挂校名匾) */
  const nameWallGeometry = useMemo(() => new THREE.BoxGeometry(13, 3.6, 1.6), [])

  const panelTexture = useMemo(() => makeMetalPanelTexture(), [])
  const plaqueTexture = useMemo(() => makePlaqueTexture('浙江工商大学'), [])

  useEffect(
    () => () => {
      wingGeometry.dispose()
      darkGeometry.dispose()
      nameWallGeometry.dispose()
      panelTexture.dispose()
      plaqueTexture.dispose()
    },
    [wingGeometry, darkGeometry, nameWallGeometry, panelTexture, plaqueTexture],
  )

  return (
    <group name="gate-flying" position={[position[0], 0, position[1]]}>
      {/* 两片对称银灰金属翼形曲面墙 */}
      <mesh geometry={wingGeometry}>
        <meshStandardMaterial
          color={WING_SILVER}
          map={panelTexture}
          roughness={0.42}
          metalness={0.55}
          emissive="#ffe6b8"
          emissiveIntensity={nightFactor * 0.06}
        />
      </mesh>
      {/* 中央白色校名墙 */}
      <mesh geometry={nameWallGeometry} position={[0, 1.8, 0]}>
        <meshStandardMaterial
          color={NAMEWALL_WHITE}
          roughness={0.7}
          metalness={0.05}
          emissive="#fff2d8"
          emissiveIntensity={nightFactor * 0.08}
        />
      </mesh>
      {/* 深色花岗岩基座 + 黑色伸缩门 */}
      <mesh geometry={darkGeometry}>
        <meshStandardMaterial
          color={GRANITE_DARK}
          roughness={0.5}
          metalness={0.4}
        />
      </mesh>
      {/* 校名匾(前后两面,金字贴图) */}
      <mesh position={[0, 1.85, 0.84]}>
        <planeGeometry args={[11.5, 2.15]} />
        <meshStandardMaterial
          map={plaqueTexture}
          emissiveMap={plaqueTexture}
          emissive="#ffffff"
          emissiveIntensity={0.12 + nightFactor * 0.9}
          roughness={0.6}
        />
      </mesh>
      <mesh position={[0, 1.85, -0.84]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[11.5, 2.15]} />
        <meshStandardMaterial
          map={plaqueTexture}
          emissiveMap={plaqueTexture}
          emissive="#ffffff"
          emissiveIntensity={0.12 + nightFactor * 0.9}
          roughness={0.6}
        />
      </mesh>
      {/* 夜景洗墙灯:两翼各一盏 + 中央校名墙一盏 */}
      <pointLight position={[-16, 9, 7]} color="#ffd9a0" intensity={nightFactor * 200} distance={70} decay={2} />
      <pointLight position={[16, 9, 7]} color="#ffd9a0" intensity={nightFactor * 200} distance={70} decay={2} />
      <pointLight position={[0, 5.5, 6]} color="#ffd9a0" intensity={nightFactor * 160} distance={50} decay={2} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* 凯旋门(北大门,俗称"地球门",2003 竣工,"外形似一片船帆"):             */
/* 白色低平船帆形门廊(两侧立柱 + 水平舒展帆形顶,总高约 5m)+            */
/* 正中大型地球仪雕塑(直径约 3.5m,经纬网格,基座上缓慢自转,昼夜不停)  */
/* ------------------------------------------------------------------ */

/* 地球仪贴图:低饱和蓝色球面 + 经纬线网格 + 抽象大陆色块 */
function makeGlobeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')
  // 海洋(低饱和钢蓝,避免高饱和蓝)
  ctx.fillStyle = '#41698c'
  ctx.fillRect(0, 0, 1024, 512)
  // 抽象大陆色块(灰绿,示意即可)
  ctx.fillStyle = '#6e7f63'
  const blobs: [number, number, number, number][] = [
    [700, 150, 130, 70], // 欧亚
    [660, 300, 60, 85], // 非洲
    [250, 160, 80, 100], // 北美
    [300, 330, 55, 75], // 南美
    [820, 360, 55, 40], // 澳洲
  ]
  for (const [cx, cy, rx, ry] of blobs) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, rx, ry, 0.3, 0, Math.PI * 2)
    ctx.fill()
  }
  // 极地
  ctx.fillStyle = '#c8cfd4'
  ctx.fillRect(0, 0, 1024, 26)
  ctx.fillRect(0, 486, 1024, 26)
  // 经纬线网格(每 30° 一条)
  ctx.strokeStyle = 'rgba(214,226,236,0.55)'
  ctx.lineWidth = 2
  for (let x = 0; x <= 1024; x += 85.33) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, 512)
    ctx.stroke()
  }
  for (let y = 0; y <= 512; y += 85.33) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(1024, y)
    ctx.stroke()
  }
  // 赤道加亮
  ctx.strokeStyle = 'rgba(230,238,246,0.8)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 256)
  ctx.lineTo(1024, 256)
  ctx.stroke()
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

function TriumphGate({ position, nightFactor }: GateProps) {
  /* 门廊合并(1 DrawCall):两侧各 3 根立柱 + 帆形顶板(中央留缺让位地球仪) */
  const portalGeometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = []
    for (const side of [-1, 1] as const) {
      // 立柱(0.65 见方,高至顶板下缘)
      for (const x of [4.2, 8, 11.8]) {
        const col = new THREE.BoxGeometry(0.65, 3.85, 0.65)
        col.translate(x * side, 1.925, 0)
        parts.push(col)
      }
      // 帆形顶板:前视轮廓下缘微弧(帆船受风感),顶缘平直,总高约 4.8m
      const sail = new THREE.Shape()
      sail.moveTo(2.6 * side, 4.15)
      sail.lineTo(2.6 * side, 4.75)
      sail.lineTo(13.5 * side, 4.75)
      sail.lineTo(13.5 * side, 3.95)
      sail.quadraticCurveTo(8 * side, 3.7, 2.6 * side, 4.15)
      const slab = new THREE.ExtrudeGeometry(sail, {
        depth: 4.4,
        bevelEnabled: false,
        curveSegments: 8,
      })
      slab.translate(0, 0, -2.2)
      parts.push(slab)
    }
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return parts[0]
  }, [])

  /* 地球仪基座合并(1 DrawCall):方台 + 收分圆台 */
  const pedestalGeometry = useMemo(() => {
    const plinth = new THREE.BoxGeometry(3, 0.3, 3)
    plinth.translate(0, 0.15, 0)
    const drum = new THREE.CylinderGeometry(1.05, 1.3, 0.9, 24)
    drum.translate(0, 0.75, 0)
    const merged = mergeGeometries([plinth, drum], false)
    if (merged) {
      plinth.dispose()
      drum.dispose()
      return merged
    }
    return plinth
  }, [])

  const globeTexture = useMemo(() => makeGlobeTexture(), [])

  /* 地球仪缓慢自转(约 52 秒一圈,昼夜不停),整体地轴倾角 23.5° */
  const globeRef = useRef<THREE.Group>(null)
  useFrame((_, delta) => {
    if (globeRef.current) globeRef.current.rotation.y += delta * 0.12
  })

  useEffect(
    () => () => {
      portalGeometry.dispose()
      pedestalGeometry.dispose()
      globeTexture.dispose()
    },
    [portalGeometry, pedestalGeometry, globeTexture],
  )

  return (
    <group name="gate-triumph" position={[position[0], 0, position[1]]}>
      {/* 白色低平船帆形门廊 */}
      <mesh geometry={portalGeometry}>
        <meshStandardMaterial
          color={PORTAL_WHITE}
          roughness={0.8}
          metalness={0.04}
          emissive="#ffe2ae"
          emissiveIntensity={nightFactor * 0.1}
        />
      </mesh>
      {/* 地球仪深色基座 */}
      <mesh geometry={pedestalGeometry}>
        <meshStandardMaterial color={GRANITE_DARK} roughness={0.55} metalness={0.25} />
      </mesh>
      {/* 正中大型地球仪(直径 3.5m,地轴倾斜,含金属经度环) */}
      <group position={[0, 3.05, 0]} rotation={[0, 0, 0.41]}>
        {/* 经度环(地球仪支架) */}
        <mesh>
          <torusGeometry args={[2.0, 0.08, 12, 48]} />
          <meshStandardMaterial color="#a08c5a" roughness={0.45} metalness={0.7} />
        </mesh>
        {/* 球体(自转部分) */}
        <group ref={globeRef}>
          <mesh>
            <sphereGeometry args={[1.75, 48, 32]} />
            <meshStandardMaterial
              map={globeTexture}
              roughness={0.55}
              metalness={0.15}
              emissiveMap={globeTexture}
              emissive="#ffffff"
              emissiveIntensity={nightFactor * 0.35}
            />
          </mesh>
        </group>
      </group>
      {/* 夜景洗墙灯:门廊 + 地球仪 */}
      <pointLight position={[0, 7, 5]} color="#ffd9a0" intensity={nightFactor * 160} distance={60} decay={2} />
      <pointLight position={[0, 3.5, 4]} color="#cfe0ff" intensity={nightFactor * 60} distance={25} decay={2} />
    </group>
  )
}

/**
 * 双门(gates 无 building,按 landmarks position 落位):
 * gate_south → 飞翔门(南大门,主入口);gate_north → 凯旋门(北大门,俗称"地球门")
 */
export default function Gates({ landmarks, nightFactor }: GatesProps) {
  const south = useMemo(() => landmarks.find((l) => l.id === 'gate_south'), [landmarks])
  const north = useMemo(() => landmarks.find((l) => l.id === 'gate_north'), [landmarks])
  const n = THREE.MathUtils.clamp(nightFactor, 0, 1)
  return (
    <group name="gates">
      {south ? <FlyingGate position={south.position} nightFactor={n} /> : null}
      {north ? <TriumphGate position={north.position} nightFactor={n} /> : null}
    </group>
  )
}
