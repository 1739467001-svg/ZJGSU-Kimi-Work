// 飞鸟群(任务E):12 只鸟沿「综合大楼 → 墨湖 → 图书馆」闭合参数曲线盘旋。
// 全部鸟合并为单一 BufferGeometry(体=双三角 + 双三角翼,共 48 三角形、1 DrawCall),
// CPU 逐帧写顶点实现飞行 + 扑翼;黎明/黄昏全员活跃,白天约半数,深夜归巢隐藏。
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../../../store/simStore'
import { sunAltitudeDeg } from '../../../lib/sun'
import { getNightFactor } from '../atmosphere/WindowLights'

const BIRD_COUNT = 12
const VERTS_PER_BIRD = 8 // 头/尾/体左/体右/背左/背右/左翼尖/右翼尖

/** 盘旋航线:综合大楼(0,0) → 墨湖(70,-115) → 图书馆(140,-127),高度 55~68m 越过楼顶 */
const FLIGHT_CURVE = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 62, 15),
    new THREE.Vector3(55, 56, -40),
    new THREE.Vector3(70, 55, -115), // 墨湖上空
    new THREE.Vector3(120, 58, -140),
    new THREE.Vector3(145, 64, -120), // 图书馆上空
    new THREE.Vector3(110, 68, -55),
    new THREE.Vector3(35, 66, 25),
  ],
  true,
  'catmullrom',
  0.6,
)

/** 确定性随机(mulberry32,种子固定刷新不变) */
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

interface BirdSeed {
  u0: number // 航线相位 0..1
  loopSpeed: number // 每秒前进的航线比例
  flapFreq: number // 扑翼角频率
  flapPhase: number
  size: number // 体型 0.8~1.2
  scale: number // 当前缩放(活跃度阻尼,运行期变化)
}

const tmpPos = new THREE.Vector3()
const tmpTan = new THREE.Vector3()

export default function Birds() {
  const groupRef = useRef<THREE.Group>(null)

  // 鸟群合并几何:索引一次成型,顶点逐帧重写
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(BIRD_COUNT * VERTS_PER_BIRD * 3), 3),
    )
    const idx: number[] = []
    for (let i = 0; i < BIRD_COUNT; i++) {
      const b = i * VERTS_PER_BIRD
      // 身体双三角 + 左右翼各一三角
      idx.push(b, b + 2, b + 1, b, b + 1, b + 3, b + 2, b + 4, b + 6, b + 3, b + 7, b + 5)
    }
    g.setIndex(idx)
    return g
  }, [])
  useEffect(() => () => geometry.dispose(), [geometry])

  // 深暖灰剪影材质(双面,翼片从下方可见);深夜整体隐藏,无需昼夜变色
  const material = useMemo(
    () => new THREE.MeshBasicMaterial({ color: '#403a34', side: THREE.DoubleSide }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])

  const birds = useMemo<BirdSeed[]>(() => {
    const rng = mulberry32(0xb1fd5)
    return Array.from({ length: BIRD_COUNT }, (_, i) => ({
      u0: i / BIRD_COUNT + rng() * 0.05,
      loopSpeed: 0.011 + rng() * 0.005, // ≈ 6~9 m/s(航线全长约 600m)
      flapFreq: 6 + rng() * 3,
      flapPhase: rng() * Math.PI * 2,
      size: 0.8 + rng() * 0.4,
      scale: 1,
    }))
  }, [])

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime
    const nf = getNightFactor()
    const date = new Date(useSimStore.getState().simClock.nowMs)
    const altDeg = sunAltitudeDeg(date)
    // 活跃度:黎明/黄昏(高度角 ±9° 内)全员起飞;正午前后保留约半数;深夜归巢
    const duskPeak = THREE.MathUtils.clamp(1 - Math.abs(altDeg) / 9, 0, 1)
    const dayBase = THREE.MathUtils.clamp((altDeg - 8) / 12, 0, 1) * 0.45
    const nightCut = 1 - THREE.MathUtils.smoothstep(nf, 0.7, 0.98)
    const activity = Math.max(duskPeak, dayBase) * nightCut
    if (groupRef.current) groupRef.current.visible = activity > 0.01

    const attr = geometry.getAttribute('position') as THREE.BufferAttribute
    const arr = attr.array as Float32Array

    for (let i = 0; i < BIRD_COUNT; i++) {
      const bird = birds[i]
      // 第 i 只鸟的目标缩放:activity 高于 i/N 才出场,缩放阻尼过渡(起飞/归巢渐显渐隐)
      const target = THREE.MathUtils.clamp(activity * BIRD_COUNT - i, 0, 1)
      bird.scale = THREE.MathUtils.damp(bird.scale, target, 2.5, delta)

      const u = (bird.u0 + t * bird.loopSpeed) % 1
      FLIGHT_CURVE.getPointAt(u, tmpPos)
      FLIGHT_CURVE.getTangentAt(u, tmpTan)
      // fwd 保留爬升/俯冲分量;side 取水平面内垂直于航向
      const fx = tmpTan.x
      const fy = tmpTan.y
      const fz = tmpTan.z
      const hl = Math.hypot(fx, fz) || 1
      const sx = -fz / hl
      const sz = fx / hl

      const k = bird.size * bird.scale
      const px = tmpPos.x
      const py = tmpPos.y
      const pz = tmpPos.z
      // 扑翼:翼尖绕身体纵轴上下摆动,对称同相
      const flap = Math.sin(t * bird.flapFreq + bird.flapPhase)
      const tipY = flap * 1.05 * k
      const span = 1.35 * k

      const o = i * VERTS_PER_BIRD * 3
      // 0 头 / 1 尾
      arr[o] = px + fx * 1.0 * k
      arr[o + 1] = py + fy * 1.0 * k
      arr[o + 2] = pz + fz * 1.0 * k
      arr[o + 3] = px - fx * 0.9 * k
      arr[o + 4] = py - fy * 0.9 * k
      arr[o + 5] = pz - fz * 0.9 * k
      // 2 体左 / 3 体右
      arr[o + 6] = px + sx * 0.16 * k
      arr[o + 7] = py
      arr[o + 8] = pz + sz * 0.16 * k
      arr[o + 9] = px - sx * 0.16 * k
      arr[o + 10] = py
      arr[o + 11] = pz - sz * 0.16 * k
      // 4 背左 / 5 背右(翼后缘铰点,略靠尾)
      arr[o + 12] = px + sx * 0.1 * k - fx * 0.55 * k
      arr[o + 13] = py
      arr[o + 14] = pz + sz * 0.1 * k - fz * 0.55 * k
      arr[o + 15] = px - sx * 0.1 * k - fx * 0.55 * k
      arr[o + 16] = py
      arr[o + 17] = pz - sz * 0.1 * k - fz * 0.55 * k
      // 6 左翼尖 / 7 右翼尖(扑翼高度 + 轻微后掠)
      arr[o + 18] = px + sx * span - fx * 0.3 * k
      arr[o + 19] = py + tipY
      arr[o + 20] = pz + sz * span - fz * 0.3 * k
      arr[o + 21] = px - sx * span - fx * 0.3 * k
      arr[o + 22] = py + tipY
      arr[o + 23] = pz - sz * span - fz * 0.3 * k
    }
    attr.needsUpdate = true
  })

  return (
    <group ref={groupRef}>
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  )
}
