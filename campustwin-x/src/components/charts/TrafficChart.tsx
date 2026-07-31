import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import { EChart } from './EChart'

export interface TrafficDatum {
  /** 路径/路段名称 */
  name: string
  /** 0..1 人流密度 */
  value: number
}

interface TrafficChartProps {
  data: TrafficDatum[]
  height?: number
}

const barColor = (v: number) =>
  v >= 0.8 ? '#ff3b30' : v >= 0.5 ? '#e8843b' : v >= 0.25 ? '#e8b84b' : '#3fd08c'

/** 校园人流密度分布条形图(路径密度 Top N) */
export function TrafficChart({ data, height = 190 }: TrafficChartProps) {
  const option = useMemo<EChartsOption>(() => ({
    grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#161b21',
      borderColor: '#2a323b',
      textStyle: { color: '#dde3e8', fontSize: 12 },
      formatter: (ps: unknown) => {
        const arr = ps as { name?: string; value?: number }[]
        const p = arr[0]
        return p ? `${p.name ?? ''}<br/>人流密度 ${p.value ?? 0}%` : ''
      },
    },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { formatter: '{value}%', color: 'rgba(221,227,232,0.5)', fontSize: 10 },
      splitLine: { lineStyle: { color: '#2a323b' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: data.map((d) => d.name),
      axisLabel: { color: '#dde3e8', fontSize: 11, width: 88, overflow: 'truncate' },
      axisLine: { lineStyle: { color: '#2a323b' } },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        barWidth: 12,
        data: data.map((d) => ({
          value: Math.round(d.value * 100),
          itemStyle: { color: barColor(d.value), borderRadius: [0, 3, 3, 0] },
        })),
        label: { show: true, position: 'right', formatter: '{c}%', color: 'rgba(221,227,232,0.75)', fontSize: 10 },
      },
    ],
  }), [data])

  return <EChart option={option} height={height} />
}
