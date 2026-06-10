import ReactECharts from "echarts-for-react";
import { useThemeStore } from "@/stores/theme";
import { chartInk, withAlpha } from "@/lib/chartTheme";

interface GaugeProps {
  value: number; // 0-100
  label: string;
  color?: string;
  suffix?: string;
}

/** Gauge ECharts minimalista — cores adaptam ao tema (número e trilho legíveis). */
export function Gauge({ value, label, color = "#2563EB", suffix = "" }: GaugeProps) {
  const theme = useThemeStore((s) => s.theme);
  const ink = chartInk(theme);
  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        progress: { show: true, width: 10, roundCap: true, itemStyle: { color, shadowBlur: 14, shadowColor: withAlpha(color, 0.5) } },
        axisLine: { lineStyle: { width: 10, color: [[1, ink.track]] } },
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
          color: ink.detail,
          offsetCenter: [0, "10%"],
          formatter: (v: number) => `${Math.round(v)}${suffix}`,
        },
        title: {
          show: true,
          offsetCenter: [0, "55%"],
          color: ink.title,
          fontSize: 11,
          fontWeight: 600,
        },
        data: [{ value, name: label }],
      },
    ],
  };
  return <ReactECharts option={option} style={{ height: 150 }} notMerge lazyUpdate />;
}
