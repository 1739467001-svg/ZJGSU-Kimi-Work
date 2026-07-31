// 窗灯解耦模块:不新增几何,只维护全局 nightFactor 供楼宇材质等消费。
// - useNightFactor(): 在 Canvas 内挂载一次(Atmosphere 已挂),useFrame 内每帧刷新共享值;
//   返回当前渲染时刻的快照值,可用于渲染期材质参数。
// - getNightFactor(): 非 hook,供任何 useFrame 回调内逐帧读取最新值(零重渲染)。
// - useNightFactorLive(): nightFactor 变化超过 step 才 setState 驱动重渲染,
//   供需要把 nf 作为 React prop 逐层下传的场景根组件使用(昼/夜稳定期零重渲染)。
import { useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSimStore } from '../../../store/simStore'
import { nightFactor } from '../../../lib/sun'

const shared = { value: 0 }

/** 任意 useFrame / 事件回调内读取最新 nightFactor(0=白天,1=黑夜) */
export function getNightFactor(): number {
  return shared.value
}

/** 挂载后每帧根据 simStore.simClock.nowMs 更新共享 nightFactor;返回当前值快照 */
export function useNightFactor(): number {
  useFrame(() => {
    shared.value = nightFactor(new Date(useSimStore.getState().simClock.nowMs))
  })
  return shared.value
}

/**
 * nightFactor 作为 prop 下传时的活性 hook:仅在变化超过 step(默认 0.02)时重渲染。
 * 避免 useNightFactor() 快照在组件挂载后固化,导致窗灯/檐口灯等夜态永远不亮。
 */
export function useNightFactorLive(step = 0.02): number {
  const [nf, setNf] = useState(shared.value)
  useFrame(() => {
    const v = shared.value
    if (Math.abs(v - nf) >= step) setNf(v)
  })
  return nf
}
