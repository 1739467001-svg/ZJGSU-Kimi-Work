import { useMemo } from 'react'
import type { BakedBuilding, BakedLandmark } from '../../../lib/campusData'
import WentiCenter, { WENTI_ANNEX_ID, WENTI_MAIN_ID } from './WentiCenter'
import ZongheBuilding, { ZONGHE_ID } from './ZongheBuilding'
import Library, { LIBRARY_ID } from './Library'
import XindianBuilding, { XINDIAN_ID } from './XindianBuilding'
import Gates from './Gates'

/** 四大地标统一 props(任务契约) */
export interface HeroBuildingProps {
  building: BakedBuilding
  /** 0 = 白天,1 = 夜晚;驱动窗灯 / 幕墙流光 / 檐口灯 */
  nightFactor: number
}

/** L0/L1 精模接管的建筑 id —— 集成时灰盒 Buildings 应据此剔除同名灰盒,避免与精模重叠 */
export const HERO_BUILDING_IDS: readonly string[] = [
  WENTI_MAIN_ID,
  WENTI_ANNEX_ID,
  ZONGHE_ID,
  LIBRARY_ID,
  XINDIAN_ID,
]

/** 双门使用的 landmark id(gates 无 building,取 landmarks position) */
export const HERO_GATE_IDS = { south: 'gate_south', north: 'gate_north' } as const

interface HeroBuildingsProps {
  buildings: BakedBuilding[]
  landmarks: BakedLandmark[]
  nightFactor: number
}

/**
 * L0 四大地标精模分发器(M2-D6/D7):
 * w1018218617 / w1018218618 → WentiCenter(主馆太阳花 / 副馆半圆拱)
 * w561932273                → ZongheBuilding(12 层圆塔 + 裙楼 + 金字塔)
 * w563533987                → Library(大板楼 + 临湖玻璃幕墙 + 名牌)
 * 无 building 的双门         → Gates(landmarks: gate_south 飞翔门 / gate_north 凯旋门)
 */
export default function HeroBuildings({ buildings, landmarks, nightFactor }: HeroBuildingsProps) {
  const byId = useMemo(() => {
    const m = new Map<string, BakedBuilding>()
    for (const b of buildings) m.set(b.id, b)
    return m
  }, [buildings])
  const wentiMain = byId.get(WENTI_MAIN_ID)
  const wentiAnnex = byId.get(WENTI_ANNEX_ID)
  const zonghe = byId.get(ZONGHE_ID)
  const library = byId.get(LIBRARY_ID)
  const xindian = byId.get(XINDIAN_ID)
  return (
    <group name="hero-buildings">
      {wentiMain ? <WentiCenter building={wentiMain} nightFactor={nightFactor} /> : null}
      {wentiAnnex ? <WentiCenter building={wentiAnnex} nightFactor={nightFactor} /> : null}
      {zonghe ? <ZongheBuilding building={zonghe} nightFactor={nightFactor} /> : null}
      {library ? <Library building={library} nightFactor={nightFactor} /> : null}
      {xindian ? <XindianBuilding building={xindian} nightFactor={nightFactor} /> : null}
      <Gates landmarks={landmarks} nightFactor={nightFactor} />
    </group>
  )
}
