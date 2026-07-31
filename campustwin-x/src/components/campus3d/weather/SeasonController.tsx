// 四季控制(手册 §4.5):命名导出 seasonPalette 供植被模块调用(本模块不得 import 植被模块,防循环)
// 另在「商大花海」「向日葵地」两个地标位置放花田色块(ShapeGeometry 圆盘,按季节显隐换色)
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useUIStore } from '../../../store/uiStore'
import type { Season } from '../../../store/uiStore'

/** 四季色板:植被模块(tree instanceColor × 3)+ 花田显隐 */
export interface SeasonPalette {
  /** [阔叶, 针叶, 彩叶/点缀],主色取手册 §3.5 四季色 */
  treeColors: [string, string, string]
  /** 商大花海(春油菜/夏秋花种轮换,冬季休耕) */
  flowerVisible: boolean
  /** 向日葵地(8–9 月盛开 → 夏/秋可见) */
  sunflowerVisible: boolean
}

const PALETTES: Record<Season, SeasonPalette> = {
  spring: { treeColors: ['#7fae5a', '#527a4e', '#a4c46e'], flowerVisible: true, sunflowerVisible: false },
  summer: { treeColors: ['#4d7c43', '#39543a', '#6f9956'], flowerVisible: true, sunflowerVisible: true },
  autumn: { treeColors: ['#c98f3d', '#7c6b40', '#d9a943'], flowerVisible: true, sunflowerVisible: true },
  winter: { treeColors: ['#6b5d4f', '#4c5347', '#8a7c63'], flowerVisible: false, sunflowerVisible: false },
}

export function seasonPalette(season: Season): SeasonPalette {
  return PALETTES[season]
}

// 地标点位(与 public/data/campus/landmarks.json 中 flower_sea / sunflower_field 一致,手工点位)
const FLOWER_SEA_POS: [number, number] = [-131.95, 183.83]
const SUNFLOWER_POS: [number, number] = [-151.17, 106.45]
const FLOWER_SEA_RADIUS = 30
const SUNFLOWER_RADIUS = 18
const DISC_Y = 0.5 // 高于绿地贴面(0.15),避免 z-fight

// 花田色(低饱和):春=油菜,夏=轮作草花,秋=秋英/菊调;冬不可见(占位)
const FLOWER_COLOR: Record<Season, string> = {
  spring: '#c2ab4a',
  summer: '#c98a94',
  autumn: '#c98f3d',
  winter: '#c2ab4a',
}
const SUNFLOWER_COLOR = '#d1a832'

function useDisc(radius: number): THREE.ShapeGeometry {
  return useMemo(() => {
    const shape = new THREE.Shape().absarc(0, 0, radius, 0, Math.PI * 2, false)
    const g = new THREE.ShapeGeometry(shape, 48)
    g.rotateX(-Math.PI / 2)
    return g
  }, [radius])
}

export default function SeasonController() {
  const season = useUIStore((s) => s.season)
  const palette = seasonPalette(season)
  const flowerGeom = useDisc(FLOWER_SEA_RADIUS)
  const sunflowerGeom = useDisc(SUNFLOWER_RADIUS)
  const flowerMat = useRef<THREE.MeshStandardMaterial>(null)
  const sunflowerMat = useRef<THREE.MeshStandardMaterial>(null)
  const flowerTarget = useMemo(() => new THREE.Color(FLOWER_COLOR[season]), [season])
  const sunflowerTarget = useMemo(() => new THREE.Color(SUNFLOWER_COLOR), [])

  // 初始色(首帧前写入,之后由 useFrame 渐变接管)
  useLayoutEffect(() => {
    const fm = flowerMat.current
    if (fm) {
      fm.color.set(FLOWER_COLOR[season])
      fm.emissive.set(FLOWER_COLOR[season])
    }
    const sm = sunflowerMat.current
    if (sm) {
      sm.color.set(SUNFLOWER_COLOR)
      sm.emissive.set(SUNFLOWER_COLOR)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 换季颜色约 2 秒收敛(指数趋近)
  useFrame((_state, delta) => {
    const k = Math.min(1, delta * 2)
    const fm = flowerMat.current
    if (fm) {
      fm.color.lerp(flowerTarget, k)
      fm.emissive.lerp(flowerTarget, k)
    }
    const sm = sunflowerMat.current
    if (sm) {
      sm.color.lerp(sunflowerTarget, k)
      sm.emissive.lerp(sunflowerTarget, k)
    }
  })

  return (
    <group>
      {/* 商大花海:春油菜 / 夏秋轮换花田,冬休耕 */}
      <mesh
        geometry={flowerGeom}
        position={[FLOWER_SEA_POS[0], DISC_Y, FLOWER_SEA_POS[1]]}
        visible={palette.flowerVisible}
      >
        <meshStandardMaterial ref={flowerMat} emissiveIntensity={0.25} roughness={0.95} />
      </mesh>
      {/* 向日葵地:夏/秋可见 */}
      <mesh
        geometry={sunflowerGeom}
        position={[SUNFLOWER_POS[0], DISC_Y, SUNFLOWER_POS[1]]}
        visible={palette.sunflowerVisible}
      >
        <meshStandardMaterial ref={sunflowerMat} emissiveIntensity={0.25} roughness={0.95} />
      </mesh>
    </group>
  )
}
