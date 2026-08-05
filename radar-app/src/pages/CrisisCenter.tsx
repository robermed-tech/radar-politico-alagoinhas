import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchDailyMetrics, fetchCrisisPlans, type CrisisPlan } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";
import { useThemeStore } from "@/stores/theme";
import { chartInk, violetLine, glassArea, glowLine } from "@/lib/chartTheme";

const NIVEIS: NivelCrise[] = ["baixo", "moderado", "alto", "critico"];

const VEL_ICON: Record<string, string> = {
  acelerando: "📈",
  estavel: "➡️",
  esfriando: "📉",
};

function PlanosContencao({ planos }: { planos: CrisisPlan[] }) {
  const reais = planos.filter((p) => p.e_crise_real);
  const descartados = planos.filter((p) => !p.e_crise_real);
  if (planos.length === 0) return null;
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.05)" }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-lg">🚨</span>
        <h2 className="text-base font-extrabold" style={{ color: "#F97316" }}>
          Agente Caçador de Crises — {reais.length} crise(s) real(is)
        </h2>
      </div>
      <p className="mb-3 text-xs text-txt-2">
        Posts de alto risco analisados por um agente de IA especializado. Ele separa crise real de ruído e gera plano de ação.
      </p>
      {reais.length === 0 && (
        <div className="mb-3 rounded-lg border border-risk-low/30 bg-risk-low/5 p-3 text-sm text-txt-2">
          ✅ Nenhuma crise real no momento — todos os posts de alto risco foram avaliados como ruído/monitoramento.
        </div>
      )}
      <div className="space-y-3">
        {reais.map((p) => {
          const cor = NIVEL_COLOR[(p.nivel as NivelCrise) ?? "alto"] ?? "#F97316";
          return (
            <div key={p.post_url} className="rounded-lg border border-line bg-bg-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded px-1.5 py-0.5 text-[12px] font-bold uppercase" style={{ background: `${cor}1A`, color: cor }}>
                  {NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel}
                </span>
                <span className="text-[13px] text-txt-3">{VEL_ICON[p.velocidade] ?? ""} {p.velocidade}</span>
                <span className="text-[13px] font-semibold" style={{ color: "#F97316" }}>
                  janela: {p.janela_resposta}
                </span>
                <span className="ml-auto text-[13px] text-txt-3">@{p.autor} · risco {p.score_risco}</span>
              </div>
              <div className="mt-2 text-[14px] text-txt-1">
                <span className="font-semibold text-txt-2">🔥 Pavio: </span>{p.pavio}
              </div>
              {p.plano_contencao?.length > 0 && (
                <ol className="mt-2 space-y-1">
                  {p.plano_contencao.map((passo, i) => (
                    <li key={i} className="flex gap-2 text-[14px] text-txt-1">
                      <span className="font-bold" style={{ color: "#F97316" }}>{i + 1}.</span>
                      <span>{passo}</span>
                    </li>
                  ))}
                </ol>
              )}
              {p.risco_se_ignorar && (
                <div className="mt-2 rounded border border-risk-crit/20 bg-risk-crit/5 px-2 py-1.5 text-[13px] text-txt-2">
                  <span className="font-semibold text-risk-crit">Se ignorar: </span>{p.risco_se_ignorar}
                </div>
              )}
              {p.post_url && (
                <a href={p.post_url} target="_blank" rel="noopener noreferrer"
                   className="mt-2 inline-block text-[13px] font-semibold text-brand hover:underline">
                  Ver post ↗
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Avaliados e descartados (o agente olhou e classificou como não-crise) */}
      {descartados.length > 0 && (
        <div className="mt-3 border-t border-line/40 pt-3">
          <div className="mb-2 text-[13px] font-bold uppercase tracking-wide text-txt-3">
            ✅ {descartados.length} post(s) de alto risco avaliado(s) — não é crise (monitorar)
          </div>
          <div className="space-y-1.5">
            {descartados.map((p) => (
              <div key={p.post_url} className="flex items-start gap-2 text-[13px] text-txt-2">
                <span className="text-txt-3">@{p.autor} · risco {p.score_risco} →</span>
                <span>{p.pavio}</span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  // 30 dias: esta tela é a leitura HISTÓRICA da crise (série de daily_metrics),
  // então usa a janela mais larga do produto. Ver fetchCrisisPlans.
  const { data: planosData } = useQuery({
    queryKey: ["crisis-plans", 30],
    queryFn: () => fetchCrisisPlans(30),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  const planos = planosData ?? [];
  const theme = useThemeStore((s) => s.theme);
  const ink = chartInk(theme);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando histórico…</div>;

  const serie = data ?? [];
  const atual = serie.at(-1);
  const nivelAtual = (atual?.nivel_crise as NivelCrise) || "baixo";

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

  const tip = {
    trigger: "axis" as const,
    backgroundColor: ink.tooltipBg,
    borderColor: ink.tooltipBorder,
    textStyle: { color: ink.tooltipText },
  };
  const iadOption = {
    grid: { left: 36, right: 16, top: 24, bottom: 28 },
    tooltip: tip,
    legend: { data: ["IAD", "ICA"], textStyle: { color: ink.axis }, right: 0, top: 0 },
    xAxis: {
      type: "category",
      data: serie.map((s) => s.dia.slice(5)),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis },
    },
    yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: ink.grid } }, axisLabel: { color: ink.axis } },
    series: [
      { name: "IAD", type: "line", smooth: true, lineStyle: glowLine("#2563EB"), areaStyle: glassArea("#2563EB"), data: serie.map((s) => s.iad), itemStyle: { color: "#2563EB" } },
      { name: "ICA", type: "line", smooth: true, lineStyle: glowLine(violetLine(theme)), areaStyle: glassArea(violetLine(theme)), data: serie.map((s) => s.ica), itemStyle: { color: violetLine(theme) } },
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
            </div>
          );
        })}
      </div>

      {/* Planos de contenção do Agente Caçador de Crises */}
      <PlanosContencao planos={planos} />

      {/* IAD x ICA */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Aprovação Digital vs. Confiança da Amostra</div>
        <ReactECharts option={iadOption} style={{ height: 260 }} notMerge />
      </div>
    </div>
  );
}
