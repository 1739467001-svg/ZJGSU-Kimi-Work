import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 说明:沙箱/受限环境中 macOS FSEvents 会让 dev server 在启动前挂死,
// 轮询 watcher 在任何环境都可用,代价仅是 HMR 延迟百毫秒级。
export default defineConfig({
  plugins: [react()],
  server: { watch: { usePolling: true, interval: 300 } },
  build: {
    rollupOptions: {
      output: {
        // 手动分包:重依赖拆成独立 vendor chunk,首屏并行加载 + 长缓存友好
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          // three.js 生态(R3F / drei / 后处理及其配套依赖)
          if (
            /node_modules[/\\](@react-three|three|three-stdlib|three-mesh-bvh|postprocessing|camera-controls|meshline|maath|troika-three-text|troika-three-utils|troika-worker-utils|detect-gpu|suspend-react|its-fine|react-reconciler|bidi-js|webgl-constants|webgl-sdf-generator)([/\\]|$)/.test(
              id,
            )
          )
            return 'vendor-three'
          // echarts 及其渲染内核 zrender
          if (/node_modules[/\\](echarts|zrender)([/\\]|$)/.test(id)) return 'vendor-echarts'
          // React 生态(核心 + 状态/动效/图标)
          if (
            /node_modules[/\\](react|react-dom|scheduler|zustand|framer-motion|motion-dom|motion-utils|lucide-react)([/\\]|$)/.test(
              id,
            )
          )
            return 'vendor-react'
        },
      },
    },
  },
})
