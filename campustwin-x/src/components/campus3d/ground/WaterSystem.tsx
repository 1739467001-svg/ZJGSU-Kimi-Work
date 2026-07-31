import { useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedWater } from '../../../lib/campusData'
import { useUIStore, type Quality } from '../../../store/uiStore'
import { useSimStore } from '../../../store/simStore'
import { nightFactor, sunDirection } from '../../../lib/sun'
import { applyDayNight } from '../atmosphere/dayNight'

/**
 * 水系:
 * - hero 水面(墨湖):three/examples Water 平面反射 + 程序化法线贴图(quality=low 时降级为伪反射)
 * - 其余水面/河道:合并为 1 个 mesh,MeshStandardMaterial + onBeforeCompile 注入
 *   UV 滚动法线扰动与菲涅尔微光(伪反射)
 * 昼夜双色:白天低饱和灰绿/青绿(#5c7f78 / 墨湖 #4d7d74),黑夜回落原深蓝(#1e3d48 / #16323c),
 * 由 nightFactor 逐帧插值;hero 水面 sunDirection/sunColor 同步真实太阳(夜间翻转为月光)。
 */

const WATER_Y = 0.35
const RIVER_DAY = new THREE.Color('#5c7f78')
const RIVER_NIGHT = new THREE.Color('#1e3d48')
const HERO_WATER_DAY = new THREE.Color(0x4d7d74)
const HERO_WATER_NIGHT = new THREE.Color(0x16323c)
const HERO_SUN_DAY = new THREE.Color(0xffe2b0)
const HERO_SUN_NIGHT = new THREE.Color(0x3d4c66)

type Ring = [number, number][]

// ---------------------------------------------------------------------------
// 程序化水波法线贴图(整数频率正弦叠加 → 四方连续;Sobel 求法线;禁外链)
// ---------------------------------------------------------------------------
let cachedNormals: THREE.CanvasTexture | null = null

function getWaterNormalTexture(): THREE.CanvasTexture {
  if (cachedNormals) return cachedNormals
  const size = 256
  const height = new Float32Array(size * size)
  // [freqX, freqY, amplitude, phase] —— 整数频率保证 tileable
  const waves: ReadonlyArray<readonly [number, number, number, number]> = [
    [3, 1, 0.9, 0.0],
    [1, 4, 0.7, 1.3],
    [5, 3, 0.45, 2.1],
    [8, 2, 0.28, 4.2],
    [2, 7, 0.32, 5.0],
    [6, 6, 0.18, 3.3],
    [11, 5, 0.12, 0.7],
    [4, 11, 0.1, 2.8],
  ]
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0
      for (const [fx, fy, amp, ph] of waves) {
        v += amp * Math.sin((2 * Math.PI * (fx * x + fy * y)) / size + ph)
      }
      height[y * size + x] = v
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('WaterSystem: 无法创建 Canvas2D 上下文')
  const img = ctx.createImageData(size, size)
  const strength = 1.6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size
      const xp = (x + 1) % size
      const ym = (y - 1 + size) % size
      const yp = (y + 1) % size
      const dx = (height[y * size + xp] - height[y * size + xm]) * strength
      const dy = (height[yp * size + x] - height[ym * size + x]) * strength
      const inv = 1 / Math.hypot(dx, dy, 1)
      const o = (y * size + x) * 4
      img.data[o] = (-dx * inv * 0.5 + 0.5) * 255
      img.data[o + 1] = (-dy * inv * 0.5 + 0.5) * 255
      img.data[o + 2] = (inv * 0.5 + 0.5) * 255
      img.data[o + 3] = 255
    }
  }
  ctx.putImageData(img, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  cachedNormals = tex
  return tex
}

/** 多边形环 → 水平面片合并几何(y 微错层防 z-fighting) */
function ringsToGeometry(rings: Ring[], baseY: number): THREE.BufferGeometry | null {
  const geoms: THREE.BufferGeometry[] = []
  rings.forEach((ring, i) => {
    if (ring.length < 3) return
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)))
    const g = new THREE.ShapeGeometry(shape)
    g.rotateX(-Math.PI / 2)
    g.translate(0, baseY + (i % 5) * 0.002, 0)
    geoms.push(g)
  })
  if (geoms.length === 0) return null
  const merged = mergeGeometries(geoms, false)
  geoms.forEach((g) => g.dispose())
  return merged
}

