// 天气与四季组合件(M2):雾 + 雨雪粒子 + 四季花田,无 props,直接挂到 Canvas 内
// 集成方式:<WeatherFX /> 放入 CampusCanvas 的 <Canvas> 内(CampusCanvas.tsx 禁止本代理改动,由集成方挂载)
import FogController from './FogController'
import RainSnow from './RainSnow'
import SeasonController from './SeasonController'

// 四季色板命名导出(植被模块从这里或 ./SeasonController 引入,本模块不反向依赖,防循环)
export { seasonPalette } from './SeasonController'
export type { SeasonPalette } from './SeasonController'

export default function WeatherFX() {
  return (
    <>
      <FogController />
      <RainSnow />
      <SeasonController />
    </>
  )
}
