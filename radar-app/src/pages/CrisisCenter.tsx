import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDailyMetrics, fetchCrisisPlans, type CrisisPlan } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";

const NIVEIS: NivelCrise[] = ["baixo", "moderado", "alto", "critico"];

const VEL_ICON: Record<string, string> = {
  acelerando: "📈",
  estavel: "➡️",
  esfriando: "📉",
};

function PlanosContencao({ planos }: { planos: CrisisPlan[] }) {
  const reais = planos.filter((p) => p.e_crise_real);
  if (reais.length === 0) return null;
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.05)" }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">🚨</span>
        <h2 className="text-base font-extrabold" style={{ color: "#F97316" }}>
          Agente Caçador de Crises — {reais.length} plano(s) de contenção
        </h2>
      </div>
      <p className="mb-3 text-xs text-txt-2">
        Posts de alto risco analisados por um agente de IA especializado, com plano de ação concreto.
      </p>
      <div className="space-y-3">
        {reais.map((p) => {
          const cor = NIVEL_COLOR[(p.nivel as NivelCrise) ?? "alto"] ?? "#F97316";
          return (
            <div key={p.post_url} className="rounded-lg border border-line bg-bg-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: `${cor}1A`, color: cor }}>
                  {NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel}
                </span>
                <span className="text-[11px] text-txt-3">{VEL_ICON[p.velocidade] ?? ""} {p.velocidade}</span>
                <span className="text-[11px] font-semibold" style={{ color: "#F97316" }}>
                  janela: {p.janela_resposta}
                </span>
                <span className="ml-auto text-[11px] text-txt-3">@{p.autor} · risco {p.score_risco}</span>
              </div>
              <div className="mt-2 text-[13px] text-txt-1">
                <span className="font-semibold text-txt-2">🔥 Pavio: </span>{p.pavio}
              </div>
              {p.plano_contencao?.length > 0 && (
                <ol className="mt-2 space-y-1">
                  {p.plano_contencao.map((passo, i) => (
                    <li key={i} className="flex gap-2 text-[13px] text-txt-1">
                      <span className="font-bold" style={{ color: "#F97316" }}>{i + 1}.</span>
                      <span>{passo}</span>
                    </li>
                  ))}
                </ol>
              )}
              {p.risco_se_ignorar && (
                <div className="mt-2 rounded border border-risk-crit/20 bg-risk-crit/5 px-2 py-1.5 text-[12px] text-txt-2">
                  <span className="font-semibold text-risk-crit">Se ignorar: </span>{p.risco_se_ignorar}
                </div>
              )}
              {p.post_url && (
                <a href={p.post_url} target="_blank" rel="noopener noreferrer"
                   className="mt-2 inline-block text-[11px] font-semibold text-brand hover:underline">
                  Ver post ↗
                </a>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function CrisisCenter() {
  const { data, isLoading } = useQuery({
    queryKey: ["daily-metrics"],
    queryFn: fetchDailyMetrics,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const { data: planosData } = useQuery({
    queryKey: ["crisis-plans"],
    queryFn: fetchCrisisPlans,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const planos = planosData ?? [];

  if (isLoading) return <div className="p-8 text-txt-2">Carregando histórico…</div>;

  const serie = data ?? [];
  const atual = serie.at(-1);
  const nivelAtual = (atual?.nivel_crise as NivelCrise) || "baixo";
  const corAtual = NIVEL_COLOR[nivelAtual];

  if (serie.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Central de Crises</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico no Postgres. A Central de Crises se popula a cada
          execução do AGORA (grava <code>daily_metrics</code>). Rode o workflow
          ÁGORA e volte aqui.
        </div>
      </div>
    );

  const riscoOption = {
    grid: { left: 36, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: "axis" },
    xAxis: {
      type: "category",
      data: serie.map((s) => s.dia.slice(5)),
      axisLine: { lineStyle: { color: "#2A364E" } },
      axisLabel: { color: "#5F6E8C" },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: "#1A2233" } },
      axisLabel: { color: "#5F6E8C" },
    },
    visualMap: {
      show: false,
      dimension: 1,
      pieces: [
        { lte: 40, color: "#22C55E" },
        { gt: 40, lte: 60, color: "#EAB308" },
        { gt: 60, lte: 80, color: "#F97316" },
        { gt: 80, color: "#EF4444" },
      ],
    },
    series: [
      {
        name: "Risco",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        lineStyle: { width: 3 },
        areaStyle: { opacity: 0.08 },
        data: serie.map((s) => s.risco),
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "#3A496B", type: "dashed" },
          data: [{ yAxis: 60 }, { yAxis: 80 }],
        },
      },
    ],
  };

  const iadOption = {
    grid: { left: 36, right: 16, top: 16, bottom: 28 },
    tooltip: { trigger: "axis" },
    legend: { data: ["IAD", "ICA"], textStyle: { color: "#9FB0CC" }, right: 0, top: 0 },
    xAxis: {
      type: "category",
      data: serie.map((s) => s.dia.slice(5)),
      axisLine: { lineStyle: { color: "#2A364E" } },
      axisLabel: { color: "#5F6E8C" },
    },
    yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: "#1A2233" } }, axisLabel: { color: "#5F6E8C" } },
    series: [
      { name: "IAD", type: "line", smooth: true, data: serie.map((s) => s.iad), itemStyle: { color: "#3B82F6" } },
      { name: "ICA", type: "line", smooth: true, data: serie.map((s) => s.ica), itemStyle: { color: "#A855F7" } },
    ],
  };

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Central de Crises</h1>
          <p className="text-sm text-txt-2">{serie.length} dias de histórico</p>
        </div>
      </div>

      {/* Seletor de nível (estado atual destacado) */}
      <div className="grid grid-cols-4 gap-3">
        {NIVEIS.map((n) => {
          const ativo = n === nivelAtual;
          return (
            <div
              key={n}
              className="rounded-xl border px-4 py-3 text-center transition"
              style={{
                borderColor: ativo ? NIVEL_COLOR[n] : "#2A364E",
                background: ativo ? `${NIVEL_COLOR[n]}1A` : "#121826",
              }}
            >
              <div
                className="text-xs font-bold uppercase tracking-wide"
                style={{ color: ativo ? NIVEL_COLOR[n] : "#5F6E8C" }}
              >
                {NIVEL_LABEL[n]}
              </div>
              {ativo && (
                <div className="tnum mt-1 text-2xl font-extrabold" style={{ color: corAtual }}>
                  {Math.round(atual?.risco ?? 0)}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Planos de contenção do Agente Caçador de Crises */}
      <PlanosContencao planos={planos} />

      {/* Histórico de risco */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Histórico de Risco Político (0–100)</div>
        <div className="mb-2 text-xs text-txt-3">
          Linhas tracejadas: limiares Alto (60) e Crítico (80)
        </div>
        <ReactECharts option={riscoOption} style={{ height: 300 }} notMerge />
      </div>

      {/* IAD x ICA */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Aprovação Digital vs. Confiança da Amostra</div>
        <ReactECharts option={iadOption} style={{ height: 260 }} notMerge />
      </div>
    </div>
  );
}
