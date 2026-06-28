import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchDailyThemes,
  type DailyTheme,
} from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { AlertaCrise } from "@/components/AlertaCrise";

// ── Métricas do gráfico — apenas Volume ──────────────────────────────────────
type Metrica = "volume";
const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume", label: "Volume (posts)", campo: "volume_posts", cor: "#3B82F6" },
];

// ── Regressão linear (unificada) ─────────────────────────────────────────────
function linearSlope(serie: number[]): number {
  const n = serie.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = serie.reduce((s, v) => s + v, 0);
  const sumXY = serie.reduce((s, v, i) => s + v * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function direcao(s: number): "subindo" | "estavel" | "caindo" {
  if (s > 0.1) return "subindo";
  if (s < -0.1) return "caindo";
  return "estavel";
}

function direcaoSlope(serie: number[]): "subindo" | "estavel" | "caindo" {
  return direcao(linearSlope(serie));
}

const COR_OUTROS = "#94A3B8";

// ── Interfaces ───────────────────────────────────────────────────────────────
interface TemaResumido {
  tema: string;
  pctNeg: number;
  pctPos: number;
  volume: number;
  direcao: "subindo" | "estavel" | "caindo";
}

interface TemaStats {
  tema: string;
  serie: number[];
  dias: string[];
  total: number;
  s: number;
  ultimo: number;
}

function toLabel(tema: string): string {
  return tema.charAt(0).toUpperCase() + tema.slice(1);
}

// ── buildTemas: agrega daily_themes por tema para alertaTema ─────────────────
function buildTemas(themes: DailyTheme[]): TemaResumido[] {
  const byTema: Record<string, number[]>    = {};
  const byTemaVol: Record<string, number>   = {};
  const byTemaPos: Record<string, number[]> = {};
  const byTemaNeg: Record<string, number[]> = {};

  for (const t of themes) {
    const k = t.tema?.toLowerCase() || "outros";
    byTema[k] = byTema[k] ?? [];
    byTema[k].push(t.pct_neg);
    byTemaVol[k] = (byTemaVol[k] ?? 0) + t.volume_posts;
    byTemaPos[k] = byTemaPos[k] ?? [];
    byTemaPos[k].push(t.pct_pos);
    byTemaNeg[k] = byTemaNeg[k] ?? [];
    byTemaNeg[k].push(t.pct_neg);
  }

  return Object.entries(byTema)
    .map(([tema, serie]) => {
      const ultPos = byTemaPos[tema] ?? [];
      const ultNeg = byTemaNeg[tema] ?? [];
      return {
        tema,
        pctNeg: Math.round(ultNeg.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultNeg.length))),
        pctPos: Math.round(ultPos.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultPos.length))),
        volume: byTemaVol[tema] ?? 0,
        direcao: direcaoSlope(serie),
      };
    })
    .filter((t) => t.volume > 0)
    .sort((a, b) => b.pctNeg - a.pctNeg || b.volume - a.volume);
}

