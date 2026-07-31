import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from './EChart'

export interface EnergyTrendPoint {
  /** 仿真时钟 nowMs */
  t: number
  /** 全校累计能耗 kWh */
  kwh: number
}

interface EnergyTrendChartProps {
  points: EnergyTrendPoint[]
  height?: number
}

const fmtTime = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 今日能耗趋势折线(simEngine 快照累积,品牌蓝) */
export function EnergyTrendChart({ points, height = 180 }: EnergyTrendChartProps) {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 8, right: 16, top: 20, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#161b21',
      borderColor: '#2a323b',
      textStyle: { color: '#dde3e8', fontSize: 12 },
      formatter: (ps: unknown) => {
        const arr = ps as { axisValue?: string; data?: number }[]
        const p = arr[0]
        return p ? `${p.axisValue ?? ''}<br/>累计能耗 ${Number(p.data ?? 0).toFixed(1)} kWh` : ''
      },
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: points.map((p) => fmtTime(p.t)),
      axisLabel: { color: 'rgba(221,227,232,0.5)', fontSize: 10 },
      axisLine: { lineStyle: { color: '#2a323b' } },
    },
    yAxis: {
      type: 'value',
      name: 'kWh',
      nameTextStyle: { color: 'rgba(221,227,232,0.5)', fontSize: 10 },
      axisLabel: { color: 'rgba(221,227,232,0.5)', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a323b' } },
    },
    series: [
      {
        type: 'line',
        smooth: true,
        symbol: 'none',
        data: points.map((p) => Number(p.kwh.toFixed(2))),
        lineStyle: { color: '#3aa7ff', width: 2 },
        areaStyle: { color: 'rgba(58,167,255,0.14)' },
      },
    ],
  }), [points])

  return <EChart option={option} height={height} />
}
