import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchRadar,
  filtrarPorPeriodo,
  parseData,
  getScriptUrl,
  setScriptUrl,
  type Post,
} from "@/lib/data";
import { calcIndices, NIVEL_COLOR, NIVEL_LABEL } from "@/lib/indices";
import { Gauge } from "@/components/Gauge";
import { KpiStat } from "@/components/KpiStat";
import { AlertaCrise } from "@/components/AlertaCrise";
import { AvisoAmostra } from "@/components/AvisoAmostra";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassArea, glowLine } from "@/lib/chartTheme";

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

function serieDiaria(posts: Post[]) {
  const byDay: Record<string, { pos: number; neg: number; neu: number; tot: number }> = {};
  for (const p of posts) {
    const d = parseData(p.data_post);
    if (!d) continue;
    const k = d.toISOString().slice(0, 10);
    byDay[k] ??= { pos: 0, neg: 0, neu: 0, tot: 0 };
    if (p.sentimento_post === "positivo") byDay[k].pos++;
    else if (p.sentimento_post === "negativo") byDay[k].neg++;
    else byDay[k].neu++;
    byDay[k].tot++;
  }
  const dias = Object.keys(byDay).sort();
  return dias.map((k) => ({
    dia: k,
    pctNeg: byDay[k].tot ? (byDay[k].neg / byDay[k].tot) * 100 : 0,
    pos: byDay[k].pos,
    neg: byDay[k].neg,
    neu: byDay[k].neu,
  }));
}

function ConfigUrl({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState(getScriptUrl());
  return (
    <div className="grid min-h-[60vh] place-items-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-bg-1 p-6">
        <h2 className="text-lg font-extrabold">Conectar fonte de dados</h2>
        <p className="mt-1 text-sm text-txt-2">
          Cole a URL do Google Apps Script (a mesma usada em <b>Ajustes</b> do dashboard
          atual). Fica salva só neste dispositivo.
        </p>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://script.google.com/macros/s/.../exec"
          className="mt-4 w-full rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => {
            setScriptUrl(url);
            onSaved();
          }}
          disabled={!url.trim()}
          className="mt-3 w-full rounded-lg bg-brand py-2.5 font-bold text-white disabled:opacity-50"
        >
          Conectar
        </button>
      </div>
    </div>
  );
}

function calcTemasRisco(posts: Post[]) {
  const map: Record<string, { neg: number; tot: number }> = {};
  for (const p of posts) {
    const t = p.tema;
    if (!t || t === "—") continue;
    map[t] ??= { neg: 0, tot: 0 };
    map[t].tot++;
    if (p.sentimento_post === "negativo") map[t].neg++;
  }
  return Object.entries(map)
    .map(([tema, v]) => ({ tema, pNeg: v.tot > 0 ? Math.round((v.neg / v.tot) * 100) : 0 }))
    .filter((t) => t.pNeg >= 20)
    .sort((a, b) => b.pNeg - a.pNeg)
    .slice(0, 5);
}

