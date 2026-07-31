import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedGreen } from '../../../lib/campusData'
import { applyDayNight } from '../atmosphere/dayNight'

/**
 * 绿地层:green.json 环形多边形 → ShapeGeometry 铺地,全部合并为 1 个 mesh(1 DrawCall)。
 * 顶点色烘焙「白天态」:运动场地(pitch / track / playground)暖陶土 #a57a5c,其余绿地鲜绿 #79a25b。
 * 夜态不另建几何:material.color 在白色(白天)与 NIGHT_TINT(黑夜)之间逐帧插值,
 * 乘算后落到原夜态配色(#24382c / #4a3f35)附近,保持指挥中心蓝图观感不退化。
 */

const GREEN_Y = 0.15
const SPORT_KINDS: ReadonlySet<string> = new Set(['pitch', 'track', 'playground'])
const COLOR_SPORT_DAY = new THREE.Color('#a57a5c')
const COLOR_GREEN_DAY = new THREE.Color('#79a25b')
// 夜态乘算色(≈ 夜态目标色 / 白天顶点色,逐通道折中)
const TINT_DAY = new THREE.Color('#ffffff')
const TINT_NIGHT = new THREE.Color('#585449')

function buildGreenGeometry(green: BakedGreen[]): THREE.BufferGeometry | null {
  const geoms: THREE.BufferGeometry[] = []
  green.forEach((g, i) => {
    if (g.ring.length < 3) return
    const shape = new THREE.Shape(g.ring.map(([x, z]) => new THREE.Vector2(x, -z)))
    const geom = new THREE.ShapeGeometry(shape)
    geom.rotateX(-Math.PI / 2)
    // y 微错层,避免相邻/重叠绿地 z-fighting
    geom.translate(0, GREEN_Y + (i % 6) * 0.002, 0)

    const color = SPORT_KINDS.has(g.kind) ? COLOR_SPORT_DAY : COLOR_GREEN_DAY
    const count = geom.attributes.position.count
    const colors = new Float32Array(count * 3)
    for (let v = 0; v < count; v++) {
      colors[v * 3] = color.r
      colors[v * 3 + 1] = color.g
      colors[v * 3 + 2] = color.b
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geoms.push(geom)
  })
  if (geoms.length === 0) return null
  const merged = mergeGeometries(geoms, false)
  geoms.forEach((g) => g.dispose())
  return merged
}

export default function GreenLayer({ green }: { green: BakedGreen[] }) {
  const geometry = useMemo(() => buildGreenGeometry(green), [green])
  const matRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame(() => {
    const mat = matRef.current
    if (mat) applyDayNight(mat.color, TINT_DAY, TINT_NIGHT)
  })

  if (!geometry) return null
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        ref={matRef}
        vertexColors
        roughness={0.95}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}
