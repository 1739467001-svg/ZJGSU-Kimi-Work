// 雾控制(手册 §4.4):scene.fog = FogExp2,密度按 uiStore.weather 2 秒线性插值
// fog=0.006 / cloudy=0.002 / clear=0.0008;rain/snow 取中间档(手册未定,取氛围值)
// 昼夜适配:雾色白天=明亮蓝白(融入天空),黑夜=原手册雾色 #9db3c8;
// 白天密度整体 ×0.75 提升通透感,黑夜保持原值不退化。插值均在 useFrame 内逐帧进行。
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { useUIStore } from '../../../store/uiStore'
import type { Weather } from '../../../store/uiStore'
import { applyDayNight, currentNightFactor } from '../atmosphere/dayNight'

const FOG_COLOR_DAY = new THREE.Color('#d9e5ec') // 白天:明亮蓝白,与晴空衔接
const FOG_COLOR_NIGHT = new THREE.Color('#9db3c8') // 黑夜:手册 §4.4 指定雾色(保持不变)
const FOG_DENSITY: Record<Weather, number> = {
  clear: 0.0003,
  cloudy: 0.001,
  rain: 0.0035,
  snow: 0.0028,
  fog: 0.006,
}
const LERP_SECONDS = 2

export default function FogController() {
  const weather = useUIStore((s) => s.weather)
  const fogRef = useRef<THREE.FogExp2>(null)
  // 插值状态:from → to,历时 LERP_SECONDS
  const trans = useRef({ from: FOG_DENSITY.clear, to: FOG_DENSITY.clear, t: LERP_SECONDS })

  useEffect(() => {
    const cur = fogRef.current?.density ?? FOG_DENSITY[weather]
    trans.current = { from: cur, to: FOG_DENSITY[weather], t: 0 }
  }, [weather])

  useFrame((_state, delta) => {
    const fog = fogRef.current
    if (!fog) return
    const tr = trans.current
    if (tr.t < LERP_SECONDS) {
      tr.t = Math.min(LERP_SECONDS, tr.t + delta)
    }
    const base = tr.from + (tr.to - tr.from) * (tr.t / LERP_SECONDS)
    const nf = currentNightFactor()
    // 白天降密度求通透,黑夜 ×1 维持原观感
    fog.density = base * THREE.MathUtils.lerp(0.75, 1, nf)
    applyDayNight(fog.color, FOG_COLOR_DAY, FOG_COLOR_NIGHT)
  })

  return <fogExp2 ref={fogRef} attach="fog" args={[FOG_COLOR_DAY.getStyle(), FOG_DENSITY.clear]} />
}
