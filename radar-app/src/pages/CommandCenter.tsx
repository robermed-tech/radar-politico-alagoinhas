import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchRadar,
  filtrarDoisPeriodos,
  parseData,
  getScriptUrl,
  setScriptUrl,
  type Post,
} from "@/lib/data";
import { calcIndices, calcDelta, type Delta, NIVEL_COLOR, NIVEL_LABEL } from "@/lib/indices";
import { KpiStat } from "@/components/KpiStat";
import { AlertaCrise } from "@/components/AlertaCrise";
import { AvisoAmostra } from "@/components/AvisoAmostra";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassArea, glowLine, colorByIAD, COLOR_SENTIMENT } from "@/lib/chartTheme";

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
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-txt-3 text-center">Nenhum tema em alerta.</p>
      </div>
    );
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      {temas.map((t) => {
        const cor = t.pNeg >= 50 ? "#EF4444" : t.pNeg >= 35 ? "#F97316" : "#EAB308";
        const label = t.pNeg >= 50 ? "CRÍTICO" : t.pNeg >= 35 ? "ALTO" : "ATENÇÃO";
        return (
          <div key={t.tema} className="flex flex-col items-center gap-1.5 text-center">
            <span className="text-3xl font-extrabold capitalize text-txt-1">{t.tema}</span>
            <span
              className="rounded px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-widest"
              style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function toDeltaProp(v: number): { v: number; dir: "up" | "down" | "flat" } {
  return { v: Math.abs(v), dir: v > 0 ? "up" : v < 0 ? "down" : "flat" };
}

function DeltaLine({ value, invert = false }: { value: number; invert?: boolean }) {
  if (value === 0) return <span className="mt-1 text-[10px] text-txt-3">= igual ao período ant.</span>;
  const isGood = invert ? value < 0 : value > 0;
  const color = isGood ? "#22c55e" : "#ef4444";
  const sign = value > 0 ? "+" : "";
  return (
    <span className="mt-1 text-[10px] font-semibold" style={{ color }}>
      {value > 0 ? "↑" : "↓"} {sign}{value} pp vs período ant.
    </span>
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
    const { atual: posts, anterior: postsAnt } = filtrarDoisPeriodos(data.data, dias);
    const serie = serieDiaria(posts);
    const negHoje = serie.at(-1)?.pctNeg ?? 0;
    const neg3d = serie.at(-4)?.pctNeg ?? negHoje;
    const negVelocity = negHoje - neg3d;
    const ind = calcIndices(posts, negVelocity);
    const indAnt = calcIndices(postsAnt);
    const delta: Delta | null = postsAnt.length > 0 ? calcDelta(ind, indAnt) : null;

    // Contagem absoluta de comentários por sentimento (prova do IAD)
    const totalPosComents = Math.round(
      posts.reduce((s, p) => s + ((p.comentarios_pct_pos || 0) / 100) * (p.comentarios_total || 0), 0)
    );
    const totalNegComents = Math.round(
      posts.reduce((s, p) => s + ((p.comentarios_pct_neg || 0) / 100) * (p.comentarios_total || 0), 0)
    );

    const temasRisco = calcTemasRisco(posts);

    return { posts, serie, ind, negVelocity, delta, totalPosComents, totalNegComents, temasRisco };
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

  const { ind, serie, delta } = view;
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
      data: ["Positivos", "Negativos"],
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* IAD sem gauge — número grande + contagem absoluta */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-bg-1 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">
            Aprovação Digital
          </div>
          <div
            className="mt-1 text-6xl font-extrabold leading-none"
            style={{ color: colorByIAD(ind.iad) }}
          >
            {ind.iad}%
          </div>
          {delta !== null && <DeltaLine value={delta.iad} />}
          <div className="mt-2 text-center text-[10px] leading-snug text-txt-3">
            <span style={{ color: COLOR_SENTIMENT.pos }}>{fmtInt(view.totalPosComents)} pos</span>
            {" · "}
            <span style={{ color: COLOR_SENTIMENT.neg }}>{fmtInt(view.totalNegComents)} neg</span>
            <br />
            de {fmtInt(ind.volumeComents)} coment.
          </div>
        </div>

        {/* Temas em Atenção — texto grande centralizado */}
        <div className="flex min-h-[160px] flex-col rounded-xl border border-line bg-bg-1 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">
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
      <div className="grid grid-cols-2 gap-4">
        <KpiStat
          label="Positivo"
          value={`${ind.pctPos}%`}
          sub="posts com sent. positivo"
          delta={delta ? toDeltaProp(delta.pctPos) : undefined}
        />
        <KpiStat
          label="Negativo"
          value={`${ind.pctNeg}%`}
          sub="posts com sent. negativo"
          delta={delta ? toDeltaProp(delta.pctNeg) : undefined}
          invertDelta
        />
      </div>

      {/* Evolução do sentimento */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Evolução do sentimento</div>
        <ReactECharts option={timelineOption} style={{ height: 280 }} notMerge />
      </div>
    </div>
  );
}
