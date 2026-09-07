// 画质分档与自动降级(M2-D10 前置)
// 契约来源:src/store/uiStore.ts 的 Quality / autoQuality / setQuality / setAutoQuality
import { useCallback } from 'react'
import { useUIStore, type Quality } from '../store/uiStore'

/** 后处理档位:full = bloom + ssao;bloom = 仅 bloom;none = 无后处理 */
export type PostprocessTier = 'full' | 'bloom' | 'none'

export interface QualityPreset {
  quality: Quality
  /** 中文档位名(UI 展示) */
  label: string
  /** pixelRatio 上限;实际值 = min(devicePixelRatio, 上限) */
  pixelRatioCap: number
  /** 后处理档位(@react-three/postprocessing 映射) */
  postprocess: PostprocessTier
  bloom: boolean
  ssao: boolean
  shadows: boolean
  /** 场景细节缩放建议(树木/粒子密度系数,0..1) */
  detailScale: number
}

/** 三档配置表:高 = pixelRatio≤2 + bloom + ssao;中 = 1.5 + bloom;低 = 1 + 无后处理 */
export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  high: {
    quality: 'high', label: '高', pixelRatioCap: 2,
    postprocess: 'full', bloom: true, ssao: true, shadows: true, detailScale: 1,
  },
  medium: {
    quality: 'medium', label: '中', pixelRatioCap: 1.5,
    postprocess: 'bloom', bloom: true, ssao: false, shadows: true, detailScale: 0.7,
  },
  low: {
    quality: 'low', label: '低', pixelRatioCap: 1,
    postprocess: 'none', bloom: false, ssao: false, shadows: false, detailScale: 0.4,
  },
}

/** 降档顺序:high → medium → low */
export const QUALITY_ORDER: readonly Quality[] = ['high', 'medium', 'low']

export function getQualityPreset(q: Quality): QualityPreset {
  return QUALITY_PRESETS[q]
}

/** 下一更低档;已是 low 返回 null(无法再降) */
export function stepDownQuality(q: Quality): Quality | null {
  const i = QUALITY_ORDER.indexOf(q)
  return i >= 0 && i < QUALITY_ORDER.length - 1 ? QUALITY_ORDER[i + 1] : null
}

/** 移动端 UA 判定(画质降载用;响应式布局另走 useMediaQuery 断点) */
export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
}

/** 移动端 pixelRatio 硬封顶:无论档位,移动端不超过 1.5(桌面不受限,维持原值) */
const MOBILE_DPR_CAP = 1.5

/** 实际渲染 pixelRatio(受档位上限与设备 DPR 双重约束;移动端再叠加 1.5 硬顶) */
export function resolvePixelRatio(q: Quality): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1
  const cap = QUALITY_PRESETS[q].pixelRatioCap
  return Math.min(dpr, isMobileDevice() ? Math.min(cap, MOBILE_DPR_CAP) : cap)
}

interface NavigatorWithMemory extends Navigator {
  /** Chrome/Edge 特有;Firefox/Safari 无此字段 */
  deviceMemory?: number
}

/** 按设备内存 / 核数 / 移动端初选画质档(仅首屏建议,用户可随时手改) */
export function detectInitialQuality(): Quality {
  if (typeof navigator === 'undefined') return 'medium'
  const nav = navigator as NavigatorWithMemory
  const mem = nav.deviceMemory ?? 8
  const cores = nav.hardwareConcurrency ?? 8
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent)
  if (mobile || mem <= 4 || cores <= 4) return 'low'
  if (mem >= 8 && cores >= 8) return 'high'
  return 'medium'
}

export interface AutoQualityHandlers {
  /** autoQuality 开关状态;false 时 onDecline 为空操作 */
  enabled: boolean
  /** 直接传给 drei <PerformanceMonitor onDecline={...} /> */
  onDecline: () => void
}

/**
 * 自动降级 hook:配合 drei PerformanceMonitor 使用。
 * <PerformanceMonitor onDecline={useAutoQuality().onDecline} />
 * 仅当 uiStore.autoQuality === true 时降档;low 档后不再降。
 */
export function useAutoQuality(): AutoQualityHandlers {
  const autoQuality = useUIStore((s) => s.autoQuality)
  const setQuality = useUIStore((s) => s.setQuality)
  const onDecline = useCallback(() => {
    const { autoQuality: auto, quality } = useUIStore.getState()
    if (!auto) return
    const next = stepDownQuality(quality)
    if (next) setQuality(next)
  }, [setQuality])
  return { enabled: autoQuality, onDecline }
}
