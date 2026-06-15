import { useMemo, useState } from "react";
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
import { Gauge } from "@/components/Gauge";
import { KpiStat } from "@/components/KpiStat";
import { AlertaCrise } from "@/components/AlertaCrise";
import { AvisoAmostra } from "@/components/AvisoAmostra";
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassArea, glowLine, glassGradient, withAlpha } from "@/lib/chartTheme";

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

/**
 * Barra divergente: críticas crescem para a ESQUERDA (vermelho), elogios para a
 * DIREITA (verde), a partir de um eixo central. Leitura instantânea de quem é
 * net-positivo (barra puxa p/ direita) vs net-negativo (puxa p/ esquerda).
 */
function BarraDivergente({ pPos, pNeg }: { pPos: number; pNeg: number }) {
  return (
    <div className="relative flex h-3 overflow-hidden rounded-full bg-bg-3">
      {/* metade esquerda — críticas (alinhadas à direita, crescem p/ esquerda) */}
      <div className="flex w-1/2 items-center justify-end">
        <div
          className="h-3 rounded-l-full bg-risk-crit"
          style={{ width: `${pNeg}%` }}
          title={`${pNeg}% críticas`}
        />
      </div>
      {/* metade direita — elogios (alinhados à esquerda, crescem p/ direita) */}
      <div className="flex w-1/2 items-center justify-start">
        <div
          className="h-3 rounded-r-full bg-risk-low"
          style={{ width: `${pPos}%` }}
          title={`${pPos}% elogios`}
        />
      </div>
      {/* marcador do eixo central */}
      <div
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2"
        style={{ background: "rgba(159,176,204,0.45)" }}
      />
    </div>
  );
}

