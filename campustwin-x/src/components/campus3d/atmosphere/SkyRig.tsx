// 天空照明装置:太阳/月光平行光 + 半球环境光 + 白天 Sky + 夜晚 Stars(渐入渐出)
// 黄昏过渡由 nightFactor(高度角 0°→-6° ≈ 20 分钟)统一驱动,全部在 useFrame 内逐帧插值。
// 另设 goldenGlow(高度角 -6°~+6°,日出/日落对称):强化太阳仍在地平线上时的
// golden hour 暖色地平线(rayleigh/浊度/mie/太阳色温),正午与深夜两端不受影响。
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { Sky, Stars } from '@react-three/drei'
import { useSimStore } from '../../../store/simStore'
import { nightFactor, sunAltitudeDeg, sunDirection } from '../../../lib/sun'

const SUN_HIGH = new THREE.Color('#fff4e2') // 正午日光
const SUN_LOW = new THREE.Color('#ff9a5c') // 黄昏低角度暖色
const MOON = new THREE.Color('#7e97c4') // 夜间冷色微光
// 白天半球光:明亮蓝天 + 暖灰地面反照(原 #9db8cc/#4a4238 偏阴,压暗了日景)
// #bcd6e8→#b7d4ec:天空反照更蓝一点,白色立面带上轻微冷蓝天光,日景更通透
const HEMI_SKY_DAY = new THREE.Color('#b7d4ec')
const HEMI_SKY_NIGHT = new THREE.Color('#16202e')
const HEMI_GND_DAY = new THREE.Color('#8f8875')
const HEMI_GND_NIGHT = new THREE.Color('#0e1218')
// Sky 散射参数昼夜端点:白天低浊度 + 高 rayleigh = 蔚蓝通透;夜晚维持原指挥中心基调
const SKY_TURBIDITY_DAY = 2.0 // 2.6→2.0:浊度更低,正午天空更清澈、减少灰白霾感
const SKY_TURBIDITY_NIGHT = 6.5
const SKY_MIE_DAY = 0.001
const SKY_MIE_NIGHT = 0.004
const SKY_RAYLEIGH_DAY = 3.2 // 2.5→3.2:增强瑞利散射,天顶蓝色更饱和(夏日正午湛蓝)
const SKY_RAYLEIGH_NIGHT = 1.8
// 白天 Sky 曝光系数(夜晚恒 1.0,不改变原夜景天空)
// 0.55→0.45:配合更高 rayleigh 压低 ACES 下的整体亮度,防止天空发白、恢复蓝色饱和度
const SKY_EXPOSURE_DAY = 0.45

const tmpDir = new THREE.Vector3()
const tmpColor = new THREE.Color()

