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
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

/** Série diária de % negativo, p/ velocidade e timeline. */
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

export function CommandCenter() {
  const [dias, setDias] = useState(7);
  const qc = useQueryClient();
  const ink = chartInk(useThemeStore((s) => s.theme));
  const hasUrl = !!getScriptUrl();
  const { data, isLoading, error } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 30 * 60 * 1000,
    enabled: hasUrl,
    retry: false,
  });

  if (!hasUrl || (error as Error | undefined)?.message === "NO_URL")
    return <ConfigUrl onSaved={() => qc.invalidateQueries({ queryKey: ["radar"] })} />;

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filtrarPorPeriodo(data.data, dias);
    const serie = serieDiaria(posts);
    const negHoje = serie.at(-1)?.pctNeg ?? 0;
    const neg3d = serie.at(-4)?.pctNeg ?? negHoje;
    const negVelocity = negHoje - neg3d;
    const ind = calcIndices(posts, negVelocity);
    return { posts, serie, ind, negVelocity };
  }, [data, dias]);

  if (isLoading)
    return <div className="p-8 text-txt-2">Carregando inteligência…</div>;
  if (error)
    return (
      <div className="p-8 text-risk-crit">
        {(error as Error).message}
      </div>
    );
  if (!view) return null;

  const { ind, serie } = view;
  const nivelColor = NIVEL_COLOR[ind.nivel];

  const timelineOption = {
    grid: { left: 36, right: 12, top: 24, bottom: 28 },
    tooltip: { trigger: "axis", backgroundColor: ink.tooltipBg, borderColor: ink.tooltipBorder, textStyle: { color: ink.tooltipText } },
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
      { name: "Positivos", type: "bar", stack: "s", data: serie.map((s) => s.pos), itemStyle: { color: "#16A34A" } },
      { name: "Negativos", type: "bar", stack: "s", data: serie.map((s) => s.neg), itemStyle: { color: "#DC2626" } },
      { name: "Neutros", type: "bar", stack: "s", data: serie.map((s) => s.neu), itemStyle: { color: "#64748B" } },
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
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-bold"
            style={{ borderColor: nivelColor, color: nivelColor }}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: nivelColor }} />
            Crise: {NIVEL_LABEL[ind.nivel]}
          </div>
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

      {/* Gauges + KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-bg-1 p-2">
          <Gauge value={ind.iad} label="Aprovação Digital" color="#3B82F6" />
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-2">
          <Gauge value={ind.risco} label="Risco Político" color={nivelColor} />
        </div>
        <KpiStat
          label="Confiança da Amostra"
          value={`${ind.ica}`}
          sub={ind.ica < 40 ? "⚠ amostra insuficiente" : "amostra confiável"}
        />
        <KpiStat
          label="Posts no período"
          value={fmtInt(ind.volumePosts)}
          sub={`${fmtInt(ind.volumeComents)} comentários`}
        />
      </div>

      {/* Distribuição */}
      <div className="grid grid-cols-3 gap-4">
        <KpiStat label="Positivo" value={`${ind.pctPos}%`} sub="dos posts" />
        <KpiStat label="Negativo" value={`${ind.pctNeg}%`} sub="dos posts" invertDelta />
        <KpiStat label="Neutro" value={`${ind.pctNeu}%`} sub="dos posts" />
      </div>

      {/* Timeline */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Evolução do sentimento</div>
        <ReactECharts option={timelineOption} style={{ height: 280 }} notMerge />
      </div>
    </div>
  );
}