function TemasRisco({ temas }: { temas: { tema: string; pNeg: number }[] }) {
  if (temas.length === 0)
    return <p className="text-sm text-txt-3">Nenhum tema em alerta.</p>;
  return (
    <div className="space-y-2">
      {temas.map((t) => {
        const cor = t.pNeg >= 50 ? "#EF4444" : t.pNeg >= 35 ? "#F97316" : "#EAB308";
        const label = t.pNeg >= 50 ? "CRÍTICO" : t.pNeg >= 35 ? "ALTO" : "ATENÇÃO";
        return (
          <div key={t.tema} className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-txt-1">{t.tema}</span>
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{ background: `${cor}22`, color: cor }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function CommandCenter() {
  const [dias, setDias] = useState(7);
  const qc = useQueryClient();
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data, isLoading, error } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    retry: false,
  });

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filtrarPorPeriodo(data.data, dias);
    const serie = serieDiaria(posts);
    const negHoje = serie.at(-1)?.pctNeg ?? 0;
    const neg3d = serie.at(-4)?.pctNeg ?? negHoje;
    const negVelocity = negHoje - neg3d;
    const ind = calcIndices(posts, negVelocity);

    // Contagem absoluta de comentários por sentimento (prova do IAD)
    const totalPosComents = Math.round(
      posts.reduce((s, p) => s + ((p.comentarios_pct_pos || 0) / 100) * (p.comentarios_total || 0), 0)
    );
    const totalNegComents = Math.round(
      posts.reduce((s, p) => s + ((p.comentarios_pct_neg || 0) / 100) * (p.comentarios_total || 0), 0)
    );

    const temasRisco = calcTemasRisco(posts);

    return { posts, serie, ind, negVelocity, totalPosComents, totalNegComents, temasRisco };
  }, [data, dias]);

  const temaCrise = useMemo(() => {
    if (!view || view.posts.length === 0) return null;
    const map: Record<string, { neg: number; tot: number }> = {};
    for (const p of view.posts) {
      const t = p.tema || "";
      if (!t || t === "—") continue;
      map[t] ??= { neg: 0, tot: 0 };
      map[t].neg += (p.comentarios_pct_neg || 0) / 100;
      map[t].tot += 1;
    }
    let best: { tema: string; pNeg: number; posts: number } | null = null;
    for (const [tema, v] of Object.entries(map)) {
      const pNeg = v.tot > 0 ? Math.round((v.neg / v.tot) * 100) : 0;
      if (!best || pNeg > best.pNeg) best = { tema, pNeg, posts: v.tot };
    }
    return best && best.pNeg >= 35 ? best : null;
  }, [view]);

  if ((error as Error | undefined)?.message === "NO_URL")
    return <ConfigUrl onSaved={() => qc.invalidateQueries({ queryKey: ["radar"] })} />;
  if (isLoading)
    return <div className="p-8 text-txt-2">Carregando inteligência…</div>;
  if (error)
    return <div className="p-8 text-risk-crit">{(error as Error).message}</div>;
  if (!view) return null;

  if (view.posts.length === 0)
    return (
      <div className="space-y-4 p-5">
        <h1 className="text-2xl font-extrabold">Centro de Comando</h1>
        <div className="rounded-2xl border border-line bg-bg-1 p-8 text-center">
          <div className="text-lg font-bold text-txt-1">📭 Sem posts no período</div>
          <p className="mx-auto mt-2 max-w-md text-sm text-txt-2">
            Nenhuma publicação foi coletada {dias === 1 ? "nas últimas 24h" : `nos últimos ${dias} dias`}.
            Tente ampliar o período ou aguarde a próxima coleta do AGORA (3x/dia).
          </p>
          <div className="mt-4 flex justify-center gap-1 rounded-lg border border-line bg-bg-2 p-1" style={{ width: "fit-content", margin: "16px auto 0" }}>
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                onClick={() => setDias(p.dias)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  dias === p.dias ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    );

  const { ind, serie } = view;
  const nivelColor = NIVEL_COLOR[ind.nivel];

  // Evolução do sentimento — 3 linhas: positivo, negativo, neutro
  const timelineOption = {
    grid: { left: 36, right: 12, top: 24, bottom: 28 },
    tooltip: {
      trigger: "axis",
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
    },
    legend: {
      data: ["Positivos", "Negativos", "Neutros"],
      textStyle: { color: ink.axis },
      top: 0,
      right: 0,
    },
    xAxis: {
      type: "category",
      data: serie.map((s) => s.dia.slice(5)),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: { color: ink.axis },
    },
    series: [
      {
        name: "Positivos",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        data: serie.map((s) => s.pos),
        lineStyle: glowLine("#16A34A"),
        areaStyle: glassArea("#16A34A"),
      },
      {
        name: "Negativos",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        data: serie.map((s) => s.neg),
        lineStyle: glowLine("#DC2626"),
        areaStyle: glassArea("#DC2626"),
      },
      {
        name: "Neutros",
        type: "line",
        smooth: true,
        symbol: "none",
        data: serie.map((s) => s.neu),
        lineStyle: { color: "#9FB0CC", width: 1.5, type: "dashed" as const },
      },
    ],
  };

  return (
    <div className="space-y-4 p-5">
      {/* Faixa de status */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Centro de Comando</h1>
          <p className="text-sm text-txt-2">
            Alagoinhas/BA · inteligência política
            <span
              className="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
              style={{
                background: data?.source === "supabase" ? "#14532d" : "#1A2233",
                color: data?.source === "supabase" ? "#22C55E" : "#9FB0CC",
              }}
              title="Fonte dos dados"
            >
              {data?.source === "supabase" ? "Postgres" : "Sheets"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold"
            style={{ borderColor: nivelColor, color: nivelColor }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: nivelColor }} />
            Crise: {NIVEL_LABEL[ind.nivel]}
          </div>
          {(ind.nivel === "alto" || ind.nivel === "critico") && temaCrise && (
            <AlertaCrise
              tema={temaCrise.tema}
              pNeg={temaCrise.pNeg}
              posts={temaCrise.posts}
              iad={ind.iad}
            />
          )}
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                onClick={() => setDias(p.dias)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  dias === p.dias ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <AvisoAmostra ica={ind.ica} posts={ind.volumePosts} />

      {/* IAD com prova + Temas em Alerta + Posts */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        {/* Gauge IAD com contagem absoluta */}
        <div className="rounded-xl border border-line bg-bg-1 p-2">
          <Gauge
            value={ind.iad}
            label="Aprovação Digital"
            color={ind.iad >= 60 ? "#22C55E" : ind.iad >= 40 ? "#EAB308" : "#EF4444"}
          />
          <div className="mt-1 text-center text-[10px] leading-snug text-txt-3">
            <span style={{ color: "#22C55E" }}>{fmtInt(view.totalPosComents)} pos</span>
            {" · "}
            <span style={{ color: "#EF4444" }}>{fmtInt(view.totalNegComents)} neg</span>
            <br />
            de {fmtInt(ind.volumeComents)} coment.
          </div>
        </div>

        {/* Temas em Alerta — substitui "Risco Político 29%" */}
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-txt-3">
            Temas em Atenção
          </div>
          <TemasRisco temas={view.temasRisco} />
        </div>

        {/* Posts e comentários */}
        <div className="col-span-2 lg:col-span-1">
          <KpiStat
            label="Posts no período"
            value={fmtInt(ind.volumePosts)}
            sub={`${fmtInt(ind.volumeComents)} comentários`}
          />
        </div>
      </div>

      {/* Distribuição de sentimento dos posts */}
      <div className="grid grid-cols-3 gap-4">
        <KpiStat label="Positivo" value={`${ind.pctPos}%`} sub="posts com sent. positivo" />
        <KpiStat label="Negativo" value={`${ind.pctNeg}%`} sub="posts com sent. negativo" invertDelta />
        <KpiStat label="Neutro" value={`${ind.pctNeu}%`} sub="posts com sent. neutro" />
      </div>

      {/* Evolução do sentimento */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Evolução do sentimento</div>
        <ReactECharts option={timelineOption} style={{ height: 280 }} notMerge />
      </div>
    </div>
  );
}
