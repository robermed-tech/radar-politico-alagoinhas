import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDailyThemes, fetchRadar, type DailyTheme, type Post } from "@/lib/data";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";

type Metrica = "volume" | "pct_neg" | "pct_pos";

const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume",  label: "Volume (posts)", campo: "volume_posts", cor: "#3B82F6" },
  { id: "pct_neg", label: "% Negativo",    campo: "pct_neg",      cor: "#EF4444" },
  { id: "pct_pos", label: "% Positivo",    campo: "pct_pos",      cor: "#22C55E" },
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
const PALETA = ["#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316", "#06B6D4"];

interface TemaStats {
  tema: string;
  serie: number[];
  dias: string[];
  total: number;
  s: number;
  ultimo: number;
}

const STOPWORDS = new Set([
  "de","a","o","que","e","do","da","em","um","para","com","uma","os","no","se","na","por","mais",
  "as","dos","como","mas","ao","ele","das","à","seu","sua","ou","quando","muito","nos","já","eu",
  "também","só","pelo","pela","até","isso","ela","entre","depois","sem","mesmo","aos","ter","seus",
  "quem","nas","me","esse","eles","estão","você","tinha","foram","essa","num","nem","suas","meu",
  "às","minha","têm","numa","pelos","elas","havia","seja","qual","será","nós","tenho","lhe","deles",
  "essas","esses","pelas","este","fosse","dele","tu","te","vocês","vos","lhes","meus","minhas","teu",
  "tua","teus","tuas","nosso","nossa","nossos","nossas","dela","delas","esta","estes","estas","aquele",
  "aquela","aqueles","aquelas","isto","aquilo","estou","está","estamos","estavam","estarão","estaria",
  "foi","ser","tem","são","sendo","tudo","todo","todos","toda","todas","outro","outra","outros","outras",
  "quer","vai","vão","pode","podem","fazer","feito","ainda","então","agora","aqui","ali","lá","aqui",
  "bem","há","aí","nada","faz","diz","pois","pra","porque","sobre","apenas","sim","não","né","tá",
]);

