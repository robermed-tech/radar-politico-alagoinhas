import ReactECharts from "echarts-for-react";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";

interface Props {
  label: string;
  /** Comentários negativos e positivos do tema — o neutro fica de fora do
   * ponteiro por decisão de produto (reuniões 24-25/07): o velocímetro mede a
   * proporção de POSITIVOS sobre (positivos + negativos). */
  neg: number;
  pos: number;
}

const SEGMENTOS = 14;

/** Cor do degradê vermelho→verde na posição t (0 = vermelho, 1 = verde). */
function corEscala(t: number): string {
  return `hsl(${Math.round(t * 130)}, 78%, 46%)`;
}

/**
 * Velocímetro segmentado por tema — modelo da referência da revisão de 25/07:
 * arco em segmentos discretos, escala do vermelho (0%) ao verde (100%) em
 * degradê, agulha escura e percentual grande. Mede a % de comentários
 * POSITIVOS entre os que tomam partido; segmentos além do valor ficam apagados.
 * Abaixo de 30% de positivos (com amostra mínima) o card pulsa como alerta.
 */
export function GaugeTema({ label, neg, pos }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const ink = chartInk(theme);
  const total = neg + pos;
  const valor = total > 0 ? Math.round((pos / total) * 100) : 0;
  const critico = total >= 5 && valor <= 30;
  const corValor = corEscala(valor / 100);

  // Segmentos discretos via paradas do axisLine: cada segmento colorido pelo
  // degradê na sua posição (aceso até o valor; apagado depois), com um vão
  // estreito entre segmentos para o efeito "tacômetro" da referência.
  const GAP = 0.18; // fração de cada segmento reservada ao vão
  const stops: [number, string][] = [];
  for (let i = 0; i < SEGMENTOS; i++) {
    const centro = ((i + 0.5) / SEGMENTOS) * 100;
    const aceso = centro <= valor && valor > 0;
    const cor = aceso ? corEscala(centro / 100) : ink.track;
    stops.push([(i + 1 - GAP) / SEGMENTOS, cor]);
    if (i < SEGMENTOS - 1) stops.push([(i + 1) / SEGMENTOS, "rgba(0,0,0,0)"]);
  }
  stops.push([1, "rgba(0,0,0,0)"]);

  const option = {
    series: [
      {
        type: "gauge",
        startAngle: 205,
        endAngle: -25,
        min: 0,
        max: 100,
        axisLine: { lineStyle: { width: 13, color: stops } },
        pointer: {
          show: true,
          icon: "path://M2,0 L-2,0 L-1,-58 L1,-58 Z",
          length: "62%",
          width: 5,
          itemStyle: { color: ink.detail },
        },
        anchor: {
          show: true,
          size: 9,
          itemStyle: { color: ink.detail },
        },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        detail: {
          valueAnimation: true,
          fontSize: 24,
          fontWeight: 700,
          fontFamily: "JetBrains Mono, monospace",
          color: corValor,
          offsetCenter: [0, "82%"],
          formatter: (v: number) => `${Math.round(v)}%`,
        },
        title: { show: false },
        data: [{ value: valor }],
        animationDuration: 1200,
        animationEasing: "cubicOut",
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
      <div className="truncate px-1 text-[14px] font-bold text-txt-1" title={label}>
        {label}
      </div>
      <ReactECharts option={option} style={{ height: 118 }} notMerge lazyUpdate />
      <div className="flex items-center justify-center gap-3 text-[13px]">
        <span className="tnum font-semibold" style={{ color: "#EF4444" }}>{fmtInt(neg)} neg</span>
        <span className="tnum font-semibold" style={{ color: "#22C55E" }}>{fmtInt(pos)} pos</span>
      </div>
    </div>
  );
}
