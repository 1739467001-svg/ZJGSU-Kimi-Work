// 响应式断点 hook(前端兼容性改造):
//   ≤768px 手机 / 769–1024px 平板 / >1024px 桌面
// 断点与 index.css 中的媒体查询保持一致(max-width: 768px)。
import { useEffect, useState } from 'react'

/** 通用媒体查询订阅;SSR/无窗口环境按不匹配处理 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** ≤768px:手机 —— 工作台抽屉化、控件紧凑化、贴底卡片 */
export const useIsMobile = () => useMediaQuery('(max-width: 768px)')

/** 769–1024px:平板 —— 工作台隐藏左栏,改为侧边抽屉 */
export const useIsTablet = () =>
  useMediaQuery('(min-width: 769px) and (max-width: 1024px)')
