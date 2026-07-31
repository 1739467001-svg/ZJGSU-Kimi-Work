// 数据契约:与 tools/etl/bake-geometry.mjs 的产物一一对应
export interface BakedBuilding {
  id: string
  name: string | null
  alias: string[]
  feature: string
  lod: number
  levels: number
  height: number
  hero: boolean
  zone: string
  footprint: [number, number][]
  center: [number, number]
}
export interface BakedRoad { id: string; name: string | null; kind: string; width: number; points: [number, number][] }
export interface BakedWater { id: string; name: string | null; kind: string; hero: boolean; ring: [number, number][]; center: [number, number] }
export interface BakedGreen { id: string; name: string | null; kind: string; ring: [number, number][] }
export interface BakedLandmark { id: string; name: string; kind: string; position: [number, number]; story?: string }
export type TreePoint = [number, number, number]

export interface CampusData {
  buildings: BakedBuilding[]
  roads: BakedRoad[]
  water: BakedWater[]
  green: BakedGreen[]
  trees: TreePoint[]
  landmarks: BakedLandmark[]
}

export async function loadCampusData(): Promise<CampusData> {
  const base = '/data/campus'
  const [b, r, w, g, t, l] = await Promise.all([
    fetch(`${base}/buildings.json`).then((r) => r.json()),
    fetch(`${base}/roads.json`).then((r) => r.json()),
    fetch(`${base}/water.json`).then((r) => r.json()),
    fetch(`${base}/green.json`).then((r) => r.json()),
    fetch(`${base}/trees.json`).then((r) => r.json()),
    fetch(`${base}/landmarks.json`).then((r) => r.json()),
  ])
  return {
    buildings: b.buildings,
    roads: r.roads,
    water: w.water,
    green: g.green,
    trees: t.trees,
    landmarks: l.landmarks,
  }
}

// 建筑功能 → 灰盒配色(低饱和,暗色沙盘基调)
export const FEATURE_COLOR: Record<string, string> = {
  teaching: '#8fa8bf',
  college: '#9db3a0',
  library: '#c8b284',
  admin: '#c49a6c',
  venue: '#a29a8e', // 原 #b18fb6 粉紫突兀,改浅暖灰贴合校园主调
  sport: '#7fb3b3',
  dorm: '#a89a8a',
  canteen: '#c4a27a',
  service: '#7a7a7a',
  unknown: '#8a8f94',
}
