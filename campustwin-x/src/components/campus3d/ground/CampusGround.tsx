import type { BakedGreen, BakedRoad, BakedWater } from '../../../lib/campusData'
import GroundPlate from './GroundPlate'
import GreenLayer from './GreenLayer'
import WaterSystem from './WaterSystem'
import RoadNetwork from './RoadNetwork'

/**
 * 地面系统组合(M2-D1):
 * GroundPlate(基座+教学区红线)→ GreenLayer(绿地)→ WaterSystem(水系)→ RoadNetwork(道路)
 * y 层级:基座 -1 → 绿地 0.15 → 水系 0.35 → 道路 0.55 → 红线轮廓 0.7
 */

export interface CampusGroundProps {
  water: BakedWater[]
  green: BakedGreen[]
  roads: BakedRoad[]
}

export default function CampusGround({ water, green, roads }: CampusGroundProps) {
  return (
    <group>
      <GroundPlate />
      <GreenLayer green={green} />
      <WaterSystem water={water} />
      <RoadNetwork roads={roads} />
    </group>
  )
}

// 供 FlowLines 等模块从组合入口直接取用道路中心线
export { roadCenterlines, buildRoadCenterlines, ROAD_SURFACE_Y } from './RoadNetwork'
