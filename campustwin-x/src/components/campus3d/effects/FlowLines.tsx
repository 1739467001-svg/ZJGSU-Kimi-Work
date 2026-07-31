import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import type { BakedRoad } from '../../../lib/campusData'
import { useSimStore } from '../../../store/simStore'

/** 亮斑沿道路滚动:每 40m 一个周期 */
const UV_SCALE = 40
const HALF_WIDTH = 0.9
const RIBBON_Y = 0.85
const FLOW_COLOR = '#3aa7ff'

/** 时段潮汐兜底密度(simStore.pathCrowd 无数据时) */
function tidalDensity(hour: number): number {
  const bump = (center: number, width: number, peak: number) => {
    const d = Math.min(Math.abs(hour - center), 24 - Math.abs(hour - center))
    return peak * Math.exp(-(d * d) / (2 * width * width))
  }
  const v = 0.06 + bump(8, 1.2, 0.8) + bump(12.2, 1.0, 0.6) + bump(17.8, 1.3, 0.7) + bump(21, 1.5, 0.25)
  return Math.min(1, v)
}

/** 道路折线 → 三角条带(左右各扩 HALF_WIDTH,uv.x = 累计里程 / UV_SCALE) */
function buildRibbons(roads: BakedRoad[]): THREE.BufferGeometry | null {
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []

  for (const r of roads) {
    if (!r.name || r.points.length < 2) continue
    const pts = r.points.map(([x, z]) => new THREE.Vector2(x, z))
    const base = positions.length / 3
    let cum = 0
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[Math.max(0, i - 1)]
      const next = pts[Math.min(pts.length - 1, i + 1)]
      const dir = next.clone().sub(prev)
      if (dir.lengthSq() < 1e-6) dir.set(1, 0)
      dir.normalize()
      const nx = -dir.y
      const nz = dir.x
      if (i > 0) cum += pts[i].distanceTo(pts[i - 1])
      const u = cum / UV_SCALE
      const p = pts[i]
      positions.push(p.x + nx * HALF_WIDTH, RIBBON_Y, p.y + nz * HALF_WIDTH)
      positions.push(p.x - nx * HALF_WIDTH, RIBBON_Y, p.y - nz * HALF_WIDTH)
      uvs.push(u, 0, u, 1)
      if (i > 0) {
        const a = base + (i - 1) * 2
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }
  if (indices.length === 0) return null
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  return g
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uDensity;
uniform vec3 uColor;
void main() {
  float f = fract(vUv.x - uTime * 0.22);
  float spot = 1.0 - smoothstep(0.0, 0.45, f);
  spot = pow(spot, 2.0);
  float edge = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float a = spot * edge * uDensity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`

interface Props {
  roads: BakedRoad[]
}

/**
 * 道路车流光带:实名道路中心线条带(自建自 roads.json,项目内尚无 RoadNetwork 模块),
 * shader UV.x 随时间滚动形成亮斑;密度 uniform = simStore.pathCrowd 均值(缺省按 simClock 时段潮汐)。
 * 全路合并为单一网格,1 DrawCall。
 */
export default function FlowLines({ roads }: Props) {
  const materialRef = useRef<THREE.ShaderMaterial | null>(null)
  const density = useRef(0.2)

  const geometry = useMemo(() => buildRibbons(roads), [roads])
  useEffect(() => () => geometry?.dispose(), [geometry])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uDensity: { value: 0.2 },
          uColor: { value: new THREE.Color(FLOW_COLOR) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [],
  )
  materialRef.current = material
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    const mat = materialRef.current
    if (!mat) return
    mat.uniforms.uTime.value += delta
    // 密度:pathCrowd 有数据 → 均值;否则按仿真时钟时段潮汐
    const { pathCrowd, simClock } = useSimStore.getState()
    const vals = Object.values(pathCrowd)
    let target: number
    if (vals.length > 0) {
      target = vals.reduce((a, b) => a + b, 0) / vals.length
    } else {
      const d = new Date(simClock.nowMs)
      target = tidalDensity(d.getHours() + d.getMinutes() / 60)
    }
    density.current = THREE.MathUtils.damp(density.current, THREE.MathUtils.clamp(target, 0, 1), 2, delta)
    mat.uniforms.uDensity.value = density.current
  })

  if (!geometry) return null
  return <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={6} />
}
