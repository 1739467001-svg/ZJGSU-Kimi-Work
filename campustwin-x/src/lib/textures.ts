// 程序化立面贴图管线(M2-D2)—— 断网红线:全部 CanvasTexture 本地生成,零外部资源
// 日景 map + 夜景 emissiveMap 成对生成,按 (feature, levels) 缓存复用
import * as THREE from 'three'
import { FEATURE_COLOR } from './campusData'

export const FACADE_SIZE = 512
/** 立面贴图水平重复跨度(米):侧面 UV 的 u 除以该值后平铺 */
export const FACADE_TILE_METERS = 24
/** 每个水平重复跨度内的窗格列数(≈3m 一跨) */
export const FACADE_COLS = 8
/** 名义层高(米):合批楼(高度不一)纵向平铺时按 levels × FLOOR_HEIGHT 为重复单元 */
export const FLOOR_HEIGHT = 3.2
/** 夜景点亮窗格比例(种子固定) */
export const NIGHT_LIT_RATIO = 0.4

// ---------- 确定性随机(种子固定,刷新不变) ----------
function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------- 颜色工具 ----------
interface RGB {
  r: number
  g: number
  b: number
}

function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  const v = m ? parseInt(m[1], 16) : 0x8a8f94
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff }
}

function rgbToCss({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
  return `rgb(${c(r)},${c(g)},${c(b)})`
}

function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** k<1 变暗,k>1 变亮 */
function shade(hex: string, k: number): string {
  const c = hexToRgb(hex)
  return rgbToCss({ r: c.r * k, g: c.g * k, b: c.b * k })
}

/**
 * 日光提亮(日光氛围改造):把 feature 基色向暖白真石漆目标色混合,
 * 得到白天米白/浅灰、低饱和暖调的立面观感;feature 仅保留微弱色相区分。
 * 夜态不做双套贴图:夜景观感由光照压暗 + emissiveMap 窗灯承担,缓存键不变。
 * 目标色 #ece7db→#e7e0d2:基色亮度降约 4%,正午 ACES 下白色立面保留高光余量不过曝。
 */
function liftForDaylight(hex: string, mix: number, target = '#e7e0d2'): string {
  const c = hexToRgb(hex)
  const w = hexToRgb(target)
  return rgbToHex({
    r: c.r * (1 - mix) + w.r * mix,
    g: c.g * (1 - mix) + w.g * mix,
    b: c.b * (1 - mix) + w.b * mix,
  })
}

function featureColor(feature: string): string {
  return FEATURE_COLOR[feature] ?? FEATURE_COLOR.unknown
}

/** 立面底色(贴图基色):米白真石漆为底、微染 feature 色相 */
export function facadeBaseColor(feature: string): string {
  return liftForDaylight(featureColor(feature), 0.58)
}

/** 顶面纯色:低饱和灰蓝,白天提亮不死黑、夜光下不泛白(CampusBuildings 顶面材质无昼夜驱动,取折中) */
export function roofColor(feature: string): string {
  // 目标色 #9d968a→#97a0aa:屋面由暖灰改灰蓝并整体提亮,修正白天屋面死黑
  return liftForDaylight(featureColor(feature), 0.5, '#97a0aa')
}

// ---------- 贴图绘制 ----------
export interface FacadeTexturePair {
  /** 日景:底色 + 窗格阵列(行列随 levels 参数化) */
  day: THREE.CanvasTexture
  /** 夜景 emissive:黑底,约 40% 窗格暖黄点亮(种子固定) */
  night: THREE.CanvasTexture
}

function drawFacade(ctx: CanvasRenderingContext2D, feature: string, levels: number, cols: number, rng: () => number): void {
  const S = FACADE_SIZE
  const base = facadeBaseColor(feature) // 日光化米白基色
  ctx.fillStyle = base
  ctx.fillRect(0, 0, S, S)

  const rows = Math.max(1, levels)
  const cw = S / cols
  const ch = S / rows
  // 玻璃色(白天反射天光的浅蓝灰,随 feature 微染;夜态由 emissiveMap 窗灯点亮)
  const glass = hexToRgb('#7f95a4')
  const tint = hexToRgb(base)

  for (let r = 0; r < rows; r++) {
    // 层间楼板横带
    ctx.fillStyle = shade(base, 0.78)
    ctx.fillRect(0, r * ch, S, Math.max(2, ch * 0.14))
    for (let c = 0; c < cols; c++) {
      // 窗洞(略深) + 玻璃(亮度微抖动,种子固定)
      const j = 0.85 + rng() * 0.3
      const x = c * cw + cw * 0.16
      const y = r * ch + ch * 0.26
      const w = cw * 0.68
      const h = ch * 0.56
      ctx.fillStyle = shade(base, 0.62)
      ctx.fillRect(x - 1.5, y - 1.5, w + 3, h + 3)
      ctx.fillStyle = rgbToCss({
        r: glass.r * j + tint.r * 0.06,
        g: glass.g * j + tint.g * 0.06,
        b: glass.b * j + tint.b * 0.08,
      })
      ctx.fillRect(x, y, w, h)
      // 竖向中梃
      ctx.fillStyle = shade(base, 0.68)
      ctx.fillRect(x + w / 2 - 0.75, y, 1.5, h)
    }
  }
}

function drawFacadeNight(ctx: CanvasRenderingContext2D, levels: number, cols: number, rng: () => number): void {
  const S = FACADE_SIZE
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, S, S)
  const rows = Math.max(1, levels)
  const cw = S / cols
  const ch = S / rows
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (rng() >= NIGHT_LIT_RATIO) continue
      // 暖黄点亮,色温/亮度微抖动(种子固定)
      const warm = 0.8 + rng() * 0.35
      const amber = rng() < 0.25
      ctx.fillStyle = rgbToCss(
        amber
          ? { r: 255 * warm, g: 176 * warm, b: 84 * warm }
          : { r: 255 * warm, g: 208 * warm, b: 138 * warm },
      )
      ctx.fillRect(c * cw + cw * 0.16, r * ch + ch * 0.26, cw * 0.68, ch * 0.56)
    }
  }
}

function makeCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = FACADE_SIZE
  canvas.height = FACADE_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('textures: 2d context unavailable')
  return { canvas, ctx }
}

function finalize(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

const cache = new Map<string, FacadeTexturePair>()

/**
 * 取某类功能、某层数的立面对贴图(日景 + 夜景 emissive)。
 * 约定:调用方把侧面 UV 归一化到「一个贴图重复单元 = FACADE_TILE_METERS 米宽 × levels × FLOOR_HEIGHT 米高」
 * (或整楼高度),本贴图以 repeat=(1,1) + RepeatWrapping 使用,全楼共享同一 GPU 纹理。
 */
export function getFacadeTextures(feature: string, levels: number): FacadeTexturePair {
  const f = FEATURE_COLOR[feature] ? feature : 'unknown'
  const lv = Math.max(1, Math.round(levels))
  const key = `${f}|${lv}`
  const hit = cache.get(key)
  if (hit) return hit

  // 日景与夜景用同一种子序列的不同偏移,保证同一 (feature, levels) 下窗格对齐
  const seed = hashString(key)
  const day = makeCanvas()
  drawFacade(day.ctx, f, lv, FACADE_COLS, mulberry32(seed ^ 0x9e3779b9))
  const night = makeCanvas()
  drawFacadeNight(night.ctx, lv, FACADE_COLS, mulberry32(seed ^ 0x85ebca6b))

  const pair: FacadeTexturePair = { day: finalize(day.canvas), night: finalize(night.canvas) }
  cache.set(key, pair)
  return pair
}
