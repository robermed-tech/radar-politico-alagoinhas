import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchInfluencers, type Influencer } from "@/lib/data";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";

type Filtro = "todos" | "perfil_monitorado" | "cidadao";

const ALIN_COR: Record<string, string> = {
  aliado: "#22C55E",
  opositor: "#EF4444",
  neutro: "#EAB308",
  cidadao: "#3B82F6",
};

const CLASSE_LABEL: Record<string, string> = {
  macro: "Grande alcance",
  micro: "Influenciador segmentado",
  nano: "Cidadão com rede",
  formador: "Formador de opinião",
};

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-bg-3">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function Row({ inf, maxScore }: { inf: Influencer; maxScore: number }) {
  const cor = ALIN_COR[inf.alinhamento] || "#9FB0CC";
  return (
    <div className="rounded-lg border border-line bg-bg-2 p-3 transition hover:border-line-strong">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className="grid h-9 w-9 place-items-center rounded-lg font-bold text-white"
            style={{ background: cor }}
          >
            {(inf.handle[0] || "?").toUpperCase()}
          </div>
          <div>
            <div className="font-semibold text-txt-1">@{inf.handle}</div>
            <div className="text-[11px] text-txt-3">
              {inf.categoria} · {CLASSE_LABEL[inf.classe] || inf.classe}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="tnum text-xl font-extrabold" style={{ color: cor }}>
            {Math.round(inf.influencia_score)}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-txt-3">score</div>
        </div>
      </div>
      <div className="mt-2">
        <Bar value={inf.influencia_score} max={maxScore} color={cor} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <div className="text-txt-3">Alcance</div>
          <div className="tnum font-semibold text-txt-1">{fmtInt(inf.alcance)}</div>
        </div>
        <div>
          <div className="text-txt-3">Engajamento</div>
          <div className="tnum font-semibold text-txt-1">{fmtInt(inf.engajamento)}</div>
        </div>
        <div>
          <div className="text-txt-3">{inf.tipo === "cidadao" ? "Comentários" : "Posts"}</div>
          <div className="tnum font-semibold text-txt-1">{inf.frequencia}</div>
        </div>
      </div>
      {inf.tipo === "perfil_monitorado" && (inf.pct_positivo > 0 || inf.pct_negativo > 0) && (
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-bg-3">
          <div
            className="h-full bg-risk-low"
            style={{ width: `${inf.pct_positivo}%` }}
            title={`${inf.pct_positivo}% positivo`}
          />
          <div
            className="h-full bg-risk-crit"
            style={{ width: `${inf.pct_negativo}%` }}
            title={`${inf.pct_negativo}% negativo`}
          />
        </div>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
          style={{ background: `${cor}1A`, color: cor }}
        >
          {inf.alinhamento}
        </span>
      </div>
    </div>
  );
}

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
  const maxScore = Math.max(...filtrada.map((i) => i.influencia_score), 1);

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
                ? "border-brand bg-brand text-[#0B1220]"
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

      {/* Lista detalhada */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtrada.map((inf, i) => (
          <Row key={`${inf.tipo}-${inf.handle}-${i}`} inf={inf} maxScore={maxScore} />
        ))}
      </div>
    </div>
  );
}
