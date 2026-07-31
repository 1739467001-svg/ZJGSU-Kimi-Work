// 流动云层(任务E):程序化噪声 CanvasTexture + 12 片低饱和白色半透明云。
// 白天可见、缓慢漂移循环(±1500m 回绕);黄昏按 goldenGlow 窗口染暖(与 SkyRig 同一
// 高度角 ±6° 逻辑),深夜随 nightFactor 淡出隐藏。高度 200~300m,远高于最高楼
// (综合大楼 48m),不遮挡楼宇。全部 12 片共享 1 几何 + 3 材质,共 24 三角形。
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../../../store/simStore'
import { sunAltitudeDeg } from '../../../lib/sun'
import { getNightFactor } from './WindowLights'

const CLOUD_COUNT = 12
const CLOUD_Y_MIN = 200
const CLOUD_Y_MAX = 300
const DRIFT_RANGE = 1500 // 漂移回绕范围(±米)
const WIND_X = 0.94 // 风向(东风为主,略偏南),已归一化
const WIND_Z = 0.34
// 云色:白天低饱和白 → 黄昏暖橙(仅 golden hour 窗口,正午与深夜不受影响)
const CLOUD_DAY = new THREE.Color('#f3f5f7')
const CLOUD_DUSK = new THREE.Color('#e9b98c')
// 三档基础不透明度,云片轮换分配,形成前后层次
const TIER_OPACITY = [0.5, 0.68, 0.85]

/** 确定性随机(mulberry32,与 lib/textures.ts 同款;种子固定,刷新不变) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 程序化云贴图:多个径向渐变白团叠加 + 中心径向遮罩收边,本地生成零外部资源 */
function makeCloudTexture(seed: number): THREE.CanvasTexture {
  const S = 256
  const c = document.createElement('canvas')
  c.width = S
  c.height = S
  const ctx = c.getContext('2d')
  if (ctx) {
    const rng = mulberry32(seed)
    // 白团簇:中部区域随机落点,大小不一、透明度低,叠出蓬松感
    for (let i = 0; i < 30; i++) {
      const r = 18 + rng() * 52
      const x = S * 0.18 + rng() * S * 0.64
      const y = S * 0.28 + rng() * S * 0.44
      const a = 0.08 + rng() * 0.14
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, `rgba(255, 255, 255, ${a})`)
      g.addColorStop(1, 'rgba(255, 255, 255, 0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, S, S)
    }
    // 边缘径向遮罩:云片外缘羽化到全透明,避免平面硬边
    ctx.globalCompositeOperation = 'destination-in'
    const mask = ctx.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.5)
    mask.addColorStop(0, 'rgba(0, 0, 0, 1)')
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = mask
    ctx.fillRect(0, 0, S, S)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

interface CloudSeed {
  x: number
  y: number
  z: number
  w: number
  h: number
  spin: number
  speed: number
}

export default function Clouds() {
  const groupRef = useRef<THREE.Group>(null)
  const meshRefs = useRef<(THREE.Mesh | null)[]>([])

  const texture = useMemo(() => makeCloudTexture(20240601), [])
  useEffect(() => () => texture.dispose(), [texture])

  // 共享平面几何(1×1,各云片按长宽 scale)
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // 三档不透明度共享材质(初始 opacity=0,useFrame 首帧覆盖)
  const materials = useMemo(
    () =>
      TIER_OPACITY.map(
        () =>
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            fog: false, // 云在 1500m 外也要可见,不吃场景雾
            side: THREE.DoubleSide,
          }),
      ),
    [texture],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  // 云片参数(种子固定):初始位置/高度/长宽/自旋/漂移速度微差
  const clouds = useMemo<CloudSeed[]>(() => {
    const rng = mulberry32(0x5eedc10d)
    return Array.from({ length: CLOUD_COUNT }, () => ({
      x: (rng() * 2 - 1) * DRIFT_RANGE,
      z: (rng() * 2 - 1) * DRIFT_RANGE,
      y: CLOUD_Y_MIN + rng() * (CLOUD_Y_MAX - CLOUD_Y_MIN),
      w: 140 + rng() * 160,
      h: 70 + rng() * 90,
      spin: rng() * Math.PI * 2,
      speed: 3.5 + rng() * 3.5, // 3.5~7 m/s,高空风感
    }))
  }, [])

  useFrame((_, delta) => {
    const nf = getNightFactor()
    const date = new Date(useSimStore.getState().simClock.nowMs)
    const altDeg = sunAltitudeDeg(date)
    // 与 SkyRig 相同的 golden hour 窗口:高度角 ±6° 内线性峰
    const goldenGlow = THREE.MathUtils.clamp(1 - Math.abs(altDeg) / 6, 0, 1)
    // 入夜淡出:nightFactor 0.55→0.95 平滑到 0,深夜整组隐藏
    const dayVis = 1 - THREE.MathUtils.smoothstep(nf, 0.55, 0.95)
    if (groupRef.current) groupRef.current.visible = dayVis > 0.01

    materials.forEach((m, t) => {
      m.opacity = TIER_OPACITY[t] * 0.9 * dayVis
      m.color.copy(CLOUD_DAY).lerp(CLOUD_DUSK, goldenGlow)
    })

    // 缓慢漂移 + 边界回绕
    for (let i = 0; i < clouds.length; i++) {
      const c = clouds[i]
      c.x += WIND_X * c.speed * delta
      c.z += WIND_Z * c.speed * delta
      if (c.x > DRIFT_RANGE) c.x -= DRIFT_RANGE * 2
      if (c.z > DRIFT_RANGE) c.z -= DRIFT_RANGE * 2
      const mesh = meshRefs.current[i]
      if (mesh) mesh.position.set(c.x, c.y, c.z)
    }
  })

  return (
    <group ref={groupRef}>
      {clouds.map((c, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshRefs.current[i] = m
          }}
          geometry={geometry}
          material={materials[i % materials.length]}
          position={[c.x, c.y, c.z]}
          rotation={[-Math.PI / 2, 0, c.spin]}
          scale={[c.w, c.h, 1]}
          renderOrder={8}
        />
      ))}
    </group>
  )
}
