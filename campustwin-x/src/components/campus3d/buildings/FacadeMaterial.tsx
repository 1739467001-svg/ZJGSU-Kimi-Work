// 立面材质封装:map=日景窗格,emissiveMap=夜景窗灯,emissiveIntensity 由 nightFactor(0-1)驱动
// 贴图来自 textures.ts 的 (feature, levels) 缓存,全楼共享 GPU 纹理,不克隆
import { getFacadeTextures } from '../../../lib/textures'

export interface FacadeMaterialProps {
  /** campusData feature(teaching/dorm/…),未知传 'unknown' */
  feature: string
  /** 楼层数:决定贴图窗格行数;调用方须保证侧面 UV 纵向已按 levels 归一 */
  levels: number
  /** 0=白天,1=全夜;驱动 emissiveIntensity(窗灯渐亮) */
  nightFactor: number
  /** 叠色:选中金 #e8b84b / 告警红 #ff3b30;缺省纯白(贴图原色) */
  tint?: string
  /** R3F 材质挂点,材质数组时用 'material-1'(group 1=侧面) */
  attach?: string
}

export default function FacadeMaterial({ feature, levels, nightFactor, tint, attach }: FacadeMaterialProps) {
  const { day, night } = getFacadeTextures(feature, levels)
  const nf = Math.max(0, Math.min(1, nightFactor))
  return (
    <meshStandardMaterial
      attach={attach}
      map={day}
      emissiveMap={night}
      emissive="#ffffff"
      emissiveIntensity={nf}
      color={tint ?? '#ffffff'}
      roughness={0.8}
      metalness={0.08}
    />
  )
}