export default function SkyRig({ starCount = 4000 }: { starCount?: number }) {
  const sunRef = useRef<THREE.DirectionalLight>(null)
  const hemiRef = useRef<THREE.HemisphereLight>(null)
  const skyRef = useRef<THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>>(null)
  const starsRef = useRef<THREE.Points>(null)

  // drei Stars 的 StarfieldMaterial 无全局透明度,注入 globalFade uniform 实现星空渐入渐出
  useEffect(() => {
    const pts = starsRef.current
    if (!pts) return
    const mat = pts.material
    if (mat instanceof THREE.ShaderMaterial && !('globalFade' in mat.uniforms)) {
      mat.uniforms.globalFade = { value: 0 }
      mat.fragmentShader = mat.fragmentShader
        .replace('uniform float fade;', 'uniform float fade;\nuniform float globalFade;')
        .replace('gl_FragColor = vec4(vColor, opacity);', 'gl_FragColor = vec4(vColor, opacity * globalFade);')
      mat.needsUpdate = true
    }
  }, [])

  // Sky 的 Preetham 输出在 ACES 下白天整体过曝发白:注入 uSkyExposure uniform,
  // 缩放 (Lin + L0) * 0.04 的亮度系数,白天压低曝光恢复蓝天饱和度,夜晚保持 1.0 原观感
  useEffect(() => {
    const sky = skyRef.current
    if (!sky) return
    const mat = sky.material
    if (!('uSkyExposure' in mat.uniforms)) {
      mat.uniforms.uSkyExposure = { value: SKY_EXPOSURE_DAY }
      mat.fragmentShader = mat.fragmentShader
        .replace('void main() {', 'uniform float uSkyExposure;\nvoid main() {')
        .replace('vec3 texColor = ( Lin + L0 ) * 0.04', 'vec3 texColor = ( Lin + L0 ) * ( 0.04 * uSkyExposure )')
      mat.needsUpdate = true
    }
  }, [])

  useFrame(() => {
    const date = new Date(useSimStore.getState().simClock.nowMs)
    const nf = nightFactor(date)
    const altDeg = sunAltitudeDeg(date)
    const dir = sunDirection(date)
    const duskGlow = 4 * nf * (1 - nf) // 黄昏中点峰值 1,昼/夜为 0
    // 黄金时刻增益:高度角 -6°~+6° 线性峰(地平线处为 1),日出/日落对称;
    // 与 duskGlow(nf 中点约 -3°)互补,覆盖太阳仍低垂在地平线上的 golden hour
    const goldenGlow = THREE.MathUtils.clamp(1 - Math.abs(altDeg) / 6, 0, 1)

    // 太阳 → 月光:位置、强度、色温随高度角与夜晚程度插值
    const sun = sunRef.current
    if (sun) {
      if (nf >= 1) {
        tmpDir.copy(dir).negate() // 夜晚:太阳反方向作为月光来向
      } else {
        tmpDir.copy(dir)
      }
      sun.position.copy(tmpDir).multiplyScalar(800)
      // 色温随低角度加速转暖(原 /25 偏慢,golden hour 时橙意不足;/20 对正午无影响,正午高度角远超 20°)
      const warm = THREE.MathUtils.clamp(1 - Math.max(0, altDeg) / 20, 0, 1)
      tmpColor.copy(SUN_HIGH).lerp(SUN_LOW, warm).lerp(MOON, nf)
      sun.color.copy(tmpColor)
      // 正午峰值 2.8→2.5:给 ACES 留高光余量,白色立面正午不过曝
      const dayIntensity = 0.5 + 2.0 * THREE.MathUtils.clamp(altDeg / 38, 0, 1)
      sun.intensity = THREE.MathUtils.lerp(dayIntensity, 0.12, nf)
    }

    // 半球环境光:天空色/地面色/强度同步入夜(白天提高强度托亮楼体与地面)
    const hemi = hemiRef.current
    if (hemi) {
      hemi.color.copy(HEMI_SKY_DAY).lerp(HEMI_SKY_NIGHT, nf)
      hemi.groundColor.copy(HEMI_GND_DAY).lerp(HEMI_GND_NIGHT, nf)
      // 白天强度 1.05→1.15:太阳减弱后由环境填充补偿,阴影区域保留细节不死黑
      hemi.intensity = THREE.MathUtils.lerp(1.15, 0.24, nf)
    }

    // Sky:太阳位置逐帧驱动(落到地平线下自动转暗),黄昏提高 rayleigh 强化暖色;
    // 浊度/mie/rayleigh 随 nf 在「蔚蓝白天 ↔ 原夜晚基调」之间插值;
    // goldenGlow 额外在高度角 ±6° 区间增强 rayleigh/浊度/mie,让日出日落的地平线
    // 呈现更戏剧化的橙金渐变(正午 |alt|>6°、深夜 alt<-6° 时增量为 0,两端观感不变)
    const sky = skyRef.current
    if (sky) {
      const mat = sky.material as THREE.ShaderMaterial
      mat.uniforms.sunPosition.value.copy(dir)
      mat.uniforms.rayleigh.value =
        THREE.MathUtils.lerp(SKY_RAYLEIGH_DAY, SKY_RAYLEIGH_NIGHT, nf) + 2.2 * duskGlow + 1.3 * goldenGlow
      mat.uniforms.turbidity.value =
        THREE.MathUtils.lerp(SKY_TURBIDITY_DAY, SKY_TURBIDITY_NIGHT, nf) + 1.5 * goldenGlow
      mat.uniforms.mieCoefficient.value =
        THREE.MathUtils.lerp(SKY_MIE_DAY, SKY_MIE_NIGHT, nf) + 0.0025 * goldenGlow
      if ('uSkyExposure' in mat.uniforms) {
        // golden hour 轻微压曝光,橙金色更浓郁(深夜 goldenGlow=0,仍恒 1.0)
        mat.uniforms.uSkyExposure.value =
          THREE.MathUtils.lerp(SKY_EXPOSURE_DAY, 1.0, nf) - 0.06 * goldenGlow
      }
    }

    // Stars:nightFactor>0.02 出现,随 nf 渐入
    const stars = starsRef.current
    if (stars) {
      stars.visible = nf > 0.02
      const mat = stars.material
      if (mat instanceof THREE.ShaderMaterial && 'globalFade' in mat.uniforms) {
        mat.uniforms.globalFade.value = nf
      }
    }
  })

  return (
    <group>
      <directionalLight ref={sunRef} position={[400, 600, 300]} intensity={1.6} />
      {/* 初始值与白天端点对齐(useFrame 首帧即逐帧覆盖,仅为挂载一致性) */}
      <hemisphereLight ref={hemiRef} args={['#b7d4ec', '#8f8875', 1.15]} />
      <Sky
        ref={skyRef}
        distance={4000}
        turbidity={SKY_TURBIDITY_DAY}
        rayleigh={SKY_RAYLEIGH_DAY}
        mieCoefficient={SKY_MIE_DAY}
        mieDirectionalG={0.85}
      />
      <Stars
        ref={starsRef}
        radius={2000}
        depth={400}
        count={starCount}
        factor={6}
        saturation={0}
        fade
        speed={0.6}
      />
    </group>
  )
}
