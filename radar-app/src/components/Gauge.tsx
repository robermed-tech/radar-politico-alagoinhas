import ReactECharts from "echarts-for-react";

interface GaugeProps {
  value: number; // 0-100
  label: string;
  color?: string;
  suffix?: string;
}

/** Gauge ECharts minimalista — o ÚNICO lugar com gradiente (regra de design). */
export function Gauge({ value, label, color = "#3B82F6", suffix = "" }: GaugeProps) {
  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        progress: { show: true, width: 10, roundCap: true, itemStyle: { color } },
        axisLine: { lineStyle: { width: 10, color: [[1, "#232E44"]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 30,
          fontWeight: 800,
          fontFamily: "JetBrains Mono, monospace",
          color: "#EAF0FA",
          offsetCenter: [0, "10%"],
          formatter: (v: number) => `${Math.round(v)}${suffix}`,
        },
        title: {
          show: true,
          offsetCenter: [0, "55%"],
          color: "#9FB0CC",
          fontSize: 11,
          fontWeight: 600,
        },
        data: [{ value, name: label }],
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 150 }} notMerge lazyUpdate />;
}
