// 天气与四季组合件(M2):雾 + 雨雪粒子 + 四季花田,无 props,直接挂到 Canvas 内
// 集成方式:<WeatherFX /> 放入 CampusCanvas 的 <Canvas> 内(CampusCanvas.tsx 禁止本代理改动,由集成方挂载)
import FogController from './FogController'
import RainSnow from './RainSnow'
import SeasonController from './SeasonController'
import { useUIStore } from '../../../store/uiStore'

// 四季色板命名导出(植被模块从这里或 ./SeasonController 引入,本模块不反向依赖,防循环)
export { seasonPalette } from './SeasonController'
export type { SeasonPalette } from './SeasonController'

export default function WeatherFX() {
  const weather = useUIStore((s) => s.weather)
  // 懒加载评估结论(P3):RainSnow 模块本身极小,React.lazy 分包无收益;
  // 改为按天气条件挂载——晴/多云/雾天不建粒子缓冲、不进场景图,雨雪时挂载即初始化
  // (其 useLayoutEffect 首帧前布点 + useEffect 域对齐相机,切换无闪点)
  const precipitating = weather === 'rain' || weather === 'snow'
  return (
    <>
      <FogController />
      {precipitating && <RainSnow />}
      <SeasonController />
    </>
  )
}
