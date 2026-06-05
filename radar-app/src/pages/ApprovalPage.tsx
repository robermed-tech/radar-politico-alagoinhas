import { useMemo } from "react";
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
import { fmtInt } from "@/lib/format";
import { useThemeStore } from "@/stores/theme";
import { chartInk } from "@/lib/chartTheme";

interface AprovBucket {
  rotulo: string;
  pPos: number;
  pNeg: number;
  pNeu: number;
  posts: number;
  coments: number;
}

function agrupar(posts: Post[], chave: (p: Post) => string, limite = 8): AprovBucket[] {
  const map: Record<string, { pos: number; neg: number; neu: number; posts: number; coments: number }> = {};
  for (const p of posts) {
    const k = chave(p) || "—";
    map[k] ??= { pos: 0, neg: 0, neu: 0, posts: 0, coments: 0 };
    const pPos = (p.comentarios_pct_pos || 0) / 100;
    const pNeg = (p.comentarios_pct_neg || 0) / 100;
    const pNeu = Math.max(0, 1 - pPos - pNeg);
    const w = 1 + Math.log10(1 + (p.comentarios_total || 0));
    map[k].pos += w * pPos;
    map[k].neg += w * pNeg;
    map[k].neu += w * pNeu;
    map[k].posts += 1;
    map[k].coments += p.comentarios_total || 0;
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
      };
    })
    .sort((a, b) => b.pPos - a.pPos || b.coments - a.coments)
    .slice(0, limite);
}

function Barra({ pPos, pNeg, pNeu }: { pPos: number; pNeg: number; pNeu: number }) {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-bg-3">
      <div className="bg-risk-low" style={{ width: `${pPos}%` }} title={`${pPos}% pos`} />
      <div style={{ width: `${pNeu}%`, background: "#5F6E8C" }} title={`${pNeu}% neu`} />
      <div className="bg-risk-crit" style={{ width: `${pNeg}%` }} title={`${pNeg}% neg`} />
    </div>
  );
}

function Bucket({ b }: { b: AprovBucket }) {
  return (
    <div className="rounded-lg border border-line bg-bg-2 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate font-semibold text-txt-1" title={b.rotulo}>
          {b.rotulo}
        </div>
        <div className="tnum text-right">
          <span className="text-sm font-bold text-risk-low">{b.pPos}%</span>
          <span className="ml-2 text-xs text-risk-crit">{b.pNeg}%</span>
        </div>
      </div>
      <div className="mt-2">
        <Barra {...b} />
      </div>
      <div className="mt-1 text-[10px] text-txt-3">
        {b.posts} posts · {fmtInt(b.coments)} comentários
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

export function ApprovalPage() {
  const dias = 30;
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
    const porTema      = agrupar(posts, (p) => p.tema, 8);

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
  }, [radar]);

  // Comentários cidadãos: top positivos e negativos
  const cms = useMemo(() => {
    const lista = (coms ?? []).filter((c) => c.tipo === "cidadao");
    const pos = lista.filter((c) => c.sentimento === "positivo").slice(0, 5);
    const neg = lista.filter((c) => c.sentimento === "negativo").slice(0, 5);
    return { pos, neg };
  }, [coms]);

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
          lineStyle: { width: 3, color: "#2563EB" },
          areaStyle: { color: "rgba(37,99,235,0.15)" },
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
      <div>
        <h1 className="text-2xl font-extrabold">Aprovação Digital</h1>
        <p className="text-sm text-txt-2">
          Drill-down do IAD · quem aprova, quem rejeita e por quais temas
        </p>
      </div>

      {/* Header com índice + KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-line bg-bg-1 p-2">
          <Gauge value={view.iad} label="IAD (Aprovação)" color="#3B82F6" />
        </div>
        <KpiStat
          label="Confiança"
          value={view.ica}
          sub={view.ica < 40 ? "⚠ amostra insuficiente" : "amostra confiável"}
        />
        <KpiStat label="Comentários" value={fmtInt(view.coments)} sub={`${view.posts} posts (30d)`} />
        <KpiStat
          label="Aprova / Reprova"
          value={`${view.pctPos}% / ${view.pctNeg}%`}
          sub={`${view.pctNeu}% neutro`}
        />
      </div>

      {/* Histórico */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 text-sm font-bold">Histórico do IAD (últimos 30 dias)</div>
        <ReactECharts option={histOption} style={{ height: 220 }} notMerge />
      </div>

      {/* Drill-downs */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 text-sm font-bold">Por categoria</div>
          <div className="space-y-2">
            {view.porCategoria.map((b) => (
              <Bucket key={b.rotulo} b={b} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 text-sm font-bold">Por perfil</div>
          <div className="space-y-2">
            {view.porPerfil.map((b) => (
              <Bucket key={b.rotulo} b={b} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 text-sm font-bold">Por tema</div>
          <div className="space-y-2">
            {view.porTema.map((b) => (
              <Bucket key={b.rotulo} b={b} />
            ))}
          </div>
        </div>
      </div>

      {/* Vozes da população */}
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