// ---------------------------------------------------------------------------
// 伪反射水面(其余水面/河道;low 画质下也承接 hero 水面)
// ---------------------------------------------------------------------------
function PseudoWater({ rings }: { rings: Ring[] }) {
  const uTime = useMemo(() => ({ value: 0 }), [])
  const geometry = useMemo(() => ringsToGeometry(rings, WATER_Y), [rings])

  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: RIVER_DAY,
      roughness: 0.3,
      metalness: 0.08,
      side: THREE.DoubleSide,
    })
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uTime
      shader.uniforms.uNormalMap = { value: getWaterNormalTexture() }
      shader.vertexShader =
        'varying vec3 vWorldPos;\n' +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n\tvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        )
      shader.fragmentShader =
        'uniform float uTime;\nuniform sampler2D uNormalMap;\nvarying vec3 vWorldPos;\n' +
        shader.fragmentShader
          .replace(
            '#include <normal_fragment_begin>',
            `#include <normal_fragment_begin>
{
	vec3 nTex1 = texture2D(uNormalMap, vWorldPos.xz * 0.035 + vec2(uTime * 0.010, uTime * 0.014)).xyz * 2.0 - 1.0;
	vec3 nTex2 = texture2D(uNormalMap, vWorldPos.xz * 0.021 - vec2(uTime * 0.013, -uTime * 0.009)).xyz * 2.0 - 1.0;
	vec2 ripple = nTex1.xy * 0.6 + nTex2.xy * 0.4;
	normal = normalize(normal + vec3(ripple.x, ripple.y, 0.0) * 0.28);
}`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
{
	float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 3.0);
	// 菲涅尔微光:色相跟随新水色由蓝转青绿(原 vec3(0.055, 0.095, 0.115) 偏蓝,加重荧光感)
	totalEmissiveRadiance += vec3(0.05, 0.09, 0.08) * fres * (0.7 + 0.3 * sin(uTime * 0.7 + vWorldPos.x * 0.045 + vWorldPos.z * 0.03));
}`,
          )
    }
    m.customProgramCacheKey = () => 'campus-pseudo-water-v1'
    return m
  }, [uTime])

  useFrame((_, delta) => {
    uTime.value += delta
    applyDayNight(material.color, RIVER_DAY, RIVER_NIGHT)
  })

  if (!geometry) return null
  return <mesh geometry={geometry} material={material} />
}

// ---------------------------------------------------------------------------
// hero 水面(墨湖):平面反射 Water,low 画质不挂载
// ---------------------------------------------------------------------------
function HeroLake({ rings, quality }: { rings: Ring[]; quality: Quality }) {
  const water = useMemo(() => {
    const geom = ringsToGeometry(rings, 0) ?? new THREE.BufferGeometry()
    const texSize = quality === 'high' ? 512 : 256
    const w = new Water(geom, {
      textureWidth: texSize,
      textureHeight: texSize,
      waterNormals: getWaterNormalTexture(),
      sunDirection: new THREE.Vector3(0.55, 0.75, 0.4).normalize(),
      sunColor: 0xffe2b0,
      waterColor: 0x16323c,
      distortionScale: 2.4,
      alpha: 0.97,
      fog: false,
    })
    w.position.y = WATER_Y + 0.05
    const sizeU = w.material.uniforms['size']
    if (sizeU) sizeU.value = 2.0 // 波纹世界尺度
    return w
  }, [rings, quality])

  useEffect(
    () => () => {
      // Water 无内建 dispose:释放反射纹理 / 材质 / 几何
      const mirror = water.material.uniforms['mirrorSampler']?.value as THREE.Texture | undefined
      mirror?.dispose()
      water.material.dispose()
      water.geometry.dispose()
    },
    [water],
  )

  useFrame((_, delta) => {
    const t = water.material.uniforms['time']
    if (t) t.value = (t.value as number) + delta * 0.55

    // 昼夜驱动:水色/太阳色插值,太阳方向实时跟踪真实太阳(夜间翻转为月光来向)
    const date = new Date(useSimStore.getState().simClock.nowMs)
    const nf = nightFactor(date)
    const dir = sunDirection(date)
    if (nf >= 1) dir.negate()
    const u = water.material.uniforms
    const uWater = u['waterColor']?.value as THREE.Color | undefined
    if (uWater) uWater.copy(HERO_WATER_DAY).lerp(HERO_WATER_NIGHT, nf)
    const uSun = u['sunColor']?.value as THREE.Color | undefined
    if (uSun) uSun.copy(HERO_SUN_DAY).lerp(HERO_SUN_NIGHT, nf)
    const uDir = u['sunDirection']?.value as THREE.Vector3 | undefined
    if (uDir) uDir.copy(dir)
  })

  return <primitive object={water} dispose={null} />
}

// ---------------------------------------------------------------------------
export default function WaterSystem({ water }: { water: BakedWater[] }) {
  const quality = useUIStore((s) => s.quality)
  const allRings = useMemo(() => water.map((w) => w.ring), [water])
  const heroRings = useMemo(() => water.filter((w) => w.hero).map((w) => w.ring), [water])
  const restRings = useMemo(() => water.filter((w) => !w.hero).map((w) => w.ring), [water])
  // quality=low 时墨湖降级走伪反射通道
  const useRealWater = quality !== 'low' && heroRings.length > 0

  return (
    <group>
      <PseudoWater rings={useRealWater ? restRings : allRings} />
      {useRealWater && <HeroLake rings={heroRings} quality={quality} />}
    </group>
  )
}
