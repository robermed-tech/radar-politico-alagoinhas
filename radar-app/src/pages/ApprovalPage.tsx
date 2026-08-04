import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchRadar,
  fetchDailyMetrics,
  fetchComments,
  filtrarPorPeriodo,
  type Post,
  type Comment,
} from "@/lib/data";
import { calcIAD, calcICA } from "@/lib/indices";
import { KpiStat } from "@/components/KpiStat";
import { AlertaCrise } from "@/components/AlertaCrise";
import { AvisoAmostra } from "@/components/AvisoAmostra";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  TINTA_LINK_COMENTARIO,
} from "@/components/ComentarioBox";
import { fmtInt, fmtDiaBR } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, withAlpha, colorByIAD } from "@/lib/chartTheme";
import { IconInbox, IconTrendUp, IconTrendDown, IconHeart, IconWarningTriangle } from "@/components/icons";
import { PeriodoFilter, periodoLabel as rotuloPeriodo, type Dias } from "@/components/PeriodoFilter";
import { vozDestacavel } from "@/lib/sentimento";

interface AprovBucket {
  rotulo: string;
  pPos: number;
  pNeg: number;
  pNeu: number;
  posts: number;
  coments: number;
  cat: string;
}

function agrupar(posts: Post[], chave: (p: Post) => string, limite = 8): AprovBucket[] {
  const map: Record<string, { pos: number; neg: number; neu: number; posts: number; coments: number; cat: string }> = {};
  for (const p of posts) {
    const k = chave(p) || "—";
    map[k] ??= { pos: 0, neg: 0, neu: 0, posts: 0, coments: 0, cat: "" };
    const pPos = (p.comentarios_pct_pos || 0) / 100;
    const pNeg = (p.comentarios_pct_neg || 0) / 100;
    const pNeu = Math.max(0, 1 - pPos - pNeg);
    const w = 1 + Math.log10(1 + (p.comentarios_total || 0));
    map[k].pos += w * pPos;
    map[k].neg += w * pNeg;
    map[k].neu += w * pNeu;
    map[k].posts += 1;
    map[k].coments += p.comentarios_total || 0;
    if (p.categoria) map[k].cat = p.categoria; // categoria do perfil (consistente p/ perfil)
  }
  return Object.entries(map)
    .map(([rotulo, v]) => {
      const tot = v.pos + v.neg + v.neu || 1;
      return {
        rotulo,
        pPos: Math.round((v.pos / tot) * 100),
        pNeg: Math.round((v.neg / tot) * 100),
        pNeu: Math.round((v.neu / tot) * 100),
        posts: v.posts,
        coments: v.coments,
        cat: v.cat,
      };
    })
    .sort((a, b) => b.pPos - a.pPos || b.coments - a.coments)
    .slice(0, limite);
}

/** Classifica o lado político a partir da categoria do perfil. */
function classificaLado(cat: string): { label: string; cor: string } | null {
  const c = (cat || "").toLowerCase();
  if (c.includes("prefeit")) return { label: "Situação", cor: "#22C55E" };
  if (c.includes("oposi")) return { label: "Oposição", cor: "#EF4444" };
  if (c.includes("imprensa")) return { label: "Imprensa", cor: "#EAB308" };
  return null;
}

