// 桌面端侧边栏开合状态,localStorage 持久化(刷新后保持)。
// 键名:ctx.sidebar.left / ctx.sidebar.right;默认展开(无记录或值非 '1' 即展开)。
import { useCallback, useState } from 'react'

export type SidebarSide = 'left' | 'right'

const keyOf = (side: SidebarSide) => `ctx.sidebar.${side}`

/** 返回 [是否收起, 设置函数];localStorage 不可用(隐私模式等)时退化为内存态 */
export function useSidebarCollapsed(side: SidebarSide) {
  const key = keyOf(side)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  const set = useCallback(
    (v: boolean) => {
      setCollapsed(v)
      try {
        window.localStorage.setItem(key, v ? '1' : '0')
      } catch {
        /* 写失败仅保持内存态,不影响本次会话使用 */
      }
    },
    [key],
  )
  return [collapsed, set] as const
}
