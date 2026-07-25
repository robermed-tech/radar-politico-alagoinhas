import ReactECharts from "echarts-for-react";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";

interface Props {
  label: string;
  /** Comentários negativos e positivos do tema — o neutro fica de fora do
   * ponteiro por decisão de produto (reunião 24/07): o velocímetro mede a
   * proporção de negativos sobre (positivos + negativos). */
  neg: number;
  pos: number;
}

/**
 * Velocímetro por tema — substitui as barras empilhadas do volume por tema.
 * Arco moderno (não meia-lua fechada), ponteiro animado do verde ao vermelho
 * conforme a % de negatividade; acima de 70% o card pulsa como alerta.
 */
export function GaugeTema({ label, neg, pos }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const ink = chartInk(theme);
  const total = neg + pos;
  const valor = total > 0 ? Math.round((neg / total) * 100) : 0;
  const critico = total >= 5 && valor >= 70;

  const corPonteiro = valor >= 70 ? "#EF4444" : valor >= 45 ? "#F97316" : "#22C55E";

  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        axisLine: {
          lineStyle: {
            width: 9,
            color: [
              [0.45, "#22C55E"],
              [0.7, "#F97316"],
              [1, "#EF4444"],
            ],
          },
        },
        pointer: {
          show: true,
          length: "58%",
          width: 4,
          itemStyle: { color: corPonteiro },
        },
        anchor: {
          show: true,
          size: 8,
          itemStyle: { color: corPonteiro, borderColor: ink.track, borderWidth: 2 },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 22,
          fontWeight: 400,
          fontFamily: "JetBrains Mono, monospace",
          color: ink.detail,
          offsetCenter: [0, "82%"],
          formatter: (v: number) => `${Math.round(v)}%`,
        },
        title: { show: false },
        data: [{ value: valor }],
        animationDuration: 1200,
        animationEasing: "elasticOut",
      },
    ],
  };

  return (
    <div
      className="rounded-2xl border bg-bg-1 px-2 pb-3 pt-2 text-center"
      style={
        critico
          ? { borderColor: "rgba(239,68,68,0.55)", animation: "gauge-alerta 1.6s ease-in-out infinite" }
          : { borderColor: "var(--line)" }
      }
    >
      <style>{`
        @keyframes gauge-alerta {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
          50% { box-shadow: 0 0 18px -2px rgba(239,68,68,0.55); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="gauge-alerta"] { animation: none !important; }
        }
      `}</style>
      <div className="truncate px-1 text-[12px] font-bold text-txt-1" title={label}>
        {label}
      </div>
      <ReactECharts option={option} style={{ height: 110 }} notMerge lazyUpdate />
      <div className="flex items-center justify-center gap-3 text-[11px]">
        <span className="tnum font-semibold" style={{ color: "#EF4444" }}>{fmtInt(neg)} neg</span>
        <span className="tnum font-semibold" style={{ color: "#22C55E" }}>{fmtInt(pos)} pos</span>
      </div>
    </div>
  );
}