function Bucket({
  b,
  mostrarLado,
  onClick,
  selecionado,
}: {
  b: AprovBucket;
  mostrarLado?: boolean;
  onClick?: () => void;
  selecionado?: boolean;
}) {
  const lado = mostrarLado ? classificaLado(b.cat || b.rotulo) : null;
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick()) : undefined}
      className={`rounded-lg border bg-bg-2 p-3 transition ${
        onClick ? "cursor-pointer hover:border-line-strong" : ""
      } ${selecionado ? "ring-2 ring-brand" : "border-line"}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-txt-1" title={b.rotulo}>
            {b.rotulo}
          </span>
          {lado && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
              style={{ background: `${lado.cor}1A`, color: lado.cor }}
            >
              {lado.label}
            </span>
          )}
        </div>
        <div className="tnum shrink-0 text-right">
          <span className="text-sm font-bold text-risk-low">{b.pPos}%</span>
          <span className="ml-2 text-xs text-risk-crit">{b.pNeg}%</span>
        </div>
      </div>
      <div className="mt-2">
        <BarraDivergente pPos={b.pPos} pNeg={b.pNeg} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-txt-3">
        <span>◀ críticas · elogios ▶</span>
        <span>{b.posts} posts · {fmtInt(b.coments)} coment.</span>
      </div>
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

  // Histórico de IAD (últimos 14 dias)
  const histOption = useMemo(() => {
    const serie = (hist ?? []).slice(-30);
    return {
      grid: { left: 36, right: 12, top: 16, bottom: 28 },
      tooltip: { trigger: "axis", backgroundColor: ink.tooltipBg, borderColor: ink.tooltipBorder, textStyle: { color: ink.tooltipText } },
      xAxis: {
        type: "category",
        data: serie.map((s) => s.dia.slice(5)),
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
        <h1 className="text-2xl font-extrabold">Aprovação</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Sem dados no período. Rode o AGORA para popular o Postgres.
        </div>
      </div>
    );

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Aprovação Digital</h1>
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
        {/* Gauge IAD — cor semafórica: verde ≥60, amarelo 40-59, vermelho <40 */}
        <div className="rounded-xl border border-line bg-bg-1 p-2">
          <Gauge
            value={view.iad}
            label="IAD (Aprovação)"
            color={view.iad >= 60 ? "#22C55E" : view.iad >= 40 ? "#EAB308" : "#EF4444"}
          />
        </div>
        <KpiStat
          label="Confiança"
          value={view.ica}
          sub={view.ica < 40 ? "⚠ amostra insuficiente" : "amostra confiável"}
        />
        <KpiStat label="Comentários" value={fmtInt(view.coments)} sub={`${view.posts} posts (${periodoLabel})`} />
        {/* Donut verde/vermelho — Aprova e Reprova em destaque, Neutro discreto */}
        <div className="rounded-xl border border-line bg-bg-1 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-txt-3">
            Aprova / Reprova
          </div>
          <div className="mt-1 flex items-center justify-between gap-1">
            {/* Aprova — número grande verde */}
            <div className="flex flex-col items-center">
              <span className="tnum text-3xl font-extrabold leading-none" style={{ color: "#22C55E" }}>
                {view.pctPos}%
              </span>
              <span className="mt-0.5 text-[10px] font-semibold text-txt-3">Aprova</span>
            </div>
            {/* Donut central — menor, só como apoio visual */}
            <ReactECharts
              option={{
                tooltip: { show: false },
                series: [{
                  type: "pie",
                  radius: ["56%", "82%"],
                  center: ["50%", "50%"],
                  label: { show: false },
                  labelLine: { show: false },
                  silent: true,
                  itemStyle: { borderRadius: 4, borderColor: withAlpha("#FFFFFF", 0.18), borderWidth: 1 },
                  data: [
                    { value: view.pctPos, itemStyle: { color: glassGradient("#22C55E"), shadowBlur: 10, shadowColor: withAlpha("#22C55E", 0.45) } },
                    { value: view.pctNeu, itemStyle: { color: glassGradient("#5F6E8C") } },
                    { value: view.pctNeg, itemStyle: { color: glassGradient("#EF4444"), shadowBlur: 10, shadowColor: withAlpha("#EF4444", 0.45) } },
                  ],
                }],
              }}
              style={{ height: 64, width: 64 }}
              notMerge
            />
            {/* Reprova — número grande vermelho */}
            <div className="flex flex-col items-center">
              <span className="tnum text-3xl font-extrabold leading-none" style={{ color: "#EF4444" }}>
                {view.pctNeg}%
              </span>
              <span className="mt-0.5 text-[10px] font-semibold text-txt-3">Reprova</span>
            </div>
          </div>
          {/* Neutro — discreto, abaixo */}
          <div className="mt-1.5 text-center text-[10px] text-txt-3">
            Neutro <span className="font-semibold">{view.pctNeu}%</span>
          </div>
        </div>
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
          <p className="mb-3 text-[10px] text-txt-3">Clique para ver os comentários ↓</p>
          <div className="space-y-2">
            {view.porCategoria.map((b) => (
              <Bucket
                key={b.rotulo}
                b={b}
                mostrarLado
                selecionado={filtroVoz?.tipo === "categoria" && filtroVoz.valor === b.rotulo}
                onClick={() =>
                  setFiltroVoz((cur) =>
                    cur?.tipo === "categoria" && cur.valor === b.rotulo
                      ? null
                      : { tipo: "categoria", valor: b.rotulo }
                  )
                }
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-1 text-sm font-bold">Por perfil</div>
          <p className="mb-3 text-[10px] leading-snug text-txt-3">
            A barra mostra o <b>sentimento dos comentários</b> no perfil — não o lado
            político. Verde = elogios, vermelho = críticas. Clique para ver os comentários ↓
          </p>
          <div className="space-y-2">
            {view.porPerfil.map((b) => (
              <Bucket
                key={b.rotulo}
                b={b}
                mostrarLado
                selecionado={filtroVoz?.tipo === "perfil" && filtroVoz.valor === b.rotulo}
                onClick={() =>
                  setFiltroVoz((cur) =>
                    cur?.tipo === "perfil" && cur.valor === b.rotulo
                      ? null
                      : { tipo: "perfil", valor: b.rotulo }
                  )
                }
              />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-bold">Por tema <span className="text-[10px] font-normal text-txt-3">(+ crítico no topo)</span></div>
            {/* Botão de alerta: aparece quando o tema mais crítico tem ≥ 35% negatividade */}
            {view.porTema[0] && view.porTema[0].pNeg >= 35 && (
              <AlertaCrise
                tema={view.porTema[0].rotulo}
                pNeg={view.porTema[0].pNeg}
                posts={view.porTema[0].posts}
                iad={view.iad}
              />
            )}
          </div>
          <div className="space-y-2">
            {view.porTema.map((b) => (
              <Bucket key={b.rotulo} b={b} />
            ))}
          </div>
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