// ── Página ───────────────────────────────────────────────────────────────────
export function TemasPage() {
  const metrica: Metrica = "volume";
  const [janela, setJanela] = useState(14);
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  // Tema mais crítico (para AlertaCrise)
  const temas = useMemo(() => buildTemas(themes), [themes]);
  const alertaTema = temas[0];

  // Dados de tendência para os gráficos
  const view = useMemo(() => {
    if (themes.length === 0) return null;
    const metr    = METRICAS.find((m) => m.id === metrica)!;
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtradas = themes.filter((r) => r.dia >= cutoffStr);
    const dias      = Array.from(new Set(filtradas.map((r) => r.dia))).sort();
    const temasList = Array.from(new Set(filtradas.map((r) => r.tema)));

    const stats: TemaStats[] = temasList.map((t) => {
      const map: Record<string, number> = {};
      filtradas.filter((r) => r.tema === t).forEach((r) => {
        map[r.dia] = Number(r[metr.campo] ?? 0);
      });
      const serie = dias.map((d) => map[d] ?? 0);
      return {
        tema:   t,
        serie,
        dias,
        total:  serie.reduce((s, v) => s + v, 0),
        s:      linearSlope(serie),
        ultimo: serie.at(-1) ?? 0,
      };
    });

    stats.sort((a, b) => b.total - a.total);
    const outrosTemasSet = new Set(stats.slice(7).map((s) => s.tema));
    return { stats, outrosTemasSet, metr };
  }, [themes, metrica, janela]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando tendências…</div>;

  if (!view || themes.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Tendências</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico de temas. Execute o fluxo ÁGORA para popular.
        </div>
      </div>
    );

  const { stats, outrosTemasSet, metr } = view;

  // Exclui "outros" do gráfico e das listas — categoria residual da IA
  const movers = [...stats]
    .filter((s) => s.tema !== "outros")
    .sort((a, b) => Math.abs(b.s) - Math.abs(a.s))
    .slice(0, 12)
    .sort((a, b) => a.s - b.s);

  // Vermelho = subindo (mais negativo/volume = alarme), Verde = caindo (melhora)
  const corSlope = (s: number) => (s > 0.1 ? "#EF4444" : s < -0.1 ? "#22C55E" : "#9FB0CC");

  // Os slopes são em unidades/dia → multiplicar ×7 para exibir por semana (mais legível)
  const fmtSlope = (s: number) => {
    const v = s * 7;
    return (v >= 0 ? "+" : "") + v.toFixed(1);
  };

  const option = {
    grid: { left: 36, right: 20, top: 16, bottom: 72 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (ps: { name: string; value: number }[]) => {
        const v = Number(ps[0].value);
        const dir = v > 0.1 ? "subindo" : v < -0.1 ? "caindo" : "estável";
        const unidade = metrica === "volume" ? "posts/sem" : "pt/sem";
        const semanal = (v * 7).toFixed(1);
        return `<b>${ps[0].name}</b><br/>${dir}: ${Number(semanal) > 0 ? "+" : ""}${semanal} ${unidade}`;
      },
    },
    xAxis: {
      type: "category",
      data: movers.map((s) => toLabel(s.tema)),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 11, rotate: 30, interval: 0 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: {
        color: ink.axis,
        fontSize: 10,
        formatter: (v: number) => fmtSlope(v),
      },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 42,
        data: movers.map((s) => ({
          value: Number(s.s.toFixed(3)),
          itemStyle: glassBar(corSlope(s.s), {
            horizontal: false,
            radius: s.s >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6],
          }),
        })),
      },
    ],
  };

  const subindo = stats.filter((s) => direcao(s.s) === "subindo" && s.tema !== "outros");
  const caindo  = stats.filter((s) => direcao(s.s) === "caindo"  && s.tema !== "outros");

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho + controles */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Tendências</h1>
          <p className="text-sm text-txt-2">
            Evolução de cada tema — quem está subindo, estável ou caindo
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setJanela(d)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  janela === d ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Subindo + Caindo lado a lado */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-risk-crit">
              ▲ Subindo ({subindo.length})
            </div>
            {alertaTema && alertaTema.pctNeg >= 35 && (
              <AlertaCrise
                tema={alertaTema.tema}
                pNeg={alertaTema.pctNeg}
                posts={alertaTema.volume}
                iad={alertaTema.pctPos}
              />
            )}
          </div>
          <div className="space-y-1.5">
            {subindo.slice(0, 5).map((s) => {
              const isOut = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between text-sm">
                  <span className="text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#EF4444" }}>
                    +{s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                  </span>
                </div>
              );
            })}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-low">
            ▼ Caindo ({caindo.length})
          </div>
          <div className="space-y-1.5">
            {caindo.slice(0, 5).map((s) => {
              const isOut = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between text-sm">
                  <span className="text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span className="tnum font-bold" style={{ color: isOut ? COR_OUTROS : "#22C55E" }}>
                    {s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                  </span>
                </div>
              );
            })}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Gráfico de variação divergente */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold">
              {metr.label} · variação por tema (janela {janela}d)
            </div>
            <div className="text-[10px] text-txt-3">
              Barras mostram variação semanal — passa o mouse para ver o valor exato
            </div>
          </div>
          <div className="text-[10px] text-txt-3">
            🔴 subindo · 🟢 caindo · ⚪ estável
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: 260 }}
          notMerge
        />
      </div>

    </div>
  );
}
