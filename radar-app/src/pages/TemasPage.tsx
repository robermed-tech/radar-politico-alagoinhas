import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchDailyThemes,
  fetchTemasMonitorados,
  fetchSubtemas,
  fetchComentariosPorTema,
  type DailyTheme,
  type TemaMonitorado,
  type SubtemaStat,
  type ComentarioTema,
} from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassBar, glassArea } from "@/lib/chartTheme";
import { AlertaCrise } from "@/components/AlertaCrise";
import { AssuntosEmAlta } from "@/components/AssuntosEmAlta";
import { IconTrendUp, IconTrendDown, IconCheckCircle, IconWarningTriangle } from "@/components/icons";
import { fmtDiaBR } from "@/lib/format";

// ── Métricas do gráfico — apenas Volume ──────────────────────────────────────
type Metrica = "volume";
const METRICAS: { id: Metrica; label: string; campo: keyof DailyTheme; cor: string }[] = [
  { id: "volume", label: "Volume (posts)", campo: "volume_posts", cor: "#3B82F6" },
];

// ── Regressão linear (unificada) ─────────────────────────────────────────────
function linearSlope(serie: number[]): number {
  const n = serie.length;
  if (n < 2) return 0;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY = serie.reduce((s, v) => s + v, 0);
  const sumXY = serie.reduce((s, v, i) => s + v * i, 0);
  const denom = n * sumX2 - sumX * sumX;
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

function direcao(s: number): "subindo" | "estavel" | "caindo" {
  if (s > 0.1) return "subindo";
  if (s < -0.1) return "caindo";
  return "estavel";
}

function direcaoSlope(serie: number[]): "subindo" | "estavel" | "caindo" {
  return direcao(linearSlope(serie));
}

const COR_OUTROS = "#94A3B8";

// ── Laço IRT: recuperação de imagem pós-alerta ───────────────────────────────
// Vocabulário da reunião de 24/07: "estabilizar" no lugar de "recuperar", e
// cinza neutro no lugar do vermelho ("não brinca com o vermelho").
// Revisão de 25/07: "Estabilizado" passou de verde para AMARELO — verde
// parecia caso encerrado; amarelo comunica "melhorou, mas segue observado".
const IRT_STATUS: Record<string, { label: string; cor: string }> = {
  monitorando: { label: "Monitorando",              cor: "#F59E0B" },
  recuperado:  { label: "Estabilizado",             cor: "#EAB308" },
  persistente: { label: "Persistente (reavaliar)",  cor: "#94A3B8" },
};
const IRT_TEND: Record<string, { label: string; cor: string }> = {
  em_queda: { label: "em queda", cor: "#22C55E" },
  estavel:  { label: "estável",  cor: "#9FB0CC" },
  em_alta:  { label: "em alta",  cor: "#EF4444" },
};

function TendenciaIcone({ tendencia, status }: { tendencia: string; status: string }) {
  if (status === "recuperado") return <IconCheckCircle size={14} />;
  if (status === "persistente") return <IconWarningTriangle size={14} />;
  if (tendencia === "em_queda") return <IconTrendDown size={14} />;
  if (tendencia === "em_alta") return <IconTrendUp size={14} />;
  return null;
}

/** Temas que dispararam alerta e estão em acompanhamento de recuperação (IRT/Benoit). */
function PainelRecuperacaoIRT() {
  const { data } = useQuery({
    queryKey: ["temas-monitorados"],
    queryFn: fetchTemasMonitorados,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const temas: TemaMonitorado[] = (data ?? []).slice(0, 6);
  if (temas.length === 0) return null;

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="text-sm font-bold">Estabilização pós-alerta</div>
      <p className="mb-3 text-[12px] text-txt-3">
        Temas que dispararam alerta ficam em acompanhamento — queda sustentada indica que a resposta funcionou
      </p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {temas.map((t) => {
          const st = IRT_STATUS[t.status] ?? IRT_STATUS.monitorando;
          const td = IRT_TEND[t.tendencia] ?? IRT_TEND.estavel;
          return (
            <div key={t.tema} className="rounded-lg border border-line bg-bg-2 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold capitalize text-txt-1">{t.tema}</span>
                <span
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-bold uppercase"
                  style={{ background: `${st.cor}1A`, color: st.cor }}
                >
                  <TendenciaIcone tendencia={t.tendencia} status={t.status} />
                  {st.label}
                </span>
              </div>
              <div className="mt-1 text-[13px] text-txt-3">
                pico em {fmtDiaBR(t.pico_em)} · volume {t.volume_pico}→{t.volume_atual} posts
                {" · "}
                <span className="font-semibold" style={{ color: td.cor }}>{td.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Drill-down de subtemas (comments.subtema) ────────────────────────────────
const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};
function labelTemaSub(t: string): string {
  return TEMA_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "—");
}
function labelSub(s: string): string {
  return s.replace(/_/g, " ");
}

function normStr(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

const SENT_COR: Record<string, string> = {
  negativo: "#EF4444",
  positivo: "#22C55E",
  neutro: "#9FB0CC",
};

/** Lista os comentários crus (texto real) de um tema+subtema selecionado. */
function ComentariosDrill({
  sel,
  comentarios,
  onFechar,
}: {
  sel: { tema: string; subtema: string };
  comentarios: ComentarioTema[];
  onFechar: () => void;
}) {
  const lista = useMemo(() => {
    const nt = normStr(sel.tema);
    const ns = normStr(sel.subtema);
    return comentarios
      .filter((c) => normStr(c.tema) === nt && normStr(c.subtema) === ns && c.texto.length > 2)
      .sort(
        (a, b) =>
          (a.sentimento === "negativo" ? 0 : 1) - (b.sentimento === "negativo" ? 0 : 1) ||
          b.curtidas - a.curtidas
      )
      .slice(0, 15);
  }, [sel, comentarios]);

  return (
    <div className="mt-3 rounded-lg border border-brand/40 bg-bg-2 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-txt-1">
          {labelTemaSub(sel.tema)} · <span className="capitalize">{labelSub(sel.subtema)}</span>
          <span className="ml-2 text-[13px] font-normal text-txt-3">
            o que as pessoas realmente escreveram
          </span>
        </div>
        <button
          onClick={onFechar}
          className="rounded px-2 py-0.5 text-[13px] text-txt-3 hover:text-txt-1"
        >
          ✕ fechar
        </button>
      </div>
      {lista.length === 0 ? (
        <p className="text-[13px] text-txt-3">
          Nenhum comentário com texto classificado para este subtema ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((c, i) => (
            <li key={i} className="rounded-md border border-line bg-bg-1 p-2.5">
              <p className="text-[14px] leading-relaxed text-txt-1">{c.texto}</p>
              <div className="mt-1 flex items-center gap-2 text-[13px] text-txt-3">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: SENT_COR[c.sentimento] ?? SENT_COR.neutro }}
                />
                <span className="capitalize">{c.sentimento}</span>
                {c.autor && <span>· @{c.autor}</span>}
                {c.curtidas > 0 && <span className="ml-auto tnum">♥ {c.curtidas}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Linha do tempo do clima: % de críticas por dia, com pins anotando o TEMA que
 * puxou cada virada da curva ("dia 28 caiu, 29 subiu — por causa de X"). O tema
 * dominante do dia é o que mais pesa na negatividade (pct_neg × volume). Usa só
 * daily_themes já carregado — sem query extra.
 */
function TimelineClima({ themes, janela }: { themes: DailyTheme[]; janela: number }) {
  const ink = chartInk(useThemeStore((s) => s.theme));

  const model = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cut = cutoff.toISOString().slice(0, 10);
    const rows = themes.filter((r) => r.dia >= cut);
    const dias = Array.from(new Set(rows.map((r) => r.dia))).sort();
    if (dias.length < 2) return null;

    const perDia = dias.map((dia) => {
      const rs = rows.filter((r) => r.dia === dia);
      let vol = 0, negW = 0, domTema = "", domScore = -1;
      for (const r of rs) {
        const v = r.volume_coments || r.volume_posts || 0;
        vol += v;
        negW += (r.pct_neg || 0) * v;
        const score = ((r.pct_neg || 0) / 100) * v; // peso do tema na negatividade do dia
        if (score > domScore && r.tema && r.tema.toLowerCase() !== "outros") {
          domScore = score;
          domTema = r.tema;
        }
      }
      return { dia, pctNeg: vol ? Math.round(negW / vol) : 0, vol, domTema };
    });

    // Dias notáveis: maiores variações dia-a-dia + o pico global de críticas.
    const deltas = perDia.map((d, i) => (i === 0 ? 0 : d.pctNeg - perDia[i - 1].pctNeg));
    const topDelta = perDia
      .map((_, i) => i)
      .filter((i) => i > 0)
      .sort((a, b) => Math.abs(deltas[b]) - Math.abs(deltas[a]))
      .slice(0, 3);
    const peak = perDia.reduce((mi, d, i, arr) => (d.pctNeg > arr[mi].pctNeg ? i : mi), 0);
    // Piso de volume: não anota dias quase vazios (poucos comentários = ruído).
    const marcados = Array.from(new Set([...topDelta, peak])).filter(
      (i) => perDia[i].vol >= 10 && perDia[i].domTema && Math.abs(deltas[i]) >= 3
    );
    return { perDia, deltas, marcados };
  }, [themes, janela]);

  if (!model) return null;
  const { perDia } = model;
  // Revisão de 25/07: os balões (pins) que anotavam o tema de cada virada
  // saíram do gráfico — a informação continua disponível no tooltip do dia.

  const option = {
    grid: { left: 38, right: 16, top: 30, bottom: 34 },
    tooltip: {
      trigger: "axis",
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (ps: { dataIndex: number }[]) => {
        const d = perDia[ps[0].dataIndex];
        return (
          `<b>${fmtDiaBR(d.dia)}</b><br/>${d.pctNeg}% críticas<br/>` +
          (d.domTema ? `puxado por: <b>${labelTemaSub(d.domTema)}</b><br/>` : "") +
          `${d.vol} comentários`
        );
      },
    },
    xAxis: {
      type: "category",
      data: perDia.map((d) => fmtDiaBR(d.dia)),
      boundaryGap: false,
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 12 },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: { color: ink.axis, fontSize: 12, formatter: (v: number) => `${v}%` },
    },
    series: [
      {
        type: "line",
        smooth: true,
        data: perDia.map((d) => d.pctNeg),
        lineStyle: { color: "#EF4444", width: 2 },
        itemStyle: { color: "#EF4444" },
        areaStyle: glassArea("#EF4444"),
      },
    ],
  };

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="text-sm font-bold">Linha do tempo do clima</div>
      <p className="mb-2 text-[12px] text-txt-3">
        % de críticas por dia — passe o mouse num ponto para ver o tema que puxou aquele dia
      </p>
      <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate />
    </div>
  );
}

/** Detalha cada tema nos seus subtemas mais falados (a partir dos comentários). */
function PainelSubtemas() {
  const { data = [] } = useQuery({
    queryKey: ["subtemas"],
    queryFn: fetchSubtemas,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { data: comentarios = [] } = useQuery({
    queryKey: ["comentarios-tema"],
    queryFn: () => fetchComentariosPorTema(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const [sel, setSel] = useState<{ tema: string; subtema: string } | null>(null);

  const porTema = useMemo(() => {
    const by: Record<string, SubtemaStat[]> = {};
    for (const s of data) (by[s.tema] ??= []).push(s);
    return Object.entries(by)
      .map(([tema, subs]) => ({
        tema,
        total: subs.reduce((n, s) => n + s.total, 0),
        subs: subs.sort((a, b) => b.total - a.total).slice(0, 5),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);
  }, [data]);

  if (porTema.length === 0) return null;

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="text-sm font-bold">Dentro de cada tema</div>
      <p className="mb-3 text-[12px] text-txt-3">
        O que exatamente o cidadão fala — clique num subtema para ler os comentários
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {porTema.map((t) => {
          const max = t.subs[0]?.total || 1;
          return (
            <div key={t.tema} className="rounded-lg border border-line bg-bg-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-txt-1">{labelTemaSub(t.tema)}</span>
                <span className="tnum text-[13px] text-txt-3">{t.total} menções</span>
              </div>
              <div className="space-y-1.5">
                {t.subs.map((s) => {
                  const ativo = sel?.tema === t.tema && sel?.subtema === s.subtema;
                  return (
                    <button
                      key={s.subtema}
                      onClick={() =>
                        setSel(ativo ? null : { tema: t.tema, subtema: s.subtema })
                      }
                      className={`w-full rounded px-1 py-0.5 text-left transition hover:bg-bg-1 ${
                        ativo ? "bg-bg-1 ring-1 ring-brand/40" : ""
                      }`}
                      title="Ver comentários deste subtema"
                    >
                      <div className="flex items-center justify-between gap-2 text-[13px]">
                        <span className="min-w-0 flex-1 truncate capitalize text-txt-2">{labelSub(s.subtema)}</span>
                        <span className="tnum shrink-0 text-txt-3">{s.total}</span>
                      </div>
                      <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-bg-1">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round((s.total / max) * 100)}%`,
                            background: s.pctNeg >= 50 ? "#EF4444" : s.pctNeg >= 30 ? "#F97316" : "#3B82F6",
                          }}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {sel && (
        <ComentariosDrill sel={sel} comentarios={comentarios} onFechar={() => setSel(null)} />
      )}
    </div>
  );
}

// ── Interfaces ───────────────────────────────────────────────────────────────
interface TemaResumido {
  tema: string;
  pctNeg: number;
  pctPos: number;
  volume: number;
  direcao: "subindo" | "estavel" | "caindo";
}

interface TemaStats {
  tema: string;
  serie: number[];
  dias: string[];
  total: number;
  s: number;
  ultimo: number;
}

function toLabel(tema: string): string {
  return tema.charAt(0).toUpperCase() + tema.slice(1);
}

// ── buildTemas: agrega daily_themes por tema para alertaTema ─────────────────
function buildTemas(themes: DailyTheme[]): TemaResumido[] {
  const byTema: Record<string, number[]>    = {};
  const byTemaVol: Record<string, number>   = {};
  const byTemaPos: Record<string, number[]> = {};
  const byTemaNeg: Record<string, number[]> = {};

  for (const t of themes) {
    const k = t.tema?.toLowerCase() || "outros";
    byTema[k] = byTema[k] ?? [];
    byTema[k].push(t.pct_neg);
    byTemaVol[k] = (byTemaVol[k] ?? 0) + t.volume_posts;
    byTemaPos[k] = byTemaPos[k] ?? [];
    byTemaPos[k].push(t.pct_pos);
    byTemaNeg[k] = byTemaNeg[k] ?? [];
    byTemaNeg[k].push(t.pct_neg);
  }

  return Object.entries(byTema)
    .map(([tema, serie]) => {
      const ultPos = byTemaPos[tema] ?? [];
      const ultNeg = byTemaNeg[tema] ?? [];
      return {
        tema,
        pctNeg: Math.round(ultNeg.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultNeg.length))),
        pctPos: Math.round(ultPos.slice(-3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, ultPos.length))),
        volume: byTemaVol[tema] ?? 0,
        direcao: direcaoSlope(serie),
      };
    })
    .filter((t) => t.volume > 0)
    .sort((a, b) => b.pctNeg - a.pctNeg || b.volume - a.volume);
}

// ── Página ───────────────────────────────────────────────────────────────────
export function TemasPage() {
  const metrica: Metrica = "volume";
  const [janela, setJanela] = useState(14);
  const ink = chartInk(useThemeStore((s) => s.theme));

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ["daily-themes"],
    queryFn: fetchDailyThemes,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });
  // Tema mais crítico (para AlertaCrise)
  const temas = useMemo(() => buildTemas(themes), [themes]);
  const alertaTema = temas[0];

  // Dados de tendência para os gráficos
  const view = useMemo(() => {
    if (themes.length === 0) return null;
    const metr    = METRICAS.find((m) => m.id === metrica)!;
    const cutoff  = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const filtradas = themes.filter((r) => r.dia >= cutoffStr);
    const dias      = Array.from(new Set(filtradas.map((r) => r.dia))).sort();
    const temasList = Array.from(new Set(filtradas.map((r) => r.tema)));

    const stats: TemaStats[] = temasList.map((t) => {
      const map: Record<string, number> = {};
      filtradas.filter((r) => r.tema === t).forEach((r) => {
        map[r.dia] = Number(r[metr.campo] ?? 0);
      });
      const serie = dias.map((d) => map[d] ?? 0);
      return {
        tema:   t,
        serie,
        dias,
        total:  serie.reduce((s, v) => s + v, 0),
        s:      linearSlope(serie),
        ultimo: serie.at(-1) ?? 0,
      };
    });

    stats.sort((a, b) => b.total - a.total);
    const outrosTemasSet = new Set(stats.slice(7).map((s) => s.tema));
    return { stats, outrosTemasSet, metr };
  }, [themes, metrica, janela]);

  if (isLoading) return <div className="p-8 text-txt-2">Carregando tendências…</div>;

  if (!view || themes.length === 0)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Previsões</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico de temas. Execute o fluxo ÁGORA para popular.
        </div>
      </div>
    );

  const { stats, outrosTemasSet, metr } = view;

  // Exclui "outros" do gráfico e das listas — categoria residual da IA
  const movers = [...stats]
    .filter((s) => s.tema !== "outros")
    .sort((a, b) => Math.abs(b.s) - Math.abs(a.s))
    .slice(0, 12)
    .sort((a, b) => a.s - b.s);

  // Vermelho = subindo (mais negativo/volume = alarme), Verde = caindo (melhora)
  const corSlope = (s: number) => (s > 0.1 ? "#EF4444" : s < -0.1 ? "#22C55E" : "#9FB0CC");

  // Os slopes são em unidades/dia → multiplicar ×7 para exibir por semana (mais legível)
  const fmtSlope = (s: number) => {
    const v = s * 7;
    return (v >= 0 ? "+" : "") + v.toFixed(1);
  };

  const option = {
    grid: { left: 36, right: 20, top: 16, bottom: 72 },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: ink.tooltipBg,
      borderColor: ink.tooltipBorder,
      textStyle: { color: ink.tooltipText },
      formatter: (ps: { name: string; value: number }[]) => {
        const v = Number(ps[0].value);
        const dir = v > 0.1 ? "subindo" : v < -0.1 ? "caindo" : "estável";
        const unidade = metrica === "volume" ? "posts/sem" : "pt/sem";
        const semanal = (v * 7).toFixed(1);
        return `<b>${ps[0].name}</b><br/>${dir}: ${Number(semanal) > 0 ? "+" : ""}${semanal} ${unidade}`;
      },
    },
    xAxis: {
      type: "category",
      data: movers.map((s) => toLabel(s.tema)),
      axisLine: { lineStyle: { color: ink.axisLine } },
      axisLabel: { color: ink.axis, fontSize: 12, rotate: 30, interval: 0 },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: ink.grid } },
      axisLabel: {
        color: ink.axis,
        fontSize: 12,
        formatter: (v: number) => fmtSlope(v),
      },
    },
    series: [
      {
        type: "bar",
        barMaxWidth: 42,
        data: movers.map((s) => ({
          value: Number(s.s.toFixed(3)),
          itemStyle: glassBar(corSlope(s.s), {
            horizontal: false,
            radius: s.s >= 0 ? [6, 6, 0, 0] : [0, 0, 6, 6],
          }),
        })),
      },
    ],
  };

  const subindo = stats.filter((s) => direcao(s.s) === "subindo" && s.tema !== "outros");
  const caindo  = stats.filter((s) => direcao(s.s) === "caindo"  && s.tema !== "outros");

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho + controles */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Previsões</h1>
          <p className="text-sm text-txt-2">
            Evolução de cada tema — quem está subindo, estável ou caindo
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex rounded-lg border border-line bg-bg-1 p-1">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setJanela(d)}
                className={`rounded-md px-3 py-1 text-sm font-semibold transition ${
                  janela === d ? "bg-brand text-white" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Linha do tempo do clima — curva de críticas anotada com o tema que a moveu */}
      <TimelineClima themes={themes} janela={janela} />

      {/* Assuntos que se repetem em 24h (gatilho por volume de subtema) */}
      <AssuntosEmAlta />

      {/* Laço IRT: recuperação de imagem pós-alerta (só aparece quando há tema monitorado) */}
      <PainelRecuperacaoIRT />

      {/* Drill-down de subtemas (a partir dos comentários) */}
      <PainelSubtemas />

      {/* Subindo + Caindo lado a lado */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-bold uppercase tracking-wide text-risk-crit">
              ▲ Subindo ({subindo.length})
            </div>
            {alertaTema && alertaTema.pctNeg >= 35 && (
              <AlertaCrise
                tema={alertaTema.tema}
                pNeg={alertaTema.pctNeg}
                posts={alertaTema.volume}
                iad={alertaTema.pctPos}
              />
            )}
          </div>
          <div className="space-y-1.5">
            {subindo.slice(0, 5).map((s) => {
              const isOut = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span className="tnum shrink-0 font-bold" style={{ color: isOut ? COR_OUTROS : "#EF4444" }}>
                    +{s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                  </span>
                </div>
              );
            })}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>

        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-risk-low">
            ▼ Caindo ({caindo.length})
          </div>
          <div className="space-y-1.5">
            {caindo.slice(0, 5).map((s) => {
              const isOut = outrosTemasSet.has(s.tema);
              return (
                <div key={s.tema} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                    {s.tema}
                  </span>
                  <span className="tnum shrink-0 font-bold" style={{ color: isOut ? COR_OUTROS : "#22C55E" }}>
                    {s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                  </span>
                </div>
              );
            })}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Gráfico de variação divergente */}
      <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-bold">
              {metr.label} · variação por tema (janela {janela}d)
            </div>
            <div className="text-[12px] text-txt-3">
              Barras mostram variação semanal — passa o mouse para ver o valor exato
            </div>
          </div>
          <div className="flex items-center gap-3 text-[12px] text-txt-3">
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-risk-crit" /> subindo</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-risk-low" /> caindo</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-txt-3" /> estável</span>
          </div>
        </div>
        <ReactECharts
          option={option}
          style={{ height: 260 }}
          notMerge
        />
      </div>

    </div>
  );
}
