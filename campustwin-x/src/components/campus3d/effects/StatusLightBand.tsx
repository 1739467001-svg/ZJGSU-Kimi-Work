import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { BakedBuilding } from '../../../lib/campusData'
import { useCampusStore } from '../../../store/campusStore'
import { useSimStore } from '../../../store/simStore'
import { currentNightFactor } from '../atmosphere/dayNight'

const BAND_THICK = 0.5
const BAND_HEIGHT = 0.7
const BAND_LIFT = 0.4
const ALARM_COLOR = new THREE.Color('#ff3b30')

/** 占用率配色:空闲绿 → 金 → 热力橙红 */
const FREE = new THREE.Color('#3fd08c')
const BUSY = new THREE.Color('#e8b84b')
const FULL = new THREE.Color('#ff5a36')

function occupancyColor(v: number, hasData: boolean, out: THREE.Color): THREE.Color {
  const x = THREE.MathUtils.clamp(v, 0, 1)
  if (x < 0.6) out.lerpColors(FREE, BUSY, x / 0.6)
  else out.lerpColors(BUSY, FULL, (x - 0.6) / 0.4)
  if (!hasData) out.multiplyScalar(0.45)
  return out
}

interface BandGeometry {
  geometry: THREE.BufferGeometry
  /** buildingId → 合并网格中的顶点区间 */
  ranges: Map<string, [number, number][]>
  ids: string[]
}

function buildBands(buildings: BakedBuilding[]): BandGeometry | null {
  const targets = buildings.filter((b) => b.name && b.lod >= 1)
  if (targets.length === 0) return null
  const geoms: THREE.BufferGeometry[] = []
  const ranges = new Map<string, [number, number][]>()
  let offset = 0

  for (const b of targets) {
    let minX = Infinity
    let maxX = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (const [x, z] of b.footprint) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const w = maxX - minX
    const d = maxZ - minZ
    const y = b.height + BAND_LIFT
    const parts: { size: [number, number, number]; pos: [number, number, number] }[] = [
      { size: [w + BAND_THICK * 2, BAND_HEIGHT, BAND_THICK], pos: [(minX + maxX) / 2, y, minZ - BAND_THICK / 2] },
      { size: [w + BAND_THICK * 2, BAND_HEIGHT, BAND_THICK], pos: [(minX + maxX) / 2, y, maxZ + BAND_THICK / 2] },
      { size: [BAND_THICK, BAND_HEIGHT, d], pos: [minX - BAND_THICK / 2, y, (minZ + maxZ) / 2] },
      { size: [BAND_THICK, BAND_HEIGHT, d], pos: [maxX + BAND_THICK / 2, y, (minZ + maxZ) / 2] },
    ]
    const list: [number, number][] = []
    for (const p of parts) {
      const g = new THREE.BoxGeometry(...p.size)
      g.translate(...p.pos)
      const count = g.attributes.position.count
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
      geoms.push(g)
      list.push([offset, count])
      offset += count
    }
    ranges.set(b.id, list)
  }
  const merged = mergeGeometries(geoms, false)
  geoms.forEach((g) => g.dispose())
  if (!merged) return null
  return { geometry: merged, ranges, ids: targets.map((b) => b.id) }
}

interface Props {
  buildings: BakedBuilding[]
}

/**
 * 楼顶灯带:L1+ 实名楼顶部一圈薄 box 灯带,颜色随 simStore.buildingOccupancy
 * (空闲绿→金→橙红,无数据降亮度);campusStore.alarmBuildingId 命中时该楼灯带红色脉冲
 * (AlarmPulse 的"灯带段染色"联动)。全部楼合并为单一网格,1 DrawCall。
 * 昼夜:灯带是指挥中心夜态元素,白天随 nightFactor 淡出至 10% 微痕(与 GroundPlate
 * 红线同款处理),避免日景真实模式下屋顶出现金/绿色"描边"错觉;夜晚恢复全亮。
 */
export default function StatusLightBand({ buildings }: Props) {
  const buildingOccupancy = useSimStore((s) => s.buildingOccupancy)
  const alarmBuildingId = useCampusStore((s) => s.alarmBuildingId)
  const meshRef = useRef<THREE.Mesh | null>(null)
  const matRef = useRef<THREE.MeshBasicMaterial | null>(null)

  const band = useMemo(() => buildBands(buildings), [buildings])
  useEffect(() => () => band?.geometry.dispose(), [band])

  /** 按占用率重刷基础色 */
  const repaint = useMemo(() => {
    return () => {
      const mesh = meshRef.current
      if (!mesh || !band) return
      const attr = band.geometry.attributes.color as THREE.BufferAttribute
      const arr = attr.array as Float32Array
      const c = new THREE.Color()
      for (const [id, list] of band.ranges) {
        const raw = buildingOccupancy[id]
        occupancyColor(raw ?? 0, raw !== undefined, c)
        for (const [start, count] of list) {
          for (let i = 0; i < count; i++) {
            arr[(start + i) * 3] = c.r
            arr[(start + i) * 3 + 1] = c.g
            arr[(start + i) * 3 + 2] = c.b
          }
        }
      }
      attr.needsUpdate = true
    }
  }, [band, buildingOccupancy])

  // 占用数据 / 告警目标变化 → 重刷基础色(同时把告警楼复位,交由 useFrame 覆盖)
  useEffect(() => {
    repaint()
  }, [repaint, alarmBuildingId])

  // 昼夜淡出 + 告警楼灯带红色呼吸(sin(t×4) 与 AlarmPulse 同频)
  useFrame(({ clock }) => {
    // 白天淡出至 10% 微痕,夜晚全亮(告警脉冲叠加在顶点色上,不透明度同步缩放)
    if (matRef.current) {
      matRef.current.opacity = 0.95 * (0.1 + 0.9 * currentNightFactor())
    }
    if (!alarmBuildingId || !band || !meshRef.current) return
    const list = band.ranges.get(alarmBuildingId)
    if (!list) return
    const k = 0.55 + 0.45 * Math.sin(clock.elapsedTime * 4)
    const attr = band.geometry.attributes.color as THREE.BufferAttribute
    const arr = attr.array as Float32Array
    for (const [start, count] of list) {
      for (let i = 0; i < count; i++) {
        arr[(start + i) * 3] = ALARM_COLOR.r * k
        arr[(start + i) * 3 + 1] = ALARM_COLOR.g * k
        arr[(start + i) * 3 + 2] = ALARM_COLOR.b * k
      }
    }
    attr.needsUpdate = true
  })

  if (!band) return null
  return (
    <mesh geometry={band.geometry} ref={meshRef}>
      <meshBasicMaterial ref={matRef} vertexColors transparent opacity={0.95} toneMapped={false} />
    </mesh>
  )
}
