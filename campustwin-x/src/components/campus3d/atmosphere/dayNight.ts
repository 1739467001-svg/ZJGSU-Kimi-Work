// 昼夜配色插值助手(日光氛围改造)
// 约定:所有「白天态 ↔ 黑夜态」双色在此统一管理,消费方在 useFrame 内逐帧调用,
// 禁止双套场景/双套贴图;nightFactor 来自 WindowLights 共享值(0=白天,1=黑夜)。
import * as THREE from 'three'
import { getNightFactor } from './WindowLights'

/** target = day.lerp(night, getNightFactor()),逐帧调用零分配 */
export function applyDayNight(target: THREE.Color, day: THREE.Color, night: THREE.Color): void {
  target.copy(day).lerp(night, getNightFactor())
}

/** 当前 nightFactor 快照(useFrame 内读取) */
export function currentNightFactor(): number {
  return getNightFactor()
}