/** Gráfico de barras verticais agrupadas — críticas (vermelho) vs elogios (verde). */
function ChartVertical({
  buckets,
  ink,
  selRotulo,
  onSelect,
  height = 220,
}: {
  buckets: AprovBucket[];
  ink: ReturnType<typeof chartInk>;
  selRotulo?: string;
  onSelect?: (rotulo: string) => void;
  height?: number;
}) {
  const option = useMemo(() => ({
    grid: { top: 10, right: 6, bottom: buckets.length > 4 ? 68 : 48, left: 30 },
    tooltip: {
      trigger: "axis",
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: ink.tooltipText, fontSize: 12 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      formatter: (params: any[]) => {
        const idx = params[0]?.dataIndex ?? 0;
        const b = buckets[idx];
        if (!b) return "";
        const lado = classificaLado(b.cat || b.rotulo);
        const ladoTag = lado ? ` <span style="color:${lado.cor};font-weight:700">[${lado.label}]</span>` : "";
        const dot = (cor: string) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cor}"></span>`;
        return `<b>${b.rotulo}</b>${ladoTag}<br/>${dot("#EF4444")} Críticas: <b>${b.pNeg}%</b><br/>${dot("#22C55E")} Elogios: <b>${b.pPos}%</b><br/><span style="opacity:.6">${b.posts} post${b.posts !== 1 ? "s" : ""} · ${fmtInt(b.coments)} coment.</span>`;
      },
    },
    xAxis: {
      type: "category",
      data: buckets.map((b) => {
        const s = b.rotulo.replace(/^@/, "");
        return s.length > 12 ? s.slice(0, 11) + "…" : s;
      }),
      axisLabel: {
        color: ink.axis,
        fontSize: 12,
        interval: 0,
        rotate: buckets.length > 4 ? -38 : 0,
      },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: ink.axisLine } },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { color: ink.axis, fontSize: 11, formatter: "{value}" },
      splitLine: { lineStyle: { color: ink.grid } },
    },
    series: [
      {
        name: "Críticas",
        type: "bar",
        barMaxWidth: 20,
        barGap: "8%",
        data: buckets.map((b) => ({
          value: b.pNeg,
          itemStyle: {
            color: withAlpha("#EF4444", selRotulo === b.rotulo ? 1 : 0.72),
            borderRadius: [4, 4, 0, 0],
            shadowBlur: selRotulo === b.rotulo ? 10 : 0,
            shadowColor: withAlpha("#EF4444", 0.5),
          },
        })),
      },
      {
        name: "Elogios",
        type: "bar",
        barMaxWidth: 20,
        barGap: "8%",
        data: buckets.map((b) => ({
          value: b.pPos,
          itemStyle: {
            color: withAlpha("#22C55E", selRotulo === b.rotulo ? 1 : 0.72),
            borderRadius: [4, 4, 0, 0],
            shadowBlur: selRotulo === b.rotulo ? 10 : 0,
            shadowColor: withAlpha("#22C55E", 0.5),
          },
        })),
      },
    ],
  }), [buckets, selRotulo, ink]);

  return (
    <ReactECharts
      option={option}
      style={{ height, cursor: onSelect ? "pointer" : "default" }}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onEvents={onSelect ? { click: (p: any) => { const b = buckets[p.dataIndex]; if (b) onSelect(b.rotulo); } } : undefined}
      notMerge
    />
  );
}

/**
 * Velocímetro da APROVAÇÃO (prévia 2 de 04/08). Verde à DIREITA de propósito:
 * mede % de aprovação, 100 é o melhor cenário — o espelho do GaugeTema (% de
 * críticos, verde à esquerda). SVG puro; a agulha vibra por animação CSS de
 * transform (compositor, sobrevive à aba oculta — regra do velocímetro) e o
 * ângulo de repouso é aplicado por estilo no render, nunca por rAF.
 */
function GaugeAprovacao({ pct }: { pct: number }) {
  const ang = (Math.max(0, Math.min(100, pct)) / 100) * 180 - 90;
  return (
    <svg width="210" height="106" viewBox="0 0 220 112" aria-hidden className="mt-2">
      <style>{`
        @keyframes aprov-vibrar { 0%, 100% { transform: rotate(-0.7deg); } 50% { transform: rotate(0.7deg); } }
        .aprov-vibra { transform-origin: 110px 96px; animation: aprov-vibrar 1.1s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .aprov-vibra { animation: none; } }
      `}</style>
      <defs>
        <linearGradient id="gaprov" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#C22626" />
          <stop offset="50%" stopColor="#E8A400" />
          <stop offset="100%" stopColor="#137A3C" />
        </linearGradient>
      </defs>
      <path d="M20 96 A90 90 0 0 1 200 96" fill="none" stroke="url(#gaprov)" strokeWidth="12" strokeLinecap="round" />
      <g style={{ transform: `rotate(${ang}deg)`, transformOrigin: "110px 96px" }}>
        <g className="aprov-vibra">
          <line x1="110" y1="96" x2="110" y2="28" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      </g>
      <circle cx="110" cy="96" r="7" fill="currentColor" />
    </svg>
  );
}

