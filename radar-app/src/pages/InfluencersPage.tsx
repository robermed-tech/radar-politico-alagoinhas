import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import { fetchInfluencers, type Influencer, type Post } from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";
import { periodoLabel } from "@/components/PeriodoFilter";

// Cores DEFINITIVAS por lado político (decisão de produto, não inferência):
//   Oposição = VERMELHO · Aliado/Governo = VERDE · Imprensa = AMARELO
// A categoria do perfil manda; o alinhamento inferido só desempata.
// @jaldicenunes é oposição — sempre vermelho, independente do que a inferência disser.
// Nota LGPD: este ranking mostra APENAS perfis monitorados (contas
// institucionais, imprensa, aliados/oposição) — cidadãos comuns nunca
// entram aqui (ver fetchInfluencers em lib/data.ts).
const COR_OPOSICAO = "#EF4444";
const COR_ALIADO   = "#22C55E";
const COR_IMPRENSA = "#EAB308";
/** Contorno do destaque "mais postou no período" — laranja da marca. */
const COR_DESTAQUE = "#FB923C";

const OPOSICAO_FIXA = new Set(["jaldicenunes", "jadilcenunes"]);

function corInfluencer(i: Influencer): string {
  const handle = (i.handle || "").toLowerCase();
  if (OPOSICAO_FIXA.has(handle)) return COR_OPOSICAO;
  const cat = (i.categoria || "").toLowerCase();
  if (cat.includes("oposi")) return COR_OPOSICAO;
  if (cat.includes("imprensa")) return COR_IMPRENSA;
  if (cat.includes("prefei") || cat.includes("governo")) return COR_ALIADO;
  if (i.alinhamento === "opositor") return COR_OPOSICAO;
  if (i.alinhamento === "aliado") return COR_ALIADO;
  return COR_IMPRENSA;
}

/** Quantos perfis recebem o destaque de "mais ativo". */
const N_DESTAQUES = 3;

interface Props {
  /** Publicações do período selecionado — define quem mais usou as redes. */
  postsPeriodo?: Post[];
  dias?: number;
}

/**
 * Seção de influenciadores — antes era uma página própria na sidebar; a
 * reunião de 24/07 decidiu enxugar o menu e encaixar este conteúdo dentro de
 * "Análise por Perfil" (ver PerfilPage).
 *
 * Revisão de 27/07: o Mapa de Influência passou a destacar quem mais publicou
 * no período selecionado. O score composto (alcance · engajamento ·
 * frequência) é acumulado e muda devagar; o destaque responde à pergunta
 * "quem está usando mais as redes AGORA", que é outra coisa e vinha ficando
 * invisível no gráfico.
 */
