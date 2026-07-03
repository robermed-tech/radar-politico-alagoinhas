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
import { fmtInt, fmtDiaBR } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassArea, glowLine, withAlpha, colorByIAD } from "@/lib/chartTheme";

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
        return `<b>${b.rotulo}</b>${ladoTag}<br/>🔴 Críticas: <b>${b.pNeg}%</b><br/>🟢 Elogios: <b>${b.pPos}%</b><br/><span style="opacity:.6">${b.posts} post${b.posts !== 1 ? "s" : ""} · ${fmtInt(b.coments)} coment.</span>`;
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
        fontSize: 10,
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
      axisLabel: { color: ink.axis, fontSize: 9, formatter: "{value}" },
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

function ChartLegend() {
  return (
    <div className="mt-2 flex items-center justify-center gap-5 text-[10px] text-txt-3">
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

function ComentarioRow({ c, color }: { c: Comment; color: string }) {
  return (
    <div
      className="rounded-lg border bg-bg-2 p-3 text-[13px] text-txt-1"
      style={{ borderColor: `${color}55` }}
    >
      <p className="italic">"{c.texto.slice(0, 220)}{c.texto.length > 220 ? "…" : ""}"</p>
      <div className="mt-2 flex items-center justify-between text-[11px]">
        <span className="text-txt-3">
          @{c.username} · em @{c.autor_post}
        </span>
        <span className="tnum font-bold" style={{ color }}>
          ❤ {fmtInt(c.curtidas)}
        </span>
      </div>
    </div>
  );
}

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7d" },
  { dias: 30, label: "30d" },
] as const;

export function ApprovalPage() {
  // Período em destaque — padrão 24h (leitura mais próxima do tempo real).
  // O seletor permite ampliar para 7d/30d quando a amostra de 24h for pequena.
  const [dias, setDias] = useState<number>(7);
  // Carousel de temas: índice do tema exibido no card "Temas em Atenção"
  const [temaIdx, setTemaIdx] = useState(0);
  // Drill-down: filtra as "Vozes da população" pelo perfil/categoria clicado.
  const [filtroVoz, setFiltroVoz] = useState<{ tipo: "perfil" | "categoria"; valor: string } | null>(null);
  const periodoLabel = PERIODOS.find((p) => p.dias === dias)?.label ?? `${dias}d`;
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
    const porCategoria = agrupar(posts, (p) => p.categoria, 6);
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
      porCategoria, porPerfil, porTema,
    };
  }, [radar, dias]);

  // Comentários cidadãos: top positivos e negativos, filtrados pelo drill-down
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
    const pos = lista.filter((c) => c.sentimento === "positivo").slice(0, 5);
    const neg = lista.filter((c) => c.sentimento === "negativo").slice(0, 5);
    return { pos, neg };
  }, [coms, filtroVoz]);

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
      series: [
        {
          name: "IAD",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 5,
          lineStyle: glowLine("#2563EB"),
          areaStyle: glassArea("#2563EB"),
          data: serie.map((s) => s.iad),
        },
      ],
    };
  }, [hist, ink]);

  if (lr) return <div className="p-8 text-txt-2">Carregando aprovação…</div>;
  if (!view) return null;

  if (view.vazio)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Análise do Clima</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6">
          <div className="font-bold text-txt-1">📭 Sem dados no período</div>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Análise do Clima</h1>
          <p className="text-sm text-txt-2">
            Drill-down do IAD · quem aprova, quem rejeita e por quais temas
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-line bg-bg-2 p-0.5"
          role="group"
          aria-label="Período em destaque"
        >
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              aria-pressed={dias === p.dias}
              className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                dias === p.dias
                  ? "bg-bg-1 text-txt-1 shadow-sm"
                  : "text-txt-3 hover:text-txt-1"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Aviso de amostra fraca */}
      <AvisoAmostra ica={view.ica} posts={view.posts} />

      {/* Header com índice + KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* IAD — número grande sem gauge */}
        <div className="flex flex-col items-center justify-center rounded-xl border border-line bg-bg-1 p-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">Aprovação Digital</div>
          <div className="mt-1 text-6xl font-extrabold leading-none" style={{ color: colorByIAD(view.iad) }}>
            {view.iad}%
          </div>
          <div className="mt-1 text-[10px] text-txt-3">IAD</div>
        </div>
        <KpiStat
          label="Confiança"
          value={view.ica}
          sub={view.ica < 40 ? "⚠ amostra insuficiente" : "amostra confiável"}
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
              <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">
                Temas em Atenção
              </div>
              {!tema ? (
                <div className="flex flex-1 items-center justify-center text-sm text-txt-3">Sem dados</div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-1.5 py-1">
                  <div
                    className="text-center text-2xl font-extrabold capitalize leading-tight"
                    style={{ color: "var(--txt1)" }}
                  >
                    {tema.rotulo}
                  </div>
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                    style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
                  >
                    {nivel}
                  </span>
                  <div className="text-[10px] text-txt-3">{tema.pNeg}% negativo</div>
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

      {/* Histórico */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Histórico do IAD (últimos 30 dias)</div>
        <ReactECharts option={histOption} style={{ height: 220 }} notMerge />
      </div>

      {/* Drill-downs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-1 text-sm font-bold">Por categoria</div>
          <p className="mb-1 text-[10px] text-txt-3">Clique na barra para filtrar comentários ↓</p>
          <ChartVertical
            buckets={view.porCategoria}
            ink={ink}
            selRotulo={filtroVoz?.tipo === "categoria" ? filtroVoz.valor : undefined}
            onSelect={(rotulo) =>
              setFiltroVoz((cur) =>
                cur?.tipo === "categoria" && cur.valor === rotulo
                  ? null
                  : { tipo: "categoria", valor: rotulo }
              )
            }
          />
          <ChartLegend />
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-1 text-sm font-bold">Por perfil</div>
          <p className="mb-1 text-[10px] text-txt-3">Sentimento dos comentários por conta. Clique para filtrar ↓</p>
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
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-bold">Por tema <span className="text-[10px] font-normal text-txt-3">(+ crítico no topo)</span></div>
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
      {filtroVoz && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-txt-3">Vozes filtradas por:</span>
          <button
            onClick={() => setFiltroVoz(null)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-brand bg-brand/10 px-3 py-1 font-semibold text-txt-1 transition hover:bg-brand/20"
          >
            {filtroVoz.tipo === "perfil" ? filtroVoz.valor : `categoria: ${filtroVoz.valor}`}
            <span aria-hidden>✕</span>
          </button>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 text-sm font-bold text-risk-low">
            🟢 Vozes que aprovam (top 5 mais curtidos)
          </div>
          <div className="space-y-2">
            {cms.pos.length === 0 && (
              <div className="text-sm text-txt-3">
                Sem comentários positivos no Postgres (rode o AGORA com análise de sentimento por comentário).
              </div>
            )}
            {cms.pos.map((c) => (
              <ComentarioRow key={c.id} c={c} color="#22C55E" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 text-sm font-bold text-risk-crit">
            🔴 Vozes que reprovam (top 5 mais curtidos)
          </div>
          <div className="space-y-2">
            {cms.neg.length === 0 && (
              <div className="text-sm text-txt-3">
                Sem comentários negativos no Postgres.
              </div>
            )}
            {cms.neg.map((c) => (
              <ComentarioRow key={c.id} c={c} color="#EF4444" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
