// 楼宇点按统一入口(双击快速剖切)
// 设计取舍:不用 R3F onDoubleClick —— 移动端浏览器不保证派发 dblclick,
// 且双指缩放与双击缩放在触屏上语义冲突。这里自实现 300ms 双击/双触点检测:
// 桌面 onClick 与移动单指 tap 在 R3F 里都走 onClick,天然统一两端。
// 交互语义(单击无延迟、无冲突):
//   单击 = 选中 + 相机聚焦(选中其他楼则退出旧楼剖切;选中同楼保留剖切)
//   双击 = 在选中基础上叠加剖切开关(已剖切该楼 → 收起;剖切他楼 → 平滑切换)
import type { BakedBuilding } from './campusData'
import { useCampusStore } from '../store/campusStore'

/** 双击判定窗口(ms):桌面双击与移动 double-tap 通用 */
const DOUBLE_TAP_MS = 300

let lastTapId: string | null = null
let lastTapAt = 0

export function tapBuilding(b: BakedBuilding): void {
  const s = useCampusStore.getState()
  const now = performance.now()
  const isDouble = lastTapId === b.id && now - lastTapAt < DOUBLE_TAP_MS
  lastTapId = b.id
  lastTapAt = now

  s.selectBuilding(b.id)
  s.focusCamera({ type: 'building', id: b.id })

  if (isDouble) {
    lastTapAt = 0 // 三连击不再连发,回到单击语义
    if (b.levels > 1) {
      s.setSlicedBuilding(s.slicedBuildingId === b.id ? null : b.id)
    }
    return
  }
  // 单击选中其他楼 → 退出旧楼剖切(同楼重复单击不清,剖切状态保留给双击收起)
  if (s.slicedBuildingId && s.slicedBuildingId !== b.id) s.setSlicedBuilding(null)
}
