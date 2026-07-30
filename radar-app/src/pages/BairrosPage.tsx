import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchComentariosLocalidade,
  fetchRadar,
  agregarBairros,
  filtrarPorPeriodo,
  type BairroStats,
} from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { IconInbox } from "@/components/icons";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { ComentariosBairroModal } from "@/components/ComentariosBairroModal";
import { labelBairro } from "@/lib/format";

type Ordem = "volume" | "negativo";

function corPct(pctNeg: number): string {
  if (pctNeg >= 60) return "#EF4444";
  if (pctNeg >= 35) return "#F97316";
  return "#22C55E";
}

export function BairrosPage() {
  const [ordem, setOrdem] = useState<Ordem>("volume");
  const [dias, setDias] = useState<Dias>(30);
  const [aberto, setAberto] = useState<{ bairro: BairroStats; posicao: number } | null>(null);
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data: comentarios = [], isLoading } = useQuery({
    queryKey: ["comentarios-localidade"],
    queryFn: () => fetchComentariosLocalidade(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: radar } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });

  // Recorte por período: `comments.data_comentario_ts` só existe em ~8% das
  // linhas (backfill parcial), então a janela vem do POST em que o comentário
  // está — mesma abordagem de agora.py::contar_comentarios_por_tema.
  const urlsPeriodo = useMemo(
    () => new Set(filtrarPorPeriodo(radar?.data ?? [], dias).map((p) => p.url)),
    [radar, dias]
  );
  const comentariosPeriodo = useMemo(
    () => (urlsPeriodo.size === 0 ? [] : comentarios.filter((c) => urlsPeriodo.has(c.urlPost))),
    [comentarios, urlsPeriodo]
  );

  const bairros = useMemo<BairroStats[]>(() => {
    const arr = agregarBairros(comentariosPeriodo);
    if (ordem === "negativo") arr.sort((a, b) => b.pctNeg - a.pctNeg || b.total - a.total);
    else arr.sort((a, b) => b.total - a.total || b.pctNeg - a.pctNeg);
    return arr;
  }, [comentariosPeriodo, ordem]);

  const totalMencoes = useMemo(() => bairros.reduce((s, b) => s + b.total, 0), [bairros]);

  // Mesma fatia usada no gráfico — a ordem aqui é a ordem das colunas, então é
  // ela que define a "posição no rank" mostrada no drill-down.
  const top = useMemo(() => bairros.slice(0, 12), [bairros]);

  const chartOption = useMemo(() => {
    const dados = [...top].reverse(); // ECharts horizontal: o último aparece no topo
    return {
      grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.tooltipText },
        formatter: (ps: { name: string; value: number; dataIndex: number }[]) => {
          const b = dados[ps[0].dataIndex];
          return `<b>${labelBairro(b.localidade)}</b><br/>${b.total} menções · ${b.pctNeg}% negativas<br/><span style="opacity:.7">clique para ver os comentários</span>`;
        },
      },
      xAxis: {
        type: "value",
        splitLine: { lineStyle: { color: ink.grid } },
        // Números maiores no eixo (pedido de 27/07: "aumente o tamanho dos
        // números das informações").
        axisLabel: { color: ink.axis, fontSize: 13, fontWeight: 700 },
      },
      yAxis: {
        type: "category",
        // Mantém o SLUG como valor da categoria — é o que os cliques no
        // gráfico devolvem em `p.name`/`p.value` (ver abrirPorNome). O
        // formatter só troca o que aparece na tela, sem o underscore.
        data: dados.map((b) => b.localidade),
        axisLine: { lineStyle: { color: ink.axisLine } },
        axisLabel: {
          color: ink.axis,
          fontSize: 13,
          fontWeight: 700,
          formatter: (v: string) => labelBairro(v),
        },
        triggerEvent: true, // o rótulo do bairro também abre o drill-down
      },
      series: [
        {
          type: "bar",
          // Sobe com a altura do card (29/07): 18px de barra dentro de um
          // gráfico de tela cheia deixava fio de cabelo separado por vão.
          barMaxWidth: 30,
          cursor: "pointer",
          emphasis: { itemStyle: { shadowBlur: 14, shadowColor: "rgba(251,146,60,0.55)" } },
          data: dados.map((b) => ({
            value: b.total,
            itemStyle: glassBar(corPct(b.pctNeg), { horizontal: true, radius: [0, 6, 6, 0] }),
          })),
        },
      ],
    };
  }, [top, ink]);

  /** Abre a coletânea do bairro a partir de um clique na barra ou no rótulo. */
  const abrirPorNome = (nome: string) => {
    const i = top.findIndex((b) => b.localidade === nome);
    if (i >= 0) setAberto({ bairro: top[i], posicao: i + 1 });
  };

  if (isLoading) return <div className="p-8 text-txt-2">Carregando bairros…</div>;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Mapa da Cidade</h1>
          <p className="text-base text-txt-2">
            Onde a conversa se concentra — bairros e locais citados nos comentários
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodoFilter dias={dias} onChange={setDias} />
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {([["volume", "Mais citados"], ["negativo", "Mais críticos"]] as [Ordem, string][]).map(
              ([id, label]) => (
                <button
                  key={id}
                  onClick={() => setOrdem(id)}
                  className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                    ordem === id ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                  }`}
                >
                  {label}
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {bairros.length === 0 ? (
        <div className="rounded-2xl border border-line bg-bg-1 p-8 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-bg-2 text-txt-3">
            <IconInbox size={20} />
          </div>
          <p className="font-semibold text-txt-1">
            Nenhum bairro identificado {periodoLabel(dias)}
          </p>
          <p className="mt-1 text-sm text-txt-2">
            Os locais são extraídos dos comentários pelo AGORA. Amplie o período acima ou
            aguarde a próxima coleta processar comentários citando bairros.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Locais citados</div>
              <div className="tnum mt-1 text-[2.75rem] font-semibold leading-none text-txt-1">{bairros.length}</div>
            </div>
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Menções com local</div>
              <div className="tnum mt-1 text-[2.75rem] font-semibold leading-none text-txt-1">{totalMencoes}</div>
            </div>
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Bairro mais citado</div>
              <div className="mt-1.5 truncate text-xl font-bold" style={{ color: "#3B82F6" }}>
                {(() => {
                  const l = [...bairros].sort((a, b) => b.total - a.total)[0]?.localidade;
                  return l ? labelBairro(l) : "—";
                })()}
              </div>
            </div>
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Bairro mais crítico</div>
              <div className="mt-1.5 truncate text-xl font-bold" style={{ color: "#EF4444" }}>
                {(() => {
                  const l = [...bairros].sort((a, b) => b.pctNeg - a.pctNeg)[0]?.localidade;
                  return l ? labelBairro(l) : "—";
                })()}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <div className="section-label">Menções por local (cor = % negativo)</div>
              <div className="text-[13px] text-txt-3">
                Clique numa barra para ler os comentários que a formaram
              </div>
            </div>
            {/* Pedido de 29/07: o gráfico passa a ocupar a tela toda. A altura
                era 30px por barra (12 bairros = 360px) e sobrava metade da
                página vazia embaixo. Agora a base é a altura da viewport menos
                o que fica acima do card (cabeçalho da página + os 4 KPIs +
                títulos, ~430px), limitada por um teto por barra: com 3 bairros
                no período o card não estica para 700px com três barras soltas
                dentro. */}
            <ReactECharts
              option={chartOption}
              style={{
                height: `min(calc(100vh - 430px), ${Math.min(12, bairros.length) * 60}px)`,
                minHeight: 280,
              }}
              notMerge
              onEvents={{
                // Barra: o nome vem em `name`. Rótulo do eixo (triggerEvent):
                // vem em `value`, e `name` fica vazio.
                click: (p: { name?: string; componentType?: string; value?: unknown }) => {
                  const nome =
                    p?.componentType === "yAxis" ? String(p?.value ?? "") : String(p?.name ?? "");
                  if (nome) abrirPorNome(nome);
                },
              }}
            />
          </div>
        </>
      )}

      {aberto && (
        <ComentariosBairroModal
          bairro={aberto.bairro}
          posicao={aberto.posicao}
          criterio={ordem}
          comentarios={comentariosPeriodo.filter((c) => c.localidade === aberto.bairro.localidade)}
          periodoLabel={periodoLabel(dias)}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}
