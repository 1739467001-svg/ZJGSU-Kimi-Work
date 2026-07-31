import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { HeroBuildingProps } from './HeroBuildings'

export const WENTI_MAIN_ID = 'w1018218617'
export const WENTI_ANNEX_ID = 'w1018218618'

const PETAL_COUNT = 12
const STRIPE_COUNT = 392 // 392 条水幔幕墙:只做 shader 条纹,不做几何(实施手册 §5.1)

/* ------------------------------------------------------------------ */
/* 单片花瓣:径向 u × 横向 v 参数化弧形板,中段微垂、端部上翘、横向微卷   */
/* ------------------------------------------------------------------ */
function makePetalGeometry(): THREE.BufferGeometry {
  const NU = 16
  const NV = 4
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= NU; i++) {
    const u = i / NU
    const r = THREE.MathUtils.lerp(14, 58, u)
    const halfW = THREE.MathUtils.lerp(12.5, 2.2, Math.pow(u, 0.75))
    const y = 25 - 2 * Math.sin(Math.PI * u) + 10 * THREE.MathUtils.smoothstep(u, 0.6, 1)
    for (let j = 0; j <= NV; j++) {
      const v = j / NV - 0.5
      const cup = 6.4 * v * v * (1 - u * 0.4)
      positions.push(r, y + cup, v * 2 * halfW)
      uvs.push(u, j / NV)
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let j = 0; j < NV; j++) {
      const a = i * (NV + 1) + j
      const b = a + NV + 1
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

/* 12 片花瓣绕中心旋转阵列,逐片微抬避免共面 z-fight,合并为单一几何(1 DrawCall) */
function makePetalRingGeometry(): THREE.BufferGeometry {
  const petal = makePetalGeometry()
  const parts: THREE.BufferGeometry[] = []
  for (let k = 0; k < PETAL_COUNT; k++) {
    const g = petal.clone()
    g.rotateY((k / PETAL_COUNT) * Math.PI * 2)
    g.translate(0, (k % 2) * 0.9 + k * 0.06, 0)
    parts.push(g)
  }
  const merged = mergeGeometries(parts, false)
  for (const g of parts) g.dispose()
  if (merged) {
    petal.dispose()
    return merged
  }
  return petal
}

/* 八边形基座 + 东看台阶梯 box(同材质合并,1 DrawCall;局部 y 以基座中心为 0) */
function makeBaseGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.CylinderGeometry(55, 58, 6, 8)]
  for (let i = 0; i < 4; i++) {
    const h = 2.2 * (i + 1)
    const step = new THREE.BoxGeometry(8, h, 64)
    step.translate(62 + i * 8, h / 2 - 3, 0) // 基座网格整体置于 y=3,局部底面为 -3
    parts.push(step)
  }
  const merged = mergeGeometries(parts, false)
  if (merged) {
    for (const g of parts) g.dispose()
    return merged
  }
  return parts[0]
}

