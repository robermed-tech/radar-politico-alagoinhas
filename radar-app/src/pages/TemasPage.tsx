import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactECharts from "echarts-for-react";
import {
  fetchDailyThemes,
  fetchSubtemas,
  fetchComentariosPorTema,
  type DailyTheme,
  type SubtemaStat,
  type ComentarioTema,
} from "@/lib/data";
import { useThemeStore } from "@/stores/theme";
import { chartInk, glassArea } from "@/lib/chartTheme";
import { AlertaCrise } from "@/components/AlertaCrise";
import { fmtDiaBR } from "@/lib/format";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
  tintaSentimento,
} from "@/components/ComentarioBox";
import { PeriodoFilter, periodoFrase, type Dias } from "@/components/PeriodoFilter";

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

// Cinza QUENTE (11/08/26): era o slate azulado #94A3B8, destoando da família
// creme/chumbo do card em que a série é desenhada. Luminância equivalente.
const COR_OUTROS = "#95A6AB";

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
    <div className="mt-3 rounded-lg border border-brand/40 bg-bg-1 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-bold text-txt-1">
          {labelTemaSub(sel.tema)} · <span className="frase-cap">{labelSub(sel.subtema)}</span>
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
        <ul className="max-h-[420px] space-y-2 overflow-y-auto">
          {lista.map((c, i) => (
            <li key={i}>
              <ComentarioBox>
                <ComentarioTexto>{c.texto}</ComentarioTexto>
                <ComentarioMeta>
                  <ComentarioChip cor={tintaSentimento(c.sentimento)}>{c.sentimento}</ComentarioChip>
                  {c.autor && <span>@{c.autor}</span>}
                  {c.curtidas > 0 && <span className="tnum ml-auto">♥ {c.curtidas}</span>}
                </ComentarioMeta>
              </ComentarioBox>
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
    return { perDia, deltas, marcados, peak };
  }, [themes, janela]);

  if (!model) return null;
  const { perDia, deltas, marcados, peak } = model;
  // Revisão de 25/07: os balões (pins) que anotavam o tema de cada virada
  // saíram do gráfico — a informação continua disponível no tooltip do dia.
  // Revisão de 21/08 (modelo Trajetória do Viratempo, aprovado em prévia): os
  // dias notáveis voltam como NÓS na própria curva — ponto colorido com a
  // data, sem balão de texto (o tema do dia segue no tooltip, que é a parte
  // da decisão de 25/07 que continua valendo). Vermelho = pico ou virada
  // para pior; âmbar = alívio (a cor do "estabilizado" das Previsões);
  // laranja da marca = última leitura. "Última leitura", e não "hoje": com a
  // coleta parada o último dia com dado pode não ser hoje, e rotular de hoje
  // afirmaria uma atualidade que o dado não tem.
  const idxUltimo = perDia.length - 1;
  const nosMarcados = marcados
    .filter((i) => i !== idxUltimo)
    .map((i) => ({
      value: [i, perDia[i].pctNeg],
      itemStyle: {
        color: i === peak || deltas[i] > 0 ? "#EF4444" : "#F59E0B",
        borderColor: ink.tooltipBg,
        borderWidth: 2,
      },
      label: {
        show: true,
        position: "top" as const,
        distance: 7,
        color: ink.axis,
        fontSize: 12,
        formatter: fmtDiaBR(perDia[i].dia),
      },
    }));

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
        // Curva na MARCA (prévia 2 de 04/08): série única — a cor não está
        // comparando crítica com elogio, então não precisa do vermelho.
        lineStyle: { color: "#62C2CA", width: 2.5 },
        itemStyle: { color: "#62C2CA" },
        areaStyle: glassArea("#62C2CA"),
        // O traçado se desenha na entrada (modelo Trajetória): é a animação
        // nativa do ECharts, roda uma vez e o repouso é a curva completa.
        animationDuration: 1400,
        animationEasing: "cubicOut" as const,
      },
      {
        // Nós dos marcos do período, por cima da curva.
        type: "scatter",
        z: 5,
        symbolSize: 12,
        data: nosMarcados,
        animationDelay: 1200,
        tooltip: { show: false },
      },
      {
        // Última leitura: sempre marcada, na cor da marca.
        type: "scatter",
        z: 6,
        symbolSize: 13,
        data: [
          {
            value: [idxUltimo, perDia[idxUltimo].pctNeg],
            itemStyle: { color: "#62C2CA", borderColor: ink.tooltipBg, borderWidth: 3 },
            label: {
              show: true,
              // À esquerda do ponto: o nó é o último da série, encostado na
              // borda direita do grid, e o rótulo centrado em cima cortava.
              position: "left" as const,
              distance: 9,
              color: ink.axis,
              fontSize: 12,
              fontWeight: 700 as const,
              formatter: "última leitura",
            },
          },
        ],
        animationDelay: 1300,
        tooltip: { show: false },
      },
    ],
  };

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="text-sm font-bold">Trajetória do clima</div>
      <p className="mb-2 text-[12px] text-txt-3">
        % de críticas por dia, com os marcos do período na curva. Passe o mouse num ponto
        para ver o tema que puxou aquele dia
      </p>
      <ReactECharts option={option} style={{ height: 240 }} notMerge lazyUpdate />
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-txt-3">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#EF4444" }} />
          pico ou virada para pior
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#F59E0B" }} />
          alívio na crítica
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#62C2CA" }} />
          última leitura
        </span>
      </div>
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
                        <span className="min-w-0 flex-1 truncate frase-cap text-txt-2">{labelSub(s.subtema)}</span>
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
              {/* Revisão de 30/07: os comentários abrem DENTRO do card do tema
                  clicado, e não mais numa faixa no rodapé do painel. Lá
                  embaixo eles ficavam a três cards de distância do subtema que
                  os havia aberto, e em tela cheia o clique acontecia num canto
                  e a resposta em outro. */}
              {sel?.tema === t.tema && (
                <ComentariosDrill
                  sel={sel}
                  comentarios={comentarios}
                  onFechar={() => setSel(null)}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Termômetro de temas em FAIXAS (modelo Viratempo aprovado em 21/08/26,
 * inspirado na lista retrô do moodboard): cada tema é uma faixa de largura
 * cheia, ordenada e tingida pela temperatura da crítica. A cor aqui é DADO
 * (% de críticas), não decoração, e a receita é a mesma dos cards semânticos
 * do painel: degradê CLARO da família do sentimento com tinta quase preta
 * por cima (#04242F), AA nas duas pontas de cada degradê. Não substitui os
 * velocímetros da Análise do Clima (decisão de 24/07, continuam lá): esta é
 * a leitura de RANKING da página de Previsões. A faixa clicada expande a
 * decomposição no lugar, sem trocar de página.
 */
const RECEITA_FAIXA: { min: number; fundo: string }[] = [
  { min: 55, fundo: "linear-gradient(150deg, #FCA5A5, #EF4444)" },
  { min: 45, fundo: "linear-gradient(150deg, #FBB89E, #F97352)" },
  { min: 35, fundo: "linear-gradient(150deg, #FDE68A, #F59E0B)" },
  { min: 25, fundo: "linear-gradient(150deg, #EDE4CF, #CFC5AC)" },
  { min: 15, fundo: "linear-gradient(150deg, #A7F3C8, #4ADE80)" },
  { min: 0, fundo: "linear-gradient(150deg, #86EFAC, #22C55E)" },
];
function fundoDaFaixa(pctNeg: number): string {
  return (RECEITA_FAIXA.find((r) => pctNeg >= r.min) ?? RECEITA_FAIXA[RECEITA_FAIXA.length - 1]).fundo;
}

const TENDENCIA_FAIXA: Record<TemaResumido["direcao"], string> = {
  subindo: "▲ crítica subindo",
  caindo: "▼ crítica caindo",
  estavel: "estável",
};

function TermometroFaixas({ themes, janela }: { themes: DailyTheme[]; janela: number }) {
  const [aberto, setAberto] = useState<string | null>(null);

  const lista = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - janela);
    const cut = cutoff.toISOString().slice(0, 10);
    // buildTemas sobre o RECORTE da janela: a mesma agregação do alerta, mas
    // respeitando o PeriodoFilter da página (a regra de 27/07).
    return buildTemas(themes.filter((r) => r.dia >= cut))
      .filter((t) => t.tema.toLowerCase() !== "outros")
      .slice(0, 8);
  }, [themes, janela]);

  if (lista.length === 0) return null;
  const maxVol = Math.max(...lista.map((t) => t.volume), 1);

  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="text-sm font-bold">Termômetro de temas</div>
      <p className="mb-3 text-[12px] text-txt-3">
        Da crítica mais quente ao elogio, {periodoFrase(janela)}. Clique numa faixa para a decomposição
      </p>
      <div className="space-y-2">
        {lista.map((t, i) => {
          const estaAberto = aberto === t.tema;
          const neutro = Math.max(0, 100 - t.pctNeg - t.pctPos);
          return (
            <div key={t.tema} className="reveal" style={{ animationDelay: `${0.04 + i * 0.06}s` }}>
              <button
                onClick={() => setAberto(estaAberto ? null : t.tema)}
                aria-expanded={estaAberto}
                className="grid w-full items-center gap-x-4 gap-y-1 rounded-xl px-4 py-3 text-left transition-transform duration-200 hover:translate-x-1.5 sm:grid-cols-[minmax(140px,1.1fr)_2fr_auto]"
                style={{
                  background: fundoDaFaixa(t.pctNeg),
                  color: "#04242F",
                  border: "1px solid rgba(26,15,2,0.10)",
                }}
              >
                <span className="min-w-0">
                  <span
                    className="block truncate text-lg font-bold leading-tight"
                    style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}
                  >
                    {labelTemaSub(t.tema)}
                  </span>
                  <span className="tnum text-[13px] font-semibold" style={{ color: "rgba(26,15,2,0.72)" }}>
                    {t.volume} {t.volume === 1 ? "post no período" : "posts no período"}
                  </span>
                </span>
                <span className="hidden min-w-0 sm:block">
                  <span className="block text-[12px] font-semibold" style={{ color: "rgba(26,15,2,0.72)" }}>
                    volume na janela
                  </span>
                  <span
                    className="mt-1 block h-2 overflow-hidden rounded-full"
                    style={{ background: "rgba(26,15,2,0.14)" }}
                  >
                    <span
                      className="vt-crescer-x block h-full rounded-full"
                      style={{
                        width: `${Math.max(6, Math.round((t.volume / maxVol) * 100))}%`,
                        background: "rgba(26,15,2,0.62)",
                        animationDelay: `${0.1 + i * 0.06}s`,
                      }}
                    />
                  </span>
                </span>
                <span className="text-right">
                  <span
                    className="tnum text-[26px] font-bold leading-none"
                    style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}
                  >
                    {t.pctNeg}
                    <span className="text-[13px] font-bold" style={{ color: "rgba(26,15,2,0.78)" }}>
                      % crítico
                    </span>
                  </span>
                  <span className="block text-[12.5px] font-bold" style={{ color: "rgba(26,15,2,0.78)" }}>
                    {TENDENCIA_FAIXA[t.direcao]}
                  </span>
                </span>
              </button>
              {estaAberto && (
                <div className="mt-1.5 rounded-xl border border-line bg-bg-2 p-3">
                  <div className="flex h-2.5 max-w-md overflow-hidden rounded-full">
                    <span style={{ width: `${t.pctNeg}%`, background: "var(--sent-ink-neg)" }} />
                    <span style={{ width: `${neutro}%`, background: "#ABA598" }} />
                    <span style={{ width: `${t.pctPos}%`, background: "var(--sent-ink-pos)" }} />
                  </div>
                  <p className="tnum mt-1.5 text-[13px] text-txt-2">
                    {t.pctNeg}% críticas · {neutro}% neutras · {t.pctPos}% elogios, na média dos
                    últimos dias com dado no período
                  </p>
                  <p className="mt-0.5 text-[12px] text-txt-3">
                    O detalhe do que o cidadão fala está em "Dentro de cada tema", logo abaixo.
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
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
  // Janela unificada com o resto do painel (24h/7d/30d).
  const [janela, setJanela] = useState<Dias>(7);

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
        <h1 className="text-[27px] font-semibold leading-tight tracking-tight">Previsões</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda sem histórico de temas. Execute o fluxo ÁGORA para popular.
        </div>
      </div>
    );

  const { stats, outrosTemasSet } = view;

  const subindo = stats.filter((s) => direcao(s.s) === "subindo" && s.tema !== "outros");
  const caindo  = stats.filter((s) => direcao(s.s) === "caindo"  && s.tema !== "outros");

  return (
    <div className="space-y-4 p-5">
      {/* Cabeçalho + controles */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[27px] font-semibold leading-tight tracking-tight">Previsões</h1>
          <p className="text-base text-txt-2">
            Evolução de cada tema — quem está subindo, estável ou caindo
          </p>
        </div>
        <PeriodoFilter dias={janela} onChange={setJanela} />
      </div>

      {/* Ordem vigente (2ª revisão de 01/08, confirmada com o cliente):
          Linha do tempo do clima no topo -> Subindo/Caindo -> Dentro de cada
          tema no rodapé. A 1ª revisão do mesmo dia tinha subido o "Dentro de
          cada tema" ao topo; o cliente pediu a troca entre ele e a linha do
          tempo em seguida.

          Revisão de 29/07: os cards "Assuntos em alta · 24h" (AssuntosEmAlta) e
          "Estabilização pós-alerta" (PainelRecuperacaoIRT) saíram desta página
          por pedido do cliente. O backend segue calculando os dois (temas
          monitorados e gatilho de volume por subtema); não recriar aqui sem
          pedido explícito. */}

      {/* Linha do tempo do clima — curva de críticas anotada com o tema que a moveu */}
      <TimelineClima themes={themes} janela={janela} />

      {/* Subindo + Caindo lado a lado */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-display text-xs font-bold uppercase tracking-wide" style={{ color: "var(--danger)" }}>
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
          {/* Barra de intensidade por tema (prévia 2 de 04/08): vê-se quem
              sobe rápido sem comparar decimais. Largura proporcional à maior
              taxa da própria lista; cor nos tokens de sentimento. */}
          <div className="space-y-1.5">
            {(() => {
              const maxS = Math.max(...subindo.slice(0, 5).map((x) => Math.abs(x.s)), 0.001);
              return subindo.slice(0, 5).map((s) => {
                const isOut = outrosTemasSet.has(s.tema);
                const cor = isOut ? COR_OUTROS : "var(--danger)";
                return (
                  <div key={s.tema} className="grid items-center gap-2 text-sm" style={{ gridTemplateColumns: "minmax(0,1fr) 80px 96px" }}>
                    <span className="min-w-0 truncate text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                      {s.tema}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--quote-bg)" }}>
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.round((Math.abs(s.s) / maxS) * 100))}%`, background: cor, opacity: isOut ? 0.5 : 0.85 }} />
                    </span>
                    <span className="tnum shrink-0 text-right font-bold" style={{ color: cor }}>
                      +{s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                    </span>
                  </div>
                );
              });
            })()}
            {subindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em alta.</div>}
          </div>
        </div>

        <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-2 font-display text-xs font-bold uppercase tracking-wide" style={{ color: "var(--success)" }}>
            ▼ Caindo ({caindo.length})
          </div>
          <div className="space-y-1.5">
            {(() => {
              const maxS = Math.max(...caindo.slice(0, 5).map((x) => Math.abs(x.s)), 0.001);
              return caindo.slice(0, 5).map((s) => {
                const isOut = outrosTemasSet.has(s.tema);
                const cor = isOut ? COR_OUTROS : "var(--success)";
                return (
                  <div key={s.tema} className="grid items-center gap-2 text-sm" style={{ gridTemplateColumns: "minmax(0,1fr) 80px 96px" }}>
                    <span className="min-w-0 truncate text-txt-1" style={isOut ? { color: COR_OUTROS } : {}}>
                      {s.tema}
                    </span>
                    <span className="h-2 overflow-hidden rounded-full" style={{ background: "var(--quote-bg)" }}>
                      <span className="block h-full rounded-full" style={{ width: `${Math.max(6, Math.round((Math.abs(s.s) / maxS) * 100))}%`, background: cor, opacity: isOut ? 0.5 : 0.85 }} />
                    </span>
                    <span className="tnum shrink-0 text-right font-bold" style={{ color: cor }}>
                      {s.s.toFixed(1)} {metrica === "volume" ? "posts/dia" : "pt/dia"}
                    </span>
                  </div>
                );
              });
            })()}
            {caindo.length === 0 && <div className="text-sm text-txt-3">Nenhum em queda.</div>}
          </div>
        </div>
      </div>

      {/* Termômetro em faixas (modelo Viratempo, 21/08): ranking dos temas
          pela temperatura da crítica, entre o movimento (acima) e o detalhe
          por subtema (abaixo). A ordem das seções de 01/08 continua intacta:
          Trajetória no topo, Subindo/Caindo no meio, Dentro de cada tema no
          rodapé — a faixa entra como leitura nova, sem substituir nenhuma. */}
      <TermometroFaixas themes={themes} janela={janela} />

      {/* Drill-down de subtemas (a partir dos comentários) */}
      <PainelSubtemas />

    </div>
  );
}