function ChartLegend() {
  return (
    <div className="mt-2 flex items-center justify-center gap-5 text-[12px] text-txt-3">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-4 rounded-sm bg-risk-crit" />
        Críticas
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-4 rounded-sm bg-risk-low" />
        Elogios
      </span>
    </div>
  );
}

/** Um comentário na coluna de vozes. O `color` de sentimento saiu em 29/07: a
 *  coluna já se anuncia ("Vozes que aprovam"/"que reprovam"), e o box passou a
 *  ser o ComentarioBox comum a todo o painel. */
function ComentarioRow({ c }: { c: Comment }) {
  return (
    <ComentarioBox>
      <ComentarioTexto>
        {c.texto.slice(0, 220)}
        {c.texto.length > 220 ? "…" : ""}
      </ComentarioTexto>
      <ComentarioMeta>
        <span>
          @{c.username} · em @{c.autor_post}
        </span>
        {c.url_post && (
          <a
            href={c.url_post}
            target="_blank"
            rel="noopener noreferrer"
            className="font-bold hover:underline"
            style={{ color: TINTA_LINK_COMENTARIO }}
          >
            ver post ↗
          </a>
        )}
        <span className="tnum ml-auto flex shrink-0 items-center gap-1 font-bold" title="Curtidas do comentário">
          <IconHeart size={12} />
          {fmtInt(c.curtidas)} curtidas
        </span>
      </ComentarioMeta>
    </ComentarioBox>
  );
}

