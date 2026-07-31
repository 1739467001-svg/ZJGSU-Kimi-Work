// 昼夜氛围组合件:无 props,读 simStore(时间)/ uiStore(画质)。
// 由 CampusCanvas 集成方挂载于 <Canvas> 内即可;挂载后全局 nightFactor 每帧自动更新,
// 楼宇材质等可通过 useNightFactor()/getNightFactor() 消费(见 WindowLights.tsx)。
import { useUIStore } from '../../../store/uiStore'
import { useNightFactor } from './WindowLights'
import SkyRig from './SkyRig'
import StreetLights from './StreetLights'

const STAR_COUNT = { high: 6000, medium: 4000, low: 2000 } as const

export default function Atmosphere() {
  const quality = useUIStore((s) => s.quality)
  useNightFactor() // 驱动共享 nightFactor 逐帧更新(供楼体窗灯材质等读取)
  return (
    <group>
      <SkyRig starCount={STAR_COUNT[quality]} />
      <StreetLights />
    </group>
  )
}