function extrairKeywords(posts: Post[]): { palavra: string; count: number; cor: string }[] {
  const freq: Record<string, { pos: number; neg: number; tot: number }> = {};
  for (const p of posts) {
    const texto = [p.resumo, p.queixa_dominante, p.elogio_dominante, p.tema]
      .filter(Boolean).join(" ");
    const sent = p.sentimento_post === "positivo" ? "pos" : p.sentimento_post === "negativo" ? "neg" : null;
    for (const raw of texto.split(/[\s,;:.!?()"'«»\-–—\/]+/)) {
      const w = raw.toLowerCase().replace(/[^a-záàâãéêíóôõúüçñ]/g, "");
      if (w.length < 4 || STOPWORDS.has(w) || /^\d+$/.test(w)) continue;
      freq[w] ??= { pos: 0, neg: 0, tot: 0 };
      freq[w].tot++;
      if (sent === "pos") freq[w].pos++;
      if (sent === "neg") freq[w].neg++;
    }
  }
  const entries = Object.entries(freq)
    .filter(([, v]) => v.tot >= 2)
    .sort((a, b) => b[1].tot - a[1].tot)
    .slice(0, 50);
  return entries.map(([palavra, v]) => {
    let cor = "#9FB0CC";
    if (v.pos > v.neg * 1.5) cor = "#22C55E";
    else if (v.neg > v.pos * 1.5) cor = "#EF4444";
    return { palavra, count: v.tot, cor };
  });
}

function KeywordCloud({ posts }: { posts: Post[] }) {
  const kws = useMemo(() => extrairKeywords(posts), [posts]);
  if (kws.length === 0) return null;
  const max = kws[0].count;
  const min = kws.at(-1)?.count ?? 1;
  const escala = (c: number) => {
    const t = max === min ? 0.5 : (c - min) / (max - min);
    return 0.75 + t * 1.5; // rem: 0.75 → 2.25
  };
  const top5neg = [...kws].filter(k => k.cor === "#EF4444").slice(0, 5);
  const top5pos = [...kws].filter(k => k.cor === "#22C55E").slice(0, 5);
  return (
    <div className="rounded-xl border border-line bg-bg-1 p-4">
      <div className="mb-3 text-sm font-bold">Palavras mais frequentes</div>
      <div className="flex flex-wrap gap-2 leading-relaxed">
        {kws.map(({ palavra, count, cor }) => (
          <span
            key={palavra}
            title={`${count} ocorrência${count > 1 ? "s" : ""}`}
            className="cursor-default transition-opacity hover:opacity-80"
            style={{ fontSize: `${escala(count)}rem`, color: cor, fontWeight: count >= max * 0.6 ? 700 : 500 }}
          >
            {palavra}
          </span>
        ))}
      </div>
      {(top5neg.length > 0 || top5pos.length > 0) && (
        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-3">
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-risk-crit">
              Negativos
            </div>
            {top5neg.map(k => (
              <div key={k.palavra} className="flex justify-between text-xs py-0.5">
                <span className="text-txt-1 capitalize">{k.palavra}</span>
                <span className="tabular-nums text-txt-3">{k.count}×</span>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-risk-low">
              Positivos
            </div>
            {top5pos.map(k => (
              <div key={k.palavra} className="flex justify-between text-xs py-0.5">
                <span className="text-txt-1 capitalize">{k.palavra}</span>
                <span className="tabular-nums text-txt-3">{k.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function TrendsPage() {
  const [metrica, setMetrica] = useState<Metrica>("volume");
  const [janela, setJanela] = useState(14); // dias
  const [vsAnterior, setVsAnterior] = useState(false);
  const ink = chartInk(useThemeStore((s) => s.theme));
  const { data, isLoading } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const { data: radarData } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  const posts = radarData?.data ?? [];

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

    // Previous period (same length, immediately before current)
    const cutoffPrevStr = new Date(cutoff.getTime() - janela * 86400000).toISOString().slice(0, 10);
    const filtradas_prev = linhas.filter((r) => r.dia >= cutoffPrevStr && r.dia < cutoffStr);
    const dias_prev = Array.from(new Set(filtradas_prev.map((r) => r.dia))).sort();
    const prevStats: Record<string, number[]> = {};
    for (const t of temas) {
      const map: Record<string, number> = {};
      filtradas_prev.filter((r) => r.tema === t).forEach((r) => {
        map[r.dia] = Number(r[metr.campo] ?? 0);
      });
      prevStats[t] = dias_prev.map((d) => map[d] ?? 0);
    }

    return { stats, topIndiv, outrosSerie, outrosTotal, outrosTemas, outrosTemasSet, dias, metr, prevStats };
  }, [data, metrica, janela]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando tendências…</div>;

  if (!view)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Previsões</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Sem histórico tema/dia ainda. Crie a tabela <code>daily_themes</code> no
          Supabase (<code>supabase/daily_themes.sql</code>) e rode o AGORA.
        </div>
      </div>
    );

  const { stats, topIndiv, outrosSerie, outrosTotal, outrosTemas, outrosTemasSet, dias, metr, prevStats } = view;

  // Gráfico de linhas temporal: top 7 individuais + OUTROS agregado (linha tracejada cinza)
  const lineOption = {
    grid: { left: 48, right: 16, top: 20, bottom: 52 },
    tooltip: {
      trigger: "axis",
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (params: any) => {
        const arr: any[] = Array.isArray(params) ? params : [params];
        let html = `<b>${arr[0]?.axisValue ?? ""}</b><br/>`;
        for (const p of arr) {
          if (p.seriesName === "Outros" && outrosTemas.length > 0) {
            html += `<span style="color:${COR_OUTROS}">●</span> <b>Outros</b> (${outrosTemas.join(", ")}): <b>${p.value}</b><br/>`;
          } else {
            html += `<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${p.value}</b><br/>`;
          }
        }
        return html;
      },
    },
    legend: {
      data: [...topIndiv.map((s) => s.tema), ...(outrosTotal > 0 ? ["Outros"] : [])],
      bottom: 0,
      textStyle: { color: ink.axis, fontSize: 10 },
      itemWidth: 14,
      itemHeight: 8,
    },
    xAxis: {
      type: "category",
      data: dias,
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 10, rotate: 30 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: { color: ink.axis, fontSize: 10 },
    },
    series: [
      ...topIndiv.map((s, i) => ({
        name: s.tema,
        type: "line" as const,
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        lineStyle: { width: 2 },
        itemStyle: { color: PALETA[i % PALETA.length] },
        data: s.serie,
      })),
      ...(outrosTotal > 0
        ? [
            {
              name: "Outros",
              type: "line" as const,
              smooth: true,
              symbol: "circle",
              symbolSize: 4,
              lineStyle: { width: 2, type: "dashed" as const },
              itemStyle: { color: COR_OUTROS },
              data: outrosSerie,
            },
          ]
        : []),
      // Período anterior (dashed, mais fino, sem legenda principal)
      ...(vsAnterior
        ? topIndiv.map((s, i) => ({
            name: `${s.tema} (ant.)`,
            type: "line" as const,
            smooth: true,
            showSymbol: false,
            lineStyle: { width: 1, type: "dashed" as const, opacity: 0.5 },
            itemStyle: { color: PALETA[i % PALETA.length] },
            data: prevStats[s.tema] ?? [],
          }))
        : []),
    ],
  };

  // Barra divergente de variação: cada tema vira uma barra cuja cor mostra o
  // sentido da tendência (verde sobe · vermelho cai · cinza estável). Responde
  // direto "quem sobe / quem cai?" — bem mais legível que o mapa de calor.
  const movers = [...stats]
    .sort((a, b) => Math.abs(b.s) - Math.abs(a.s))
    .slice(0, 12)
    .sort((a, b) => a.s - b.s); // horizontal: mais negativo embaixo, positivo no topo
  const corSlope = (s: number) =>
    s > 0.1 ? "#22C55E" : s < -0.1 ? "#EF4444" : "#9FB0CC";

  const option = {
    grid: { left: 120, right: 48, top: 10, bottom: 28 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (ps: any[]) => {
        const v = Number(ps[0].value);
        const dir = v > 0.1 ? "subindo" : v < -0.1 ? "caindo" : "estável";
        return `<b>${ps[0].name}</b><br/>${dir}: ${v > 0 ? "+" : ""}${v.toFixed(1)}/dia`;
      },
    },
    xAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: { color: ink.axis, fontSize: 10 },
    },
    yAxis: {
      type: "category",
      data: movers.map((s) => s.tema),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 16,
        data: movers.map((s) => ({
          value: Number(s.s.toFixed(2)),
          itemStyle: glassBar(corSlope(s.s), {
            horizontal: true,
            radius: s.s < 0 ? [6, 0, 0, 6] : [0, 6, 6, 0],
          }),
        })),
      },
    ],
  };

  const subindo = stats.filter((s) => direcao(s.s) === "subindo");
  const caindo = stats.filter((s) => direcao(s.s) === "caindo");

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Previsões</h1>
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
          <button
            onClick={() => setVsAnterior((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
              vsAnterior
                ? "border-brand bg-brand/10 text-brand"
                : "border-line bg-bg-1 text-txt-2 hover:text-txt-1"
            }`}
            title="Comparar com o período anterior de mesmo comprimento"
          >
            vs anterior
          </button>
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

      {/* Evolução temporal por tema: top 7 individuais + OUTROS agregado */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">{metr.label} · evolução por tema (janela {janela}d)</div>
          <div className="text-[10px] text-txt-3">
            {vsAnterior
              ? <span>linha tracejada fina = período anterior · <span style={{ color: COR_OUTROS }}>cinza = Outros</span></span>
              : <span>linha cinza tracejada = temas agrupados em <span style={{ color: COR_OUTROS }}>Outros</span></span>
            }
          </div>
        </div>
        <ReactECharts option={lineOption} style={{ height: 280 }} notMerge />
      </div>

      {/* Variação por tema (barra divergente) */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-bold">{metr.label} · variação por tema (janela {janela}d)</div>
          <div className="text-[10px] text-txt-3">
            verde = subindo · vermelho = caindo · cinza = estável
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: Math.max(220, movers.length * 30 + 60) }}
          notMerge
        />
      </div>

      {/* Nuvem de keywords */}
      {posts.length > 0 && <KeywordCloud posts={posts} />}

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