/* ------------------------------------------------------------------ */
/* 主馆:八边形基座 + 水幔幕墙圆柱 + 12 花瓣屋顶 + 中央穹顶 + 东看台     */
/* ------------------------------------------------------------------ */
function WentiMain({ nightFactor }: { nightFactor: number }) {
  // 水幔 shader uniforms(useFrame 驱动,禁 setInterval)
  const uniformsRef = useRef<{ uTime: THREE.IUniform<number>; uNight: THREE.IUniform<number> }>({
    uTime: { value: 0 },
    uNight: { value: 0 },
  })

  const baseGeometry = useMemo(() => makeBaseGeometry(), [])
  const petalRing = useMemo(() => makePetalRingGeometry(), [])

  /* 水幔幕墙:玻璃圆柱 + onBeforeCompile 注入 392 条竖向条纹,夜景条纹内 UV 滚动流光 */
  const curtainMaterial = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      color: '#8fb4c7',
      metalness: 0.55,
      roughness: 0.22,
      transparent: true,
      opacity: 0.92,
    })
    mat.defines = { USE_UV: '' }
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniformsRef.current.uTime
      shader.uniforms.uNight = uniformsRef.current.uNight
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uNight;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          // 392 条竖向水幔肌理(暗竖梃)
          float stripe = fract(vUv.x * ${STRIPE_COUNT}.0);
          float mullion = smoothstep(0.0, 0.14, stripe) * (1.0 - smoothstep(0.86, 1.0, stripe));
          diffuseColor.rgb *= mix(0.5, 1.0, mullion);
          // 夜景:条纹内沿 UV.y 滚动的流光带
          float band = fract(vUv.y - uTime * 0.12);
          float flow = 1.0 - smoothstep(0.0, 0.28, abs(band - 0.5));
          totalEmissiveRadiance += vec3(0.23, 0.65, 1.0) * flow * flow * uNight * 1.6 * mullion;
          totalEmissiveRadiance += vec3(0.16, 0.30, 0.40) * uNight * 0.35;`,
        )
    }
    mat.customProgramCacheKey = () => 'wenti-curtain-v1'
    return mat
  }, [])

  const petalMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d8dcdd',
        metalness: 0.3,
        roughness: 0.55,
        side: THREE.DoubleSide,
        emissive: new THREE.Color('#3aa7ff'),
        emissiveIntensity: 0.05,
      }),
    [],
  )

  useFrame((state) => {
    uniformsRef.current.uTime.value = state.clock.elapsedTime
    uniformsRef.current.uNight.value = THREE.MathUtils.clamp(nightFactor, 0, 1)
    petalMaterial.emissiveIntensity = 0.05 + THREE.MathUtils.clamp(nightFactor, 0, 1) * 0.25
  })

  useEffect(
    () => () => {
      baseGeometry.dispose()
      petalRing.dispose()
      curtainMaterial.dispose()
      petalMaterial.dispose()
    },
    [baseGeometry, petalRing, curtainMaterial, petalMaterial],
  )

  return (
    <group>
      {/* ① 八边形基座 r55 h6 + 东看台阶梯(合并) */}
      <mesh geometry={baseGeometry} position={[0, 3, 0]}>
        <meshStandardMaterial color="#9aa3a8" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* ③ 水幔幕墙玻璃圆柱(y6→22) */}
      <mesh material={curtainMaterial} position={[0, 14, 0]}>
        <cylinderGeometry args={[41, 41, 16, 64, 1, true]} />
      </mesh>
      {/* ② 12 片花瓣屋顶(合并几何,端部上翘) */}
      <mesh geometry={petalRing} material={petalMaterial} />
      {/* 中央穹顶(盖住花瓣内端) */}
      <mesh position={[0, 24, 0]} scale={[1, 0.6, 1]} material={petalMaterial}>
        <sphereGeometry args={[16, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      {/* 夜景:花瓣顶部点光 */}
      <pointLight position={[0, 38, 0]} color="#ffd9a0" intensity={nightFactor * 500} distance={240} decay={2} />
    </group>
  )
}

/* ------------------------------------------------------------------ */
/* 副馆:基座 + 半圆拱顶(半圆柱 + 两端半圆封板,合并)                    */
/* ------------------------------------------------------------------ */
function WentiAnnex() {
  const vaultGeometry = useMemo(() => {
    // 半圆柱(θ∈[0,π],x≥0)→ rotateZ(90°):轴向转 X、拱面朝上、开口向下
    const shell = new THREE.CylinderGeometry(15, 15, 44, 24, 1, true, 0, Math.PI)
    shell.rotateZ(Math.PI / 2)
    const capR = new THREE.CircleGeometry(15, 24, 0, Math.PI)
    capR.rotateY(Math.PI / 2) // 面朝 +x
    capR.translate(22, 0, 0)
    const capL = new THREE.CircleGeometry(15, 24, 0, Math.PI)
    capL.rotateY(-Math.PI / 2) // 面朝 -x
    capL.translate(-22, 0, 0)
    const parts = [shell, capL, capR]
    const merged = mergeGeometries(parts, false)
    if (merged) {
      for (const g of parts) g.dispose()
      return merged
    }
    return shell
  }, [])

  useEffect(() => () => vaultGeometry.dispose(), [vaultGeometry])

  return (
    <group>
      {/* 基座立面带:#9aa3a8→浅灰暖白,与校园暖白灰调协调(参考高校体育馆白色/浅灰立面) */}
      <mesh position={[0, 2, 0]}>
        <boxGeometry args={[52, 4, 46]} />
        <meshStandardMaterial color="#cfccc2" roughness={0.8} metalness={0.05} />
      </mesh>
      {/* 半圆拱屋面:银灰金属屋面。#b4bdc2 中性灰在暖日光+暖地面反照下视觉偏粉,
          改为略冷银灰抵消暖色倾向;metalness 0.4→0.55 强化金属屋面质感 */}
      <mesh geometry={vaultGeometry} position={[0, 4, 0]}>
        <meshStandardMaterial color="#c3c9ce" metalness={0.55} roughness={0.38} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * 文体中心(亚运手球馆,风格化意象):
 * w1018218617 → 主馆(太阳花:八边形基座 + 12 花瓣 + 392 条水幔幕墙)
 * w1018218618 → 副馆(半圆拱)
 * 三角面:主馆约 2.6k,副馆约 0.2k(预算 < 15k)
 */
export default function WentiCenter({ building, nightFactor }: HeroBuildingProps) {
  const isMain = building.id === WENTI_MAIN_ID
  return (
    <group
      name={isMain ? 'wenti-main' : 'wenti-annex'}
      position={[building.center[0], 0, building.center[1]]}
    >
      {isMain ? <WentiMain nightFactor={nightFactor} /> : <WentiAnnex />}
    </group>
  )
}
