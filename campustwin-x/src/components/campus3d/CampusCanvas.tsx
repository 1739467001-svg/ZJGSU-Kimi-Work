// 场景总装(M1+M2 集成):
// 地面/楼宇/地标/植被/名牌 + 昼夜/天气 + 指挥特效五件套 + 人流/车流 + 剖层
// + 运镜仲裁 + 画质分档(像素比/后处理/自动降级)。
// 注意:Atmosphere 自带太阳/半球光,此处不再挂任何旧光源,避免双倍照明。
import { Suspense, useMemo, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerformanceMonitor } from '@react-three/drei'
import { EffectComposer, Bloom, SSAO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BakedBuilding, CampusData } from '../../lib/campusData'
import { useCampusStore } from '../../store/campusStore'
import { useUIStore } from '../../store/uiStore'
import { getQualityPreset, resolvePixelRatio, useAutoQuality } from '../../lib/quality'
import CampusGround from './ground/CampusGround'
import CampusBuildings from './buildings/CampusBuildings'
import HeroBuildings, { HERO_BUILDING_IDS } from './hero/HeroBuildings'
import Atmosphere from './atmosphere/Atmosphere'
import { useNightFactorLive } from './atmosphere/WindowLights'
import WeatherFX from './weather/WeatherFX'
import Vegetation from './vegetation/Vegetation'
import SceneLabels from './labels/SceneLabels'
import CameraRig from './camera/CameraRig'
import ScanLine from './effects/ScanLine'
import HeatLayer from './effects/HeatLayer'
import AlarmPulse from './effects/AlarmPulse'
import StatusLightBand from './effects/StatusLightBand'
import FlowLines from './effects/FlowLines'
import CrowdSim from './effects/CrowdSim'
import BuildingSlice from './effects/BuildingSlice'
import Clouds from './atmosphere/Clouds'
import Birds from './effects/Birds'
import Flags from './effects/Flags'

const HERO_SET = new Set<string>(HERO_BUILDING_IDS)

function SceneContent({ data }: { data: CampusData }) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null)
  const nightFactor = useNightFactorLive()
  const { onDecline } = useAutoQuality()
  const quality = useUIStore((s) => s.quality)
  const preset = getQualityPreset(quality)

  const selectedId = useCampusStore((s) => s.selectedBuildingId)
  const highlightedIds = useCampusStore((s) => s.highlightedBuildingIds)
  const alarmId = useCampusStore((s) => s.alarmBuildingId)
  const slicedId = useCampusStore((s) => s.slicedBuildingId)
  const selectBuilding = useCampusStore((s) => s.selectBuilding)
  const focusCamera = useCampusStore((s) => s.focusCamera)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)

  // 剖层期间隐藏原楼(BuildingSlice 自绘剖层视图);hero 楼从灰盒渲染中剔除,避免与精模重叠
  const visible = useMemo(
    () => (slicedId ? data.buildings.filter((b) => b.id !== slicedId) : data.buildings),
    [data.buildings, slicedId],
  )
  const graybox = useMemo(() => visible.filter((b) => !HERO_SET.has(b.id)), [visible])

  const onSelect = (b: BakedBuilding) => {
    selectBuilding(b.id)
    focusCamera({ type: 'building', id: b.id })
    // 切换选中其他楼(灰盒或 hero 精模)即退出旧楼的分层视图
    if (slicedId) setSlicedBuilding(null)
  }

  return (
    <>
      {/* 昼夜:太阳/月光 + 半球光 + Sky/Stars + 路灯(nightFactor 每帧共享) */}
      <Atmosphere />
      {/* 天气:雾 + 雨雪粒子 + 四季 */}
      <WeatherFX />

      {/* 地面系统:基座 → 绿地 → 水系 → 道路 */}
      <CampusGround water={data.water} green={data.green} roads={data.roads} />
      {/* 灰盒楼群(实名独立 Mesh + 未命名合批;hero 已剔除) */}
      <CampusBuildings
        buildings={graybox}
        selectedId={selectedId}
        highlightedIds={highlightedIds}
        alarmId={alarmId}
        nightFactor={nightFactor}
        onSelect={onSelect}
      />
      {/* L0 地标精模:文体中心 / 综合大楼 / 图书馆 / 信电楼 / 双门(均可点击选中) */}
      <HeroBuildings
        buildings={visible}
        landmarks={data.landmarks}
        nightFactor={nightFactor}
        onSelect={onSelect}
      />
      {/* 植被 + 楼名名牌 */}
      <Vegetation points={data.trees} />
      <SceneLabels buildings={visible} />

      {/* 指挥特效:扫描光 / 热力层 / 告警脉冲 / 楼顶灯带 / 车流光带 / 潮汐人流 / 剖层 */}
      <ScanLine />
      <HeatLayer buildings={data.buildings} />
      <AlarmPulse buildings={data.buildings} />
      <StatusLightBand buildings={visible} />
      <FlowLines roads={data.roads} />
      <CrowdSim buildings={data.buildings} landmarks={data.landmarks} />
      <BuildingSlice buildings={data.buildings} />

      {/* 场景生命力(任务E):流动云层 + 飞鸟群 + 广场/南门旗帜(只追加,不改上方挂载) */}
      <Clouds />
      <Birds />
      <Flags landmarks={data.landmarks} />

      {/* 运镜:首屏 → 导演 → 巡航,用户输入随时夺回控制权 */}
      <CameraRig controlsRef={controlsRef} />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        target={[40, 0, -80]}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={80}
        maxDistance={2200}
        enableDamping
        dampingFactor={0.08}
      />

      <PerformanceMonitor onDecline={onDecline} />

      {/* 后处理按档:full = Bloom + SSAO;bloom = 仅 Bloom;none = 无 */}
      {preset.postprocess === 'full' ? (
        <EffectComposer key="full">
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.15} mipmapBlur />
          <SSAO samples={16} radius={0.09} intensity={20} luminanceInfluence={0.5} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : preset.postprocess === 'bloom' ? (
        <EffectComposer key="bloom">
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.15} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
      ) : null}
    </>
  )
}

export default function CampusCanvas({ data }: { data: CampusData }) {
  const quality = useUIStore((s) => s.quality)
  const selectBuilding = useCampusStore((s) => s.selectBuilding)
  const setSlicedBuilding = useCampusStore((s) => s.setSlicedBuilding)
  return (
    <Canvas
      dpr={resolvePixelRatio(quality)}
      camera={{ position: [420, 480, 620], fov: 42, near: 1, far: 6000 }}
      onPointerMissed={() => {
        selectBuilding(null)
        setSlicedBuilding(null) // 点击空白处退出选中与分层视图
      }}
      style={{ background: '#0e1114' }}
    >
      <Suspense fallback={null}>
        <SceneContent data={data} />
      </Suspense>
    </Canvas>
  )
}
