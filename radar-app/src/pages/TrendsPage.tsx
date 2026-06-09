import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDailyThemes, type DailyTheme } from "@/lib/data";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";

type Metrica = "volume" | "pct_neg" | "pct_pos" | "score_risco";

const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume",      label: "Volume (posts)",  campo: "volume_posts", cor: "#3B82F6" },
  { id: "pct_neg",     label: "% Negativo",      campo: "pct_neg",      cor: "#EF4444" },
  { id: "pct_pos",     label: "% Positivo",      campo: "pct_pos",      cor: "#22C55E" },
  { id: "score_risco", label: "Risco médio",     campo: "score_risco",  cor: "#F97316" },
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
  if (s > 0.1) return "subindo";
  if (s < -0.1) return "caindo";
  return "estavel";
}

const DIR_ICON: Record<string, string> = { subindo: "▲", estavel: "─", caindo: "▼" };
const DIR_COR: Record<string, string> = { subindo: "#22C55E", estavel: "#9FB0CC", caindo: "#EF4444" };
const COR_OUTROS = "#94A3B8";

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
  const ink = chartInk(useThemeStore((s) => s.theme));
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

    // Ordena por relevância (total); top 7 individuais + OUTROS agregado no gráfico
    stats.sort((a, b) => b.total - a.total);
    const topIndiv = stats.slice(0, 7);
    const outrosStats = stats.slice(7);
    const outrosSerie = dias.map((_, i) =>
      outrosStats.reduce((sum, s) => sum + (s.serie[i] ?? 0), 0)
    );
    const outrosTotal = outrosSerie.reduce((s, v) => s + v, 0);
    const outrosTemas = outrosStats.map(s => s.tema);
    const outrosTemasSet = new Set(outrosTemas);

    return { stats, topIndiv, outrosSerie, outrosTotal, outrosTemas, outrosTemasSet, dias, metr };
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

  const { stats, topIndiv, outrosSerie, outrosTotal, outrosTemas, outrosTemasSet, dias, metr } = view;

  // Mapa de calor (tema × dia) — leitura muito mais clara que o "espaguete" de
  // linhas sobrepostas. Linhas = temas (mais relevante no topo), colunas = dias,
  // cor = intensidade da métrica. Cada célula é independente e legível.
  const heatThemes = [
    ...(outrosTotal > 0 ? [{ name: "Outros", serie: outrosSerie }] : []),
    ...[...topIndiv].reverse().map((s) => ({ name: s.tema, serie: s.serie })),
  ];
  const heatData: [number, number, number][] = [];
  heatThemes.forEach((row, yi) => {
    row.serie.forEach((v, xi) => heatData.push([xi, yi, Math.round(v)]));
  });
  const isPct = metrica.startsWith("pct") || metrica === "score_risco";
  const maxVal = isPct ? 100 : Math.max(1, ...heatData.map((d) => d[2]));
  // Escala de cor com semântica (verde = bom · vermelho = ruim · azul = volume)
  const heatColors =
    metrica === "pct_pos"
      ? ["#1F2937", "#7F1D1D", "#B45309", "#15803D", "#22C55E"] // baixo→alto: ruim→bom
      : metrica === "pct_neg" || metrica === "score_risco"
        ? ["#1F2937", "#15803D", "#B45309", "#7F1D1D", "#EF4444"] // baixo→alto: bom→ruim
        : ["#0B2447", "#1E40AF", "#2563EB", "#3B82F6", "#60A5FA"]; // volume: sequencial azul
  const showLabels = dias.length <= 16;

  const option = {
    grid: { left: 104, right: 20, top: 12, bottom: 64 },
    tooltip: {
      position: "top",
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (p: any) => {
        const tema = heatThemes[p.value[1]]?.name ?? "";
        const dia = dias[p.value[0]] ?? "";
        const extra =
          tema === "Outros" && outrosTemas.length > 0
            ? `<br/><span style="opacity:.7">(${outrosTemas.join(", ")})</span>`
            : "";
        return `<b>${tema}</b>${extra}<br/>${dia.slice(5)}: <b>${p.value[2]}</b>`;
      },
    },
    xAxis: {
      type: "category",
      data: dias.map((d) => d.slice(5)),
      splitArea: { show: true },
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    yAxis: {
      type: "category",
      data: heatThemes.map((t) => t.name),
      splitArea: { show: true },
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    visualMap: {
      min: 0,
      max: maxVal,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      itemWidth: 14,
      itemHeight: 160,
      textStyle: { color: ink.axis, fontSize: 10 },
      inRange: { color: heatColors },
    },
    series: [
      {
        type: "heatmap",
        data: heatData,
        label: {
          show: showLabels,
          color: "#E5E7EB",
          fontSize: 10,
          fontWeight: "bold" as const,
          formatter: (p: any) => (p.value[2] ? p.value[2] : ""),
        },
        itemStyle: { borderColor: ink.tooltipBg, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: "rgba(0,0,0,0.45)" } },
      },
    ],
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
            {subindo.slice(0, 5).map((s) => {
              const isOutros = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between text-sm">
                  <span className="text-txt-1" style={isOutros ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span
                    className="tnum font-bold"
                    style={{ color: isOutros ? COR_OUTROS : "#22C55E" }}
                  >
                    +{s.s.toFixed(1)}/dia
                  </span>
                </div>
              );
            })}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-crit">
            ▼ Caindo ({caindo.length})
          </div>
          <div className="space-y-1.5">
            {caindo.slice(0, 5).map((s) => {
              const isOutros = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between text-sm">
                  <span className="text-txt-1" style={isOutros ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span
                    className="tnum font-bold"
                    style={{ color: isOutros ? COR_OUTROS : "#EF4444" }}
                  >
                    {s.s.toFixed(1)}/dia
                  </span>
                </div>
              );
            })}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Mapa de calor tema × dia */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">{metr.label} · mapa de calor por tema (janela {janela}d)</div>
          <div className="text-[10px] text-txt-3">
            {metrica === "volume"
              ? "azul mais claro = maior volume de posts"
              : metrica === "pct_pos"
                ? "verde = mais positivo · cinza = sem dados"
                : "vermelho = mais crítico · verde = saudável"}
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: Math.max(220, heatThemes.length * 34 + 110) }}
          notMerge
        />
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
                const isOutros = outrosTemasSet.has(s.tema);
                return (
                  <tr key={s.tema} className="border-b border-line/40">
                    <td className="py-2 text-txt-1">
                      {isOutros && (
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full align-middle"
                          style={{ background: COR_OUTROS }}
                          title="Incluso em Outros"
                        />
                      )}
                      {s.tema}
                    </td>
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