export function InfluencersSection({ postsPeriodo = [], dias = 30 }: Props) {
  const ink = chartInk(useThemeStore((s) => s.theme));
  const { data, isLoading } = useQuery({
    queryKey: ["influencers"],
    queryFn: fetchInfluencers,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  // Todos os hooks ANTES de qualquer return condicional (Rules of Hooks)
  const lista = data ?? [];

  /** Publicações por handle no período — a métrica do destaque. */
  const postsPorHandle = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of postsPeriodo) {
      const h = (p.autor || "").trim().toLowerCase();
      if (!h) continue;
      m.set(h, (m.get(h) ?? 0) + 1);
    }
    return m;
  }, [postsPeriodo]);

  /** Handles com mais publicações no período (só quem publicou de fato). */
  const maisAtivos = useMemo(() => {
    const ativos = [...postsPorHandle.entries()].filter(([, n]) => n > 0);
    ativos.sort((a, b) => b[1] - a[1]);
    return new Set(ativos.slice(0, N_DESTAQUES).map(([h]) => h));
  }, [postsPorHandle]);

  // Gráfico horizontal de ranking — top 10 por score, colorido por alinhamento
  const rankingOption = useMemo(() => {
    const top10 = [...lista]
      .sort((a, b) => b.influencia_score - a.influencia_score)
      .slice(0, 10)
      .reverse(); // ECharts horizontal bar: último item aparece no topo
    return {
      grid: { left: 96, right: 108, top: 8, bottom: 24 },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: ink.tooltipBg,
        borderColor: ink.tooltipBorder,
        textStyle: { color: ink.tooltipText },
        extraCssText: "max-width: 260px; white-space: normal; line-height: 1.5;",
        formatter: (params: { dataIndex: number; value: number }[]) => {
          const p = params[0];
          const i = top10[p.dataIndex];
          if (!i) return "";
          const nPosts = postsPorHandle.get((i.handle || "").toLowerCase()) ?? 0;
          return (
            `<b>@${i.handle}</b> — <b>${p.value}</b> pts` +
            `<div style="margin-top:4px; opacity:0.85;">` +
            `Publicações ${periodoLabel(dias)}: <b>${nPosts}</b><br/>` +
            `Alcance: <b>${fmtInt(i.alcance)}</b> curtidas (peso 40%)<br/>` +
            `Engajamento: <b>${i.engajamento.toFixed(1)}</b> coments/post (peso 40%)<br/>` +
            `Frequência: <b>${i.frequencia}</b> posts (peso 20%)` +
            `</div>` +
            `<div style="margin-top:4px; font-size:10px; opacity:0.6;">` +
            `Cada quesito é normalizado de 0–100 em relação ao perfil líder do período.` +
            `</div>`
          );
        },
      },
      xAxis: {
        type: "value",
        axisLabel: { color: ink.axis, fontSize: 12 },
        splitLine: { lineStyle: { color: ink.grid } },
      },
      yAxis: {
        type: "category",
        data: top10.map((i) => i.handle),
        axisLabel: {
          color: ink.axis,
          fontSize: 12,
          // O perfil destacado ganha o marcador também no eixo, para quem lê
          // a lista de nomes antes de olhar as barras.
          formatter: (v: string) => (maisAtivos.has(v.toLowerCase()) ? `▶ @${v}` : `@${v}`),
        },
        axisLine: { lineStyle: { color: ink.axisLine } },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 18,
          // Estilo e rótulo por item (e não na série): o destaque muda por
          // barra, e `label.color` da série não aceita callback.
          data: top10.map((i) => {
            const destaque = maisAtivos.has((i.handle || "").toLowerCase());
            const base = glassBar(corInfluencer(i), { horizontal: true, radius: [0, 4, 4, 0] });
            const pts = Math.round(i.influencia_score);
            const nPosts = postsPorHandle.get((i.handle || "").toLowerCase()) ?? 0;
            return {
              value: pts,
              itemStyle: destaque
                ? {
                    ...base,
                    borderColor: COR_DESTAQUE,
                    borderWidth: 2,
                    shadowBlur: 14,
                    shadowColor: "rgba(251,146,60,0.55)",
                  }
                : { ...base, opacity: 0.7 },
              label: {
                show: true,
                position: "right",
                fontSize: 12,
                fontWeight: destaque ? "bold" : "normal",
                color: destaque ? COR_DESTAQUE : ink.axis,
                formatter: nPosts > 0 ? `${pts} pts · ${nPosts} pub.` : `${pts} pts`,
              },
            };
          }),
        },
      ],
    };
  }, [lista, ink, maisAtivos, postsPorHandle, dias]);

  // Early returns depois de todos os hooks
  if (isLoading) return <div className="text-sm text-txt-3">Carregando influenciadores…</div>;

  if (lista.length === 0) return null;

  const aliados = lista.filter((i) => corInfluencer(i) === COR_ALIADO).length;
  const opositores = lista.filter((i) => corInfluencer(i) === COR_OPOSICAO).length;
  const imprensa = lista.filter((i) => corInfluencer(i) === COR_IMPRENSA).length;

  const podio = [...postsPorHandle.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, N_DESTAQUES);

  return (
    <div className="space-y-3">
      <div>
        <div className="section-label">Influenciadores</div>
        <p className="text-sm text-txt-3">
          Ranking por score composto (alcance · engajamento · frequência) — perfis monitorados
        </p>
      </div>

      <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">
          Mapa de Influência
          <span className="ml-2 text-[12px] font-normal text-txt-3">
            top 10 por score · <span style={{ color: COR_ALIADO }}>verde=aliado</span> ·{" "}
            <span style={{ color: COR_OPOSICAO }}>vermelho=oposição</span> ·{" "}
            <span style={{ color: COR_IMPRENSA }}>amarelo=imprensa</span>
          </span>
        </div>
        <p className="mb-2 text-[13px] text-txt-3">
          Em <b style={{ color: COR_DESTAQUE }}>destaque com contorno laranja</b>: os{" "}
          {N_DESTAQUES} perfis que mais publicaram {periodoLabel(dias)}, ou seja, quem mais
          usou as redes no período, independente do score acumulado. Apenas contas
          institucionais, imprensa e perfis políticos; cidadãos não são rankeados
          nominalmente (LGPD).
        </p>

        {podio.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {podio.map(([handle, n], i) => (
              <span
                key={handle}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold"
                style={{
                  border: `1px solid ${COR_DESTAQUE}66`,
                  background: `${COR_DESTAQUE}14`,
                  color: COR_DESTAQUE,
                }}
              >
                <span className="tnum opacity-70">{i + 1}º</span>
                @{handle}
                <span className="tnum opacity-80">{fmtInt(n)} pub.</span>
              </span>
            ))}
          </div>
        )}

        <ReactECharts
          option={rankingOption}
          style={{ height: Math.max(160, Math.min(lista.length, 10) * 34 + 32) }}
          notMerge
        />
      </div>

      {/* Mapa de alinhamento */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="section-label" style={{ color: COR_ALIADO }}>
            Aliados
          </div>
          <div className="tnum mt-1 text-[40px] font-light leading-none" style={{ color: COR_ALIADO }}>{aliados}</div>
          <div className="text-xs text-txt-3">perfis favoráveis</div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="section-label" style={{ color: COR_IMPRENSA }}>
            Imprensa
          </div>
          <div className="tnum mt-1 text-[40px] font-light leading-none" style={{ color: COR_IMPRENSA }}>
            {imprensa}
          </div>
          <div className="text-xs text-txt-3">veículos de mídia</div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 px-4 py-3">
          <div className="section-label" style={{ color: COR_OPOSICAO }}>
            Oposição
          </div>
          <div className="tnum mt-1 text-[40px] font-light leading-none" style={{ color: COR_OPOSICAO }}>{opositores}</div>
          <div className="text-xs text-txt-3">perfis críticos</div>
        </div>
      </div>
    </div>
  );
}
