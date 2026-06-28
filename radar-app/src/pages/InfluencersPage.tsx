import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchInfluencers } from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";

type Filtro = "todos" | "perfil_monitorado" | "cidadao";

const ALIN_COR: Record<string, string> = {
  aliado: "#22C55E",
  opositor: "#EF4444",
  neutro: "#EAB308",
  cidadao: "#3B82F6",
};

export function InfluencersPage() {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const ink = chartInk(useThemeStore((s) => s.theme));
  const { data, isLoading } = useQuery({
    queryKey: ["influencers"],
    queryFn: fetchInfluencers,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  // Todos os hooks ANTES de qualquer return condicional (Rules of Hooks)
  const lista = data ?? [];
  const filtrada = filtro === "todos" ? lista : lista.filter((i) => i.tipo === filtro);

  // Gráfico horizontal de ranking — top 10 por score, colorido por alinhamento
  const rankingOption = useMemo(() => {
    const top10 = [...filtrada]
      .sort((a, b) => b.influencia_score - a.influencia_score)
      .slice(0, 10)
      .reverse(); // ECharts horizontal bar: último item aparece no topo
    return {
      grid: { left: 90, right: 56, top: 8, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.tooltipText },
        formatter: (params: { name: string; value: number }[]) => {
          const p = params[0];
          return `@${p.name}<br/><b>${p.value}</b> pts`;
        },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: ink.axis, fontSize: 10 },
        splitLine: { lineStyle: { color: ink.grid } },
      },
      yAxis: {
        type: "category",
        data: top10.map((i) => i.handle),
        axisLabel: {
          color: ink.axis,
          fontSize: 11,
          formatter: (v: string) => `@${v}`,
        },
        axisLine: { lineStyle: { color: ink.axisLine } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 18,
          data: top10.map((i) => ({
            value: Math.round(i.influencia_score),
            itemStyle: glassBar(ALIN_COR[i.alinhamento] || "#9FB0CC", { horizontal: true, radius: [0, 4, 4, 0] }),
          })),
          label: {
            show: true,
            position: "right",
            color: ink.axis,
            fontSize: 11,
            formatter: "{c}",
          },
        },
      ],
    };
  }, [filtrada, ink]);

  // Early returns depois de todos os hooks
  if (isLoading) return <div className="p-8 text-txt-2">Carregando influenciadores…</div>;

  if (lista.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Influenciadores</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ranking ainda não populado. Crie a tabela <code>influencers</code> no
          Supabase (<code>supabase/influencers.sql</code>) e rode o AGORA.
        </div>
      </div>
    );

  const perfis = lista.filter((i) => i.tipo === "perfil_monitorado");
  const aliados = perfis.filter((i) => i.alinhamento === "aliado").length;
  const opositores = perfis.filter((i) => i.alinhamento === "opositor").length;
  const neutros = perfis.filter((i) => i.alinhamento === "neutro").length;

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Influenciadores</h1>
        <p className="text-sm text-txt-2">
          Ranking por score composto (alcance · engajamento · frequência)
        </p>
      </div>

      {/* Mapa de alinhamento */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-low">
            Aliados
          </div>
          <div className="tnum mt-1 text-[40px] font-extrabold leading-none text-risk-low">{aliados}</div>
          <div className="text-xs text-txt-3">perfis favoráveis</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#EAB308" }}>
            Neutros
          </div>
          <div className="tnum mt-1 text-[40px] font-extrabold leading-none" style={{ color: "#EAB308" }}>
            {neutros}
          </div>
          <div className="text-xs text-txt-3">imprensa/equilibrados</div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-risk-crit">
            Opositores
          </div>
          <div className="tnum mt-1 text-[40px] font-extrabold leading-none text-risk-crit">{opositores}</div>
          <div className="text-xs text-txt-3">perfis críticos</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex gap-2">
        {(
          [
            {
              id: "perfil_monitorado",
              label: `Perfis (${lista.filter((i) => i.tipo === "perfil_monitorado").length})`,
            },
            { id: "cidadao", label: `Cidadãos (${lista.filter((i) => i.tipo === "cidadao").length})` },
            { id: "todos", label: `Todos (${lista.length})` },
          ] as { id: Filtro; label: string }[]
        ).map((p) => (
          <button
            key={p.id}
            onClick={() => setFiltro(p.id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
              filtro === p.id
                ? "border-brand bg-brand text-white"
                : "border-line bg-bg-1 text-txt-2 hover:text-txt-1"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Mapa de ranking — visão comparativa rápida */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">
          Mapa de Influência
          <span className="ml-2 text-[10px] font-normal text-txt-3">
            top 10 por score · verde=aliado · vermelho=opositor · amarelo=neutro · azul=cidadão
          </span>
        </div>
        <ReactECharts
          option={rankingOption}
          style={{ height: Math.max(160, Math.min(filtrada.length, 10) * 34 + 32) }}
          notMerge
        />
      </div>
    </div>
  );
}
