import { useCallback, useMemo } from 'react'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import type { BakedBuilding, BakedLandmark } from '../../../lib/campusData'
import { useCampusStore } from '../../../store/campusStore'
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
  /** 点击 hero 楼 → 与灰盒楼同一选中语义(selectBuilding + 聚焦 + 清旧剖切,由 CampusCanvas 注入) */
  onSelect?: (b: BakedBuilding) => void
}

/**
 * L0 四大地标精模分发器(M2-D6/D7):
 * w1018218617 / w1018218618 → WentiCenter(主馆太阳花 / 副馆半圆拱)
 * w561932273                → ZongheBuilding(12 层圆塔 + 裙楼 + 金字塔)
 * w563533987                → Library(大板楼 + 临湖玻璃幕墙 + 名牌)
 * 无 building 的双门         → Gates(landmarks: gate_south 飞翔门 / gate_north 凯旋门)
 *
 * 点击支持(M5):每个 hero 组件外层包一个带 onClick 的 group,命中子网格即
 * 选中该楼(与灰盒楼同一 onSelect 语义,双击剖切见 lib/buildingTap)。
 * 信电楼自带 onClick 且 stopPropagation(内部走同一 tapBuilding 入口),
 * 包裹层处理器不会被触发。
 * 双门无 building 记录:点击 = 选中伪楼宇 id(gate_south/gate_north,
 * SelectedCard 据此显示简介卡)+ 退出旧剖切;不做相机聚焦(CameraDirector 无 landmark 聚焦)。
 */
export default function HeroBuildings({ buildings, landmarks, nightFactor, onSelect }: HeroBuildingsProps) {
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

  /** hero 楼点击:阻止冒泡(避免触发 Canvas onPointerMissed 的"点空白清空"),走统一选中语义 */
  const clickBuilding = useCallback(
    (b: BakedBuilding) => (e: ThreeEvent<MouseEvent>) => {
      e.stopPropagation()
      onSelect?.(b)
    },
    [onSelect],
  )

  /** 双门点击:选中伪楼宇 id + 退出旧剖切(与点其他楼清理剖切的语义一致)。
   *  Gates 内部两门的 group 命名为 gate-flying(南)/ gate-triumph(北),
   *  沿命中对象的祖先链判定点了哪一扇门。 */
  const clickGates = useCallback((e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    let gateId: string | null = null
    let o: THREE.Object3D | null = e.object
    while (o) {
      if (o.name === 'gate-flying') {
        gateId = HERO_GATE_IDS.south
        break
      }
      if (o.name === 'gate-triumph') {
        gateId = HERO_GATE_IDS.north
        break
      }
      o = o.parent
    }
    if (!gateId) return
    const s = useCampusStore.getState()
    s.selectBuilding(gateId)
    if (s.slicedBuildingId) s.setSlicedBuilding(null)
  }, [])

  return (
    <group name="hero-buildings">
      {wentiMain ? (
        <group onClick={clickBuilding(wentiMain)}>
          <WentiCenter building={wentiMain} nightFactor={nightFactor} />
        </group>
      ) : null}
      {wentiAnnex ? (
        <group onClick={clickBuilding(wentiAnnex)}>
          <WentiCenter building={wentiAnnex} nightFactor={nightFactor} />
        </group>
      ) : null}
      {zonghe ? (
        <group onClick={clickBuilding(zonghe)}>
          <ZongheBuilding building={zonghe} nightFactor={nightFactor} />
        </group>
      ) : null}
      {library ? (
        <group onClick={clickBuilding(library)}>
          <Library building={library} nightFactor={nightFactor} />
        </group>
      ) : null}
      {xindian ? (
        <group onClick={clickBuilding(xindian)}>
          <XindianBuilding building={xindian} nightFactor={nightFactor} />
        </group>
      ) : null}
      <group onClick={clickGates}>
        <Gates landmarks={landmarks} nightFactor={nightFactor} />
      </group>
    </group>
  )
}