export function ApprovalPage() {
  // Período em destaque — padrão 24h (leitura mais próxima do tempo real).
  // O seletor permite ampliar para 7d/30d quando a amostra de 24h for pequena.
  const [dias, setDias] = useState<Dias>(7);
  // Carousel de temas: índice do tema exibido no card "Temas em Atenção"
  const [temaIdx, setTemaIdx] = useState(0);
  // Drill-down: filtra as "Vozes da população" pelo perfil/categoria clicado.
  const [filtroVoz, setFiltroVoz] = useState<{ tipo: "perfil" | "categoria"; valor: string } | null>(null);
  // Período das "Vozes da população" — independente do período dos índices.
  const [diasVozes, setDiasVozes] = useState<Dias>(7);
  const periodoLabel = rotuloPeriodo(dias);
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data: radar, isLoading: lr } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  const { data: hist } = useQuery({
    queryKey: ["daily-metrics"],
    queryFn: fetchDailyMetrics,
    staleTime: 5 * 60 * 1000,
  });
  const { data: coms } = useQuery({
    queryKey: ["comments"],
    queryFn: () => fetchComments(1000),
    staleTime: 5 * 60 * 1000,
  });

  const view = useMemo(() => {
    if (!radar) return null;
    const posts = filtrarPorPeriodo(radar.data, dias);
    if (posts.length === 0) return { vazio: true } as const;

    const iad = Math.round(calcIAD(posts));
    const ica = Math.round(calcICA(posts));

    // Drill-downs
    const porPerfil    = agrupar(posts, (p) => `@${p.autor}`, 8);
    // porTema ordenado por negatividade ↓ — tema mais crítico aparece no topo
    const porTema      = agrupar(posts, (p) => p.tema, 8).sort((a, b) => b.pNeg - a.pNeg);

    // Drivers do IAD: % positivo geral
    const totalComents = posts.reduce((s, p) => s + (p.comentarios_total || 0), 0);
    const totalPos = posts.reduce(
      (s, p) => s + ((p.comentarios_pct_pos || 0) / 100) * (p.comentarios_total || 0),
      0
    );
    const totalNeg = posts.reduce(
      (s, p) => s + ((p.comentarios_pct_neg || 0) / 100) * (p.comentarios_total || 0),
      0
    );
    const pctPos = totalComents > 0 ? Math.round((totalPos / totalComents) * 100) : 0;
    const pctNeg = totalComents > 0 ? Math.round((totalNeg / totalComents) * 100) : 0;
    const pctNeu = Math.max(0, 100 - pctPos - pctNeg);

    return {
      vazio: false as const,
      iad, ica, posts: posts.length, coments: totalComents,
      pctPos, pctNeg, pctNeu,
      porPerfil, porTema,
    };
  }, [radar, dias]);

  // Comentários cidadãos: top 5 mais curtidos que aprovam/reprovam,
  // filtrados pelo drill-down e pelo período (dia/semana/mês).
  const cms = useMemo(() => {
    let lista = (coms ?? []).filter((c) => c.tipo === "cidadao");
    if (filtroVoz) {
      if (filtroVoz.tipo === "perfil") {
        const alvo = filtroVoz.valor.replace(/^@/, "").toLowerCase();
        lista = lista.filter((c) => (c.autor_post || "").toLowerCase() === alvo);
      } else {
        const alvo = filtroVoz.valor.toLowerCase();
        lista = lista.filter((c) => (c.categoria_post || "").toLowerCase() === alvo);
      }
    }
    // Recorte temporal: usa data_comentario (YYYY-MM-DD). Comentário sem data
    // válida só aparece na visão mensal (não some do produto por falta de data).
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - diasVozes);
    cutoff.setHours(0, 0, 0, 0);
    lista = lista.filter((c) => {
      const d = c.data_comentario ? new Date(c.data_comentario) : null;
      if (!d || Number.isNaN(d.getTime())) return diasVozes >= 30;
      return d >= cutoff;
    });
    // fetchComments já vem ordenado por curtidas desc; reforça por segurança.
    lista = [...lista].sort((a, b) => (b.curtidas || 0) - (a.curtidas || 0));
    // Vitrine exige confiança >= CONFIANCA_MIN_DESTAQUE (70), acima do piso de
    // 50 da contagem: comentário fronteiriço (ex.: elogio a opositor gravado
    // como positivo com conf 50) parava em "Vozes que aprovam" como se
    // elogiasse a gestão. Ver lib/sentimento.ts::vozDestacavel.
    const pos = lista
      .filter((c) => c.sentimento === "positivo" && vozDestacavel(c))
      .slice(0, 5);
    const neg = lista
      .filter((c) => c.sentimento === "negativo" && vozDestacavel(c))
      .slice(0, 5);
    return { pos, neg };
  }, [coms, filtroVoz, diasVozes]);

  // Reseta o carousel ao trocar de período
  useEffect(() => { setTemaIdx(0); }, [view]);
  // Auto-avança o carousel a cada 4 s quando há mais de 1 tema
  useEffect(() => {
    if (!view || view.vazio || view.porTema.length <= 1) return;
    const id = setInterval(() => setTemaIdx((i) => (i + 1) % view.porTema.length), 4000);
    return () => clearInterval(id);
  }, [view]);

  // Histórico de IAD (últimos 14 dias)
  const histOption = useMemo(() => {
    const serie = (hist ?? []).slice(-30);
    return {
      grid: { left: 36, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis", backgroundColor: ink.tooltipBg, borderColor: ink.tooltipBorder, textStyle: { color: ink.tooltipText } },
      xAxis: {
        type: "category",
        data: serie.map((s) => fmtDiaBR(s.dia)),
        axisLine: { lineStyle: { color: ink.axisLine } },
        axisLabel: { color: ink.axis },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        splitLine: { lineStyle: { color: ink.grid } },
        axisLabel: { color: ink.axis },
      },
      // Cor por faixa: acima de 50% = azul (aprovação dominante),
      // 50% ou menos = vermelho (zona de alerta). Cor definida por PONTO via
      // lineStyle/itemStyle no proprio data item — NAO usar visualMap aqui:
      // visualMap (piecewise ou continuous, qualquer config) quebra o render
      // deste line chart no echarts 5.5.1 com "Cannot read properties of
      // undefined (reading 'coord')". Confirmado via repro isolado antes de
      // aplicar esta correcao — ver commit que introduz este comentario.
      series: [
        {
          name: "IAD",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 5,
          areaStyle: { color: withAlpha(ink.axis, 0.08) },
          markLine: {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: ink.axis, type: "dashed", opacity: 0.45 },
            data: [{ yAxis: 50 }],
          },
          data: serie.map((s) => {
            const cor = s.iad > 50 ? "#2563EB" : "#EF4444";
            return { value: s.iad, lineStyle: { color: cor, width: 2.5 }, itemStyle: { color: cor } };
          }),
        },
      ],
    };
  }, [hist, ink]);

  if (lr) return <div className="p-8 text-txt-2">Carregando aprovação…</div>;
  if (!view) return null;

  if (view.vazio)
    return (
      <div className="p-5">
        <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Análise do Clima</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6">
          <div className="flex items-center gap-2 font-bold text-txt-1">
            <IconInbox size={20} className="text-txt-3" />
            Sem dados no período
          </div>
          <div className="mt-2 space-y-1 text-sm text-txt-2">
            <div>• Fonte atual: <span className="font-semibold">{radar?.source === "supabase" ? "Supabase (Postgres)" : "Google Sheets"}</span></div>
            <div>• Próximas coletas: AGORA roda às <span className="font-semibold">08h, 14h e 19h BRT</span></div>
            <div>• Tente ampliar o período (24h → 7d → 30d) no seletor acima</div>
          </div>
        </div>
      </div>
    );

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Análise do Clima</h1>
          <p className="text-base text-txt-2">
            Drill-down do IAD · quem aprova, quem rejeita e por quais temas
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} ariaLabel="Período em destaque" />
      </div>

      {/* Aviso de amostra fraca */}
      <AvisoAmostra ica={view.ica} posts={view.posts} />

      {/* Prévia 2 de 04/08: o velocímetro da aprovação e a linha do tempo se
          FUNDEM num cartão único — quanto à esquerda, para onde vai à direita
          (a mesma fusão do hero da Análise por Perfil). O gauge é local e tem
          o verde à DIREITA de propósito: ele mede % de APROVAÇÃO (100 = ótimo),
          ao contrário do GaugeTema, que mede % de críticos (0 = ótimo) — não
          reaproveitar um no lugar do outro. */}
      <div className="grid overflow-hidden rounded-[20px] border border-line bg-bg-1 lg:grid-cols-[minmax(300px,1fr)_2fr]" style={{ boxShadow: "var(--shadow-ambient)" }}>
        <div className="flex flex-col items-center justify-center border-b border-line px-6 py-6 text-center lg:border-b-0 lg:border-r">
          <div className="section-label">Aprovação Digital</div>
          <GaugeAprovacao pct={view.iad} />
          <div className="tnum font-display text-[44px] font-bold leading-none" style={{ color: colorByIAD(view.iad) }}>
            {view.iad}%
          </div>
          <div className="mt-1.5 max-w-[26ch] text-[13px] font-semibold text-txt-3">
            dos comentários que tomam partido aprovam a gestão
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="section-label mb-1">Histórico do IAD · últimos 30 dias</div>
          <ReactECharts option={histOption} style={{ height: 208 }} notMerge />
        </div>
      </div>

      {/* KPIs restantes */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiStat
          label="Confiança"
          value={`${view.ica}%`}
          sub={
            view.ica < 40 ? (
              <span className="flex items-center gap-1">
                <IconWarningTriangle size={11} /> amostra insuficiente
              </span>
            ) : (
              "amostra confiável"
            )
          }
        />
        <KpiStat label="Comentários" value={fmtInt(view.coments)} sub={`${view.posts} posts (${periodoLabel})`} />
        {/* Temas em Atenção — 1 tema por vez, carousel automático */}
        {(() => {
          const temas = view.porTema;
          const tema = temas[temaIdx % Math.max(temas.length, 1)];
          const nivel = !tema ? null : tema.pNeg >= 50 ? "CRÍTICO" : tema.pNeg >= 30 ? "ATENÇÃO" : "MONITORAR";
          const cor = nivel === "CRÍTICO" ? "#EF4444" : nivel === "ATENÇÃO" ? "#EAB308" : "#6B7280";
          return (
            <div className="flex flex-col rounded-xl border border-line bg-bg-1 p-3">
              <div className="section-label">Temas em Atenção</div>
              {!tema ? (
                <div className="flex flex-1 items-center justify-center text-sm text-txt-3">Sem dados</div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-1">
                  <div
                    className="text-center text-2xl font-extrabold frase-cap leading-tight"
                    style={{ color: "var(--txt1)" }}
                  >
                    {tema.rotulo}
                  </div>
                  <span
                    className="rounded px-2 py-0.5 text-[12px] font-bold uppercase tracking-wider"
                    style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
                  >
                    {nivel}
                  </span>
                  <div className="text-[12px] text-txt-3">{tema.pNeg}% negativo</div>
                  {temas.length > 1 && (
                    <div className="mt-1 flex items-center gap-1">
                      {temas.map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setTemaIdx(i)}
                          className="rounded-full transition-all duration-300"
                          style={{
                            height: 5,
                            width: i === temaIdx % temas.length ? 14 : 5,
                            background: i === temaIdx % temas.length ? cor : "var(--line)",
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* (O card "Histórico do IAD" foi fundido no hero acima — prévia 2.) */}

      {/* Drill-downs */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-1 text-sm font-bold">Por perfil</div>
          <p className="mb-1 text-[12px] text-txt-3">Sentimento dos comentários por conta. Clique para filtrar ↓</p>
          <ChartVertical
            buckets={view.porPerfil}
            ink={ink}
            selRotulo={filtroVoz?.tipo === "perfil" ? filtroVoz.valor : undefined}
            onSelect={(rotulo) =>
              setFiltroVoz((cur) =>
                cur?.tipo === "perfil" && cur.valor === rotulo
                  ? null
                  : { tipo: "perfil", valor: rotulo }
              )
            }
          />
          <ChartLegend />
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-bold">Por tema <span className="text-[12px] font-normal text-txt-3">(+ crítico no topo)</span></div>
            {view.porTema[0] && view.porTema[0].pNeg >= 35 && (
              <AlertaCrise
                tema={view.porTema[0].rotulo}
                pNeg={view.porTema[0].pNeg}
                posts={view.porTema[0].posts}
                iad={view.iad}
              />
            )}
          </div>
          <ChartVertical buckets={view.porTema} ink={ink} />
          <ChartLegend />
        </div>
      </div>

      {/* Vozes da população */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="section-label">Vozes da população</span>
          {filtroVoz && (
            <button
              onClick={() => setFiltroVoz(null)}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand bg-brand/10 px-3 py-1 font-semibold text-txt-1 transition hover:bg-brand/20"
            >
              {filtroVoz.tipo === "perfil" ? filtroVoz.valor : `categoria: ${filtroVoz.valor}`}
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>
        {/* Era "Hoje / Semana / Mês" aqui e "24h / 7d / 30d" no filtro de cima,
            medindo exatamente a mesma janela com três vocabulários diferentes
            na mesma tela. Padronizado em 27/07. */}
        <PeriodoFilter dias={diasVozes} onChange={setDiasVozes} ariaLabel="Período das vozes" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center gap-1.5 font-display text-sm font-bold" style={{ color: "var(--success)" }}>
            <IconTrendUp size={16} />
            Vozes que aprovam (top 5 mais curtidos)
          </div>
          <div className="space-y-2">
            {cms.pos.length === 0 && (
              <div className="text-sm text-txt-3">
                Sem comentários positivos no Postgres (rode o AGORA com análise de sentimento por comentário).
              </div>
            )}
            {cms.pos.map((c) => (
              <ComentarioRow key={c.id} c={c} />
            ))}
          </div>
        </div>
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center gap-1.5 font-display text-sm font-bold" style={{ color: "var(--danger)" }}>
            <IconTrendDown size={16} />
            Vozes que reprovam (top 5 mais curtidos)
          </div>
          <div className="space-y-2">
            {cms.neg.length === 0 && (
              <div className="text-sm text-txt-3">
                Sem comentários negativos no Postgres.
              </div>
            )}
            {cms.neg.map((c) => (
              <ComentarioRow key={c.id} c={c} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
