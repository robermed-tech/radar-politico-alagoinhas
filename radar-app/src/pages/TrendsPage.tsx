import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDailyThemes, type DailyTheme } from "@/lib/data";
import { fmtInt } from "@/lib/format";

type Metrica = "volume" | "pct_neg" | "pct_pos" | "score_risco";

const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume",      label: "Volume (posts)",  campo: "volume_posts", cor: "#3B82F6" },
  { id: "pct_neg",     label: "% Negativo",      campo: "pct_neg",      cor: "#EF4444" },
  { id: "pct_pos",     label: "% Positivo",      campo: "pct_pos",      cor: "#22C55E" },
  { id: "score_risco", label: "Risco médio",     campo: "score_risco",  cor: "#F97316" },
];

const PALETA = [
  "#3B82F6", "#22C55E", "#EAB308", "#EF4444", "#A855F7",
  "#06B6D4", "#F97316", "#EC4899", "#84CC16", "#14B8A6",
];

/** Regressão linear simples — retorna slope (taxa de variação por dia). */
function slope(serie: number[]): number {
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
  if (s > 0.5) return "subindo";
  if (s < -0.5) return "caindo";
  return "estavel";
}

const DIR_ICON: Record<string, string> = { subindo: "▲", estavel: "─", caindo: "▼" };
const DIR_COR: Record<string, string> = { subindo: "#22C55E", estavel: "#9FB0CC", caindo: "#EF4444" };

interface TemaStats {
  tema: string;
  serie: number[];
  dias: string[];
  total: number;
  s: number;
  ultimo: number;
}

export function TrendsPage() {
  const [metrica, setMetrica] = useState<Metrica>("volume");
  const [janela, setJanela] = useState(14); // dias
  const { data, isLoading } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const view = useMemo(() => {
    const linhas = data ?? [];
    if (linhas.length === 0) return null;

    const metr = METRICAS.find((m) => m.id === metrica)!;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Janela temporal
    const filtradas = linhas.filter((r) => r.dia >= cutoffStr);
    const dias = Array.from(new Set(filtradas.map((r) => r.dia))).sort();
    const temas = Array.from(new Set(filtradas.map((r) => r.tema)));

    // Constrói série por tema
    const stats: TemaStats[] = temas.map((t) => {
      const map: Record<string, number> = {};
      filtradas.filter((r) => r.tema === t).forEach((r) => {
        map[r.dia] = Number(r[metr.campo] ?? 0);
      });
      const serie = dias.map((d) => map[d] ?? 0);
      const total = serie.reduce((s, v) => s + v, 0);
      return { tema: t, serie, dias, total, s: slope(serie), ultimo: serie.at(-1) ?? 0 };
    });

    // Ordena por relevância (total) e pega top 8 para o gráfico
    stats.sort((a, b) => b.total - a.total);
    const topGrafico = stats.slice(0, 8);

    return { stats, topGrafico, dias, metr };
  }, [data, metrica, janela]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando tendências…</div>;

  if (!view)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Tendências</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Sem histórico tema/dia ainda. Crie a tabela <code>daily_themes</code> no
          Supabase (<code>supabase/daily_themes.sql</code>) e rode o AGORA.
        </div>
      </div>
    );

  const { stats, topGrafico, dias, metr } = view;

  const option = {
    grid: { left: 40, right: 16, top: 32, bottom: 36 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    legend: {
      data: topGrafico.map((s) => s.tema),
      textStyle: { color: "#9FB0CC", fontSize: 11 },
      top: 0,
      type: "scroll",
    },
    xAxis: {
      type: "category",
      data: dias.map((d) => d.slice(5)),
      axisLine: { lineStyle: { color: "#2A364E" } },
      axisLabel: { color: "#5F6E8C" },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: "#1A2233" } },
      axisLabel: { color: "#5F6E8C" },
      ...(metrica.startsWith("pct") || metrica === "score_risco" ? { min: 0, max: 100 } : {}),
    },
    series: topGrafico.map((s, i) => ({
      name: s.tema,
      type: "line",
      smooth: true,
      symbol: "circle",
      symbolSize: 4,
      lineStyle: { width: 2 },
      itemStyle: { color: PALETA[i % PALETA.length] },
      data: s.serie,
    })),
  };

  const subindo = stats.filter((s) => direcao(s.s) === "subindo");
  const caindo = stats.filter((s) => direcao(s.s) === "caindo");

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Tendências</h1>
          <p className="text-sm text-txt-2">
            Evolução de cada tema ao longo do tempo — quem está subindo, estável ou caindo
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
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {METRICAS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetrica(m.id)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  metrica === m.id ? "bg-bg-3 text-txt-1" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Resumo subindo/caindo */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-low">
            ▲ Subindo ({subindo.length})
          </div>
          <div className="space-y-1.5">
            {subindo.slice(0, 5).map((s) => (
              <div key={s.tema} className="flex items-center justify-between text-sm">
                <span className="text-txt-1">{s.tema}</span>
                <span className="tnum font-bold text-risk-low">+{s.s.toFixed(1)}/dia</span>
              </div>
            ))}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-crit">
            ▼ Caindo ({caindo.length})
          </div>
          <div className="space-y-1.5">
            {caindo.slice(0, 5).map((s) => (
              <div key={s.tema} className="flex items-center justify-between text-sm">
                <span className="text-txt-1">{s.tema}</span>
                <span className="tnum font-bold text-risk-crit">{s.s.toFixed(1)}/dia</span>
              </div>
            ))}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Gráfico de linhas */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">{metr.label} · top 8 temas (janela {janela}d)</div>
        <ReactECharts option={option} style={{ height: 340 }} notMerge />
      </div>

      {/* Tabela completa */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-3 text-sm font-bold">Todos os temas</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-[11px] uppercase tracking-wide text-txt-3">
              <tr>
                <th className="py-2 text-left font-semibold">Tema</th>
                <th className="py-2 text-right font-semibold">Total</th>
                <th className="py-2 text-right font-semibold">Último</th>
                <th className="py-2 text-right font-semibold">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => {
                const dir = direcao(s.s);
                return (
                  <tr key={s.tema} className="border-b border-line/40">
                    <td className="py-2 text-txt-1">{s.tema}</td>
                    <td className="tnum py-2 text-right text-txt-2">{fmtInt(s.total)}</td>
                    <td className="tnum py-2 text-right text-txt-2">{fmtInt(s.ultimo)}</td>
                    <td
                      className="tnum py-2 text-right font-bold"
                      style={{ color: DIR_COR[dir] }}
                    >
                      {DIR_ICON[dir]} {Math.abs(s.s).toFixed(1)}/dia
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
