// M2-D3 植被入口:当前只含树木,后续花海/灌木等同属本目录,由本组件统一挂载
import type { TreePoint } from '../../../lib/campusData'
import type { SeasonPalette } from './Trees'
import Trees from './Trees'

export interface VegetationProps {
  /** trees.json 点位 [x, z, scale] */
  points: TreePoint[]
  /** 可选:weather/SeasonController 的四季色板注入 */
  palette?: Partial<SeasonPalette>
}

export default function Vegetation({ points, palette }: VegetationProps) {
  return <Trees points={points} palette={palette} />
}

export { Trees }
export type { TreesProps, SeasonPalette } from './Trees'
