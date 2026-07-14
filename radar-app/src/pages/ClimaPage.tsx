import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, fetchBoletimByRole, fetchBriefing, fetchComentariosPorTema, filtrarPorPeriodo, type Post, type Boletim, type BoletimFrente, type Briefing, type Periodo } from "@/lib/data";
import { calcIAD, NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";
import { getWeather, weatherFromCondicao } from "@/lib/weather";
import { fmtInt } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import { EvidenciaComentariosModal } from "@/components/EvidenciaComentariosModal";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde",
  educacao: "Educação",
  obras: "Obras e Infraestrutura",
  seguranca: "Segurança Pública",
  transporte: "Transporte",
  emprego: "Emprego e Economia",
  impostos: "Impostos e Tributos",
  saneamento: "Saneamento (Água/Esgoto)",
  cultura_eventos: "Cultura e Eventos",
  comunicacao: "Comunicação e Transparência",
};

function somarComents(posts: Post[]): { neg: number; pos: number; neu: number } {
  let neg = 0, pos = 0;
  let total = 0;
  for (const p of posts) {
    const tot = p.comentarios_total || 0;
    total += tot;
    neg += Math.round(((p.comentarios_pct_neg || 0) / 100) * tot);
    pos += Math.round(((p.comentarios_pct_pos || 0) / 100) * tot);
  }
  return { neg, pos, neu: Math.max(0, total - neg - pos) };
}

const VOL_COR = { neg: "#EF4444", pos: "#22C55E", neu: "#8593AD" };

/**
 * Uma linha = um total grande (leitura imediata) + uma barra empilhada a
 * 100% mostrando a PROPORÇÃO neg/pos/neu (composição), em vez de colunas
 * numéricas lado a lado. Comparar proporções por comprimento de barra é
 * mais rápido de interpretar do que ler 4 números por linha — e como cada
 * linha normaliza para 100%, funciona igual bem para "Hoje" (dezenas) e
 * "Este mês" (milhares).
 */
function LinhaVolume({
  label,
  sub,
  neg,
  pos,
  neu,
}: {
  label: string;
  sub?: string;
  neg: number;
  pos: number;
  neu: number;
}) {
  const total = neg + pos + neu;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-txt-1">{label}</div>
          {sub && <div className="text-[11px] text-txt-3">{sub}</div>}
        </div>
        <div className="tnum shrink-0 text-2xl font-light leading-none text-txt-1">{fmtInt(total)}</div>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-bg-2">
        {neg > 0 && <div style={{ width: `${pct(neg)}%`, background: VOL_COR.neg }} />}
        {pos > 0 && <div style={{ width: `${pct(pos)}%`, background: VOL_COR.pos }} />}
        {neu > 0 && <div style={{ width: `${pct(neu)}%`, background: VOL_COR.neu }} />}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px]">
        <span className="tnum font-semibold" style={{ color: VOL_COR.neg }}>{fmtInt(neg)} negativos</span>
        <span className="tnum font-semibold" style={{ color: VOL_COR.pos }}>{fmtInt(pos)} positivos</span>
        <span className="tnum text-txt-3">{fmtInt(neu)} neutros</span>
      </div>
    </div>
  );
}

function VolumeComentarios({ allPosts }: { allPosts: Post[] }) {
  const periodos = [
    { label: "Hoje", sub: "últimas 24h", posts: filtrarPorPeriodo(allPosts, 1) },
    { label: "Esta semana", sub: "últimos 7 dias", posts: filtrarPorPeriodo(allPosts, 7) },
    { label: "Este mês", sub: "últimos 30 dias", posts: filtrarPorPeriodo(allPosts, 30) },
  ];

  const posts30 = filtrarPorPeriodo(allPosts, 30);
  const urls30 = useMemo(() => new Set(posts30.map((p) => p.url)), [posts30]);

  // Volume por tema vem do tema de CADA COMENTÁRIO (classificação individual
  // do cidadão), não do tema do post — atribuir todos os comentários de um
  // post ao tema único do post é uma estimativa grosseira (um post de
  // "saúde" pode ter gente comentando sobre transporte, comunicação etc).
  // Mesma fonte que o backend usa pro "tema dominante" do diagnóstico
  // (agora.py::contar_comentarios_por_tema) — antes divergiam.
  const { data: comentariosClassificados } = useQuery({
    queryKey: ["comentarios-tema-todos"],
    queryFn: () => fetchComentariosPorTema(),
    staleTime: 5 * 60 * 1000,
  });

  const temas = useMemo(() => {
    const byTema: Record<string, { neg: number; pos: number; neu: number }> = {};
    for (const c of comentariosClassificados ?? []) {
      if (!urls30.has(c.urlPost)) continue;
      const tema = c.tema.toLowerCase().trim();
      if (!TEMA_LABEL[tema]) continue;
      const b = (byTema[tema] ??= { neg: 0, pos: 0, neu: 0 });
      if (c.sentimento === "negativo") b.neg += 1;
      else if (c.sentimento === "positivo") b.pos += 1;
      else b.neu += 1;
    }
    return Object.entries(byTema)
      .map(([tema, v]) => ({ tema, ...v }))
      .filter((t) => t.neg + t.pos + t.neu > 0)
      .sort((a, b) => b.neg - a.neg);
  }, [comentariosClassificados, urls30]);

  return (
    <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6 space-y-6">
      <div>
        <div className="section-label">Volume de comentários por período e tema</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-txt-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: VOL_COR.neg }} /> Negativos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: VOL_COR.pos }} /> Positivos
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: VOL_COR.neu }} /> Neutros
          </span>
        </div>
      </div>

      <div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-txt-3">Por período</div>
        <div className="divide-y divide-line/30">
          {periodos.map(({ label, sub, posts }) => {
            const { neg, pos, neu } = somarComents(posts);
            return (
              <div key={label} className="py-3 first:pt-0 last:pb-0">
                <LinhaVolume label={label} sub={sub} neg={neg} pos={pos} neu={neu} />
              </div>
            );
          })}
        </div>
      </div>

      {temas.length > 0 && (
        <div>
          <div className="mb-3 text-[10px] font-bold uppercase tracking-wide text-txt-3">Por tema — últimos 30 dias</div>
          <div className="divide-y divide-line/30">
            {temas.map(({ tema, neg, pos, neu }) => (
              <div key={tema} className="py-3 first:pt-0 last:pb-0">
                <LinhaVolume label={TEMA_LABEL[tema]} neg={neg} pos={pos} neu={neu} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const PERIODOS = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

function forcaAmostra(comentarios: number): { label: string; nivel: number } {
  if (comentarios >= 300) return { label: "Amostra forte", nivel: 3 };
  if (comentarios >= 100) return { label: "Boa amostra", nivel: 2 };
  if (comentarios >= 30) return { label: "Amostra inicial", nivel: 1 };
  return { label: "Amostra pequena", nivel: 0 };
}

function scoreParaNivel(score: number): NivelCrise {
  if (score >= 75) return "critico";
  if (score >= 55) return "alto";
  if (score >= 35) return "moderado";
  return "baixo";
}

// No boletim público (usuário comum) o score numérico das frentes é removido;
// derivamos o nível pelo ícone (já calculado no backend), sem expor número.
const ICONE_TO_NIVEL: Record<string, NivelCrise> = {
  sol: "baixo", nuvem: "moderado", chuva: "alto", tempestade: "critico",
};
function frenteNivel(f: BoletimFrente): NivelCrise {
  if (typeof f.score === "number") return scoreParaNivel(f.score);
  return ICONE_TO_NIVEL[f.icone] ?? "moderado";
}

// Título e rótulo do diagnóstico variam conforme o período selecionado.
function periodoTitulo(dias: number): string {
  if (dias <= 1) return "Previsão do dia";
  if (dias <= 7) return "Clima da semana";
  return "Clima do mês";
}
function periodoClima(dias: number): string {
  if (dias <= 1) return "análise do clima do dia";
  if (dias <= 7) return "análise do clima da semana";
  return "análise do clima do mês";
}

/** Mapeia a janela numérica (1/7/30) pro período usado nas queries de
 * ai_briefings/boletins — dia/semana/mês são gerados e guardados separados
 * no backend (ver agora.py::gerar_briefings_periodo). */
function periodoParaChave(dias: number): Periodo {
  if (dias <= 1) return "dia";
  if (dias <= 7) return "semana";
  return "mes";
}

// Frente de instabilidade → classe de clima usada pelo WeatherIcon.
const FRENTE_TO_CLS: Record<string, string> = {
  sol: "sunny",
  nuvem: "cloudy",
  chuva: "rain",
  tempestade: "storm",
};

// Ícone de clima minimalista (linha, estilo sidebar) — substitui os emojis.
function WeatherIcon({ cls, size = 64, color = "currentColor", strokeWidth = 1.5 }: {
  cls: string; size?: number; color?: string; strokeWidth?: number;
}) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (cls) {
    case "sunny":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2v2.2M12 19.8V22M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2 12h2.2M19.8 12H22M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
        </svg>
      );
    case "partly":
      return (
        <svg {...p}>
          <circle cx="8.5" cy="7.5" r="3" />
          <path d="M8.5 1.8v1.4M2.9 7.5H1.5M3.9 2.9l1 1M14.1 2.9l-1 1" />
          <path d="M7 19h9.2a3.4 3.4 0 0 0 .3-6.8A5 5 0 0 0 7 13.4 3.3 3.3 0 0 0 7 19z" />
        </svg>
      );
    case "cloudy":
      return (
        <svg {...p}>
          <path d="M7 18h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 11.6 3.8 3.8 0 0 0 7 18z" />
        </svg>
      );
    case "rain":
      return (
        <svg {...p}>
          <path d="M7 14h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.6 3.8 3.8 0 0 0 7 14z" />
          <path d="M8.5 17.5l-1 3M12 17.5l-1 3M15.5 17.5l-1 3" />
        </svg>
      );
    case "storm":
      return (
        <svg {...p}>
          <path d="M7 14h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 7.6 3.8 3.8 0 0 0 7 14z" />
          <path d="M12.5 15l-2.5 4h3l-2.5 4.5" />
        </svg>
      );
    default: // severe
      return (
        <svg {...p}>
          <path d="M7 13h9.2a4 4 0 0 0 .3-8A5.5 5.5 0 0 0 6 6.6 3.8 3.8 0 0 0 7 13z" />
          <path d="M8 16.5l-1 3M16 16.5l-1 3M12.5 14l-2 3.5h3L11 21" />
        </svg>
      );
  }
}

// Ícones minimalistas inline (linha) usados nos chips do hero.
function IconPosts({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
      <line x1="5" y1="20" x2="5" y2="13" /><line x1="12" y1="20" x2="12" y2="7" /><line x1="19" y1="20" x2="19" y2="10" />
    </svg>
  );
}
function IconVozes({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DiagnosticoCard({ briefing, dias }: { briefing: Briefing; dias: number }) {
  const nivel = (briefing.nivel_crise as NivelCrise) ?? "baixo";
  const cor = NIVEL_COLOR[nivel];
  return (
    <div
      className="card-hover rounded-[28px] border bg-bg-1 p-6"
      style={{ borderColor: `${cor}44` }}
    >
      <div className="mb-3 flex items-center gap-2">
        <span
          className="rounded-full px-3 py-0.5 text-xs font-medium uppercase tracking-wide"
          style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}3d` }}
        >
          {NIVEL_LABEL[nivel]}
        </span>
        <span className="text-xs text-txt-3">{periodoClima(dias)} · {briefing.dia}</span>
      </div>
      <p className="text-[15px] leading-relaxed text-txt-1">{briefing.diagnostico}</p>
    </div>
  );
}

function TemasEmCrise({ alertas, urlsNoPeriodo }: { alertas: Briefing["alertas"]; urlsNoPeriodo: Set<string> }) {
  const [aberto, setAberto] = useState<{ tema: string; categoria: string } | null>(null);
  if (!alertas?.length) return null;
  return (
    <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="mb-3 section-label">
        Temas que merecem atenção
      </div>
      <div className="space-y-2">
        {alertas.slice(0, 5).map((a, i) => {
          const cor = NIVEL_COLOR[(a.nivel as NivelCrise) ?? "baixo"];
          const tema = a.tema ? a.tema.charAt(0).toUpperCase() + a.tema.slice(1).toLowerCase() : "";
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border bg-bg-2 px-4 py-2.5"
              style={{ borderColor: `${cor}33` }}
            >
              <span
                className="shrink-0 rounded px-2.5 py-0.5 text-xs font-bold uppercase"
                style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
              >
                {NIVEL_LABEL[(a.nivel as NivelCrise) ?? "baixo"]}
              </span>
              <span className="min-w-0 flex-1 font-semibold text-txt-1">{tema}</span>
              {a.tema_categoria && (
                <button
                  onClick={() => setAberto({ tema, categoria: a.tema_categoria! })}
                  className="shrink-0 rounded-lg border border-line bg-bg-1 px-2.5 py-1 text-xs font-semibold text-txt-2 transition hover:border-brand hover:text-txt-1"
                >
                  Ver comentários
                </button>
              )}
            </div>
          );
        })}
      </div>
      {aberto && (
        <EvidenciaComentariosModal
          tema={aberto.categoria}
          tituloTema={aberto.tema}
          urlsNoPeriodo={urlsNoPeriodo}
          onClose={() => setAberto(null)}
        />
      )}
    </div>
  );
}

/**
 * Ações sugeridas — sempre a partir de ai_briefings.recomendacoes do MESMO
 * período mostrado em "Temas que merecem atenção" logo acima (mesma fonte,
 * period-scoped). Antes o "O que fazer agora" do dia vinha dos planos de
 * contenção do Caçador de Crises (análise de posts isolados de alto risco) —
 * uma fonte totalmente diferente da lista de temas, então o card não tinha
 * nenhuma relação com os temas exibidos acima dele. Unificado: dia é
 * enquadrado como ação imediata; semana/mês como retrospectiva (o que
 * deveria ter sido feito), já que a janela já passou.
 */
function RecomendacoesPeriodo({
  recomendacoes,
  periodo,
}: {
  recomendacoes: Briefing["recomendacoes"];
  periodo: Periodo;
}) {
  if (!recomendacoes?.length) return null;
  const ehDia = periodo === "dia";
  const rotulo = periodo === "semana" ? "na semana" : periodo === "mes" ? "no mês" : "hoje";
  return (
    <div
      className="rounded-[28px] border p-6"
      style={{ borderColor: "rgba(249,115,22,0.4)", background: "rgba(249,115,22,0.04)" }}
    >
      <div className="mb-1 text-[12px] font-bold tracking-[0.04em]" style={{ color: "#F97316" }}>
        {ehDia ? "O que fazer agora" : "O que deveria ter sido feito"}
      </div>
      <p className="mb-3 text-xs text-txt-3">
        {ehDia
          ? `Ações sugeridas para os temas que merecem atenção ${rotulo}.`
          : `Baseado nos temas que mereceram atenção ${rotulo} — fica a critério da assessoria avaliar se ainda vale agir sobre isso agora.`}
      </p>
      <div className="space-y-3">
        {recomendacoes.slice(0, 3).map((r, i) => (
          <div key={i} className="rounded-lg border border-line bg-bg-1 p-4">
            {r.canal && (
              <div className="mb-1 text-sm font-extrabold capitalize text-txt-1">{r.canal}</div>
            )}
            <p className="text-sm text-txt-2">{r.mensagem}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FrentesInstabilidade({ frentes }: { frentes: Boletim["frentes"] }) {
  if (!frentes.length) return null;
  return (
    <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="section-label">
        Frentes de instabilidade
      </div>
      <div className="mt-3 space-y-1">
        {frentes.filter((f) => f.tema !== "outros").map((f) => {
          const nivel = frenteNivel(f);
          const cor = NIVEL_COLOR[nivel];
          return (
            <div key={f.tema} className="flex items-center justify-between py-1 text-sm">
              <span className="flex items-center gap-2 text-txt-1">
                <span className="text-txt-3"><WeatherIcon cls={FRENTE_TO_CLS[f.icone] ?? "cloudy"} size={18} strokeWidth={1.6} /></span>
                {f.tema}
              </span>
              <span
                className="rounded px-2.5 py-0.5 text-xs font-bold uppercase"
                style={{ background: `${cor}22`, color: cor, border: `1px solid ${cor}44` }}
              >
                {NIVEL_LABEL[nivel]}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ClimaPage() {
  const [dias, setDias] = useState(1);
  const { isAdmin } = useAuth();
  const periodo = periodoParaChave(dias);
  const { data, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  // periodo entra na queryKey — cada aba (dia/semana/mes) fica cacheada
  // separada, então trocar de volta pra uma aba já visitada é instantâneo.
  const { data: boletim } = useQuery({
    queryKey: ["boletim", isAdmin, periodo],
    queryFn: () => fetchBoletimByRole(isAdmin, periodo),
    staleTime: 5 * 60 * 1000,
  });
  const { data: briefing, isLoading: loadingBriefing } = useQuery({
    queryKey: ["briefing", periodo],
    queryFn: () => fetchBriefing(periodo),
    staleTime: 5 * 60 * 1000,
  });
  // URLs dos posts do período ativo — usado pra filtrar a evidência de
  // comentários (EvidenciaComentariosModal) pelo mesmo join que o backend
  // usa (comments.url_post), já que data_comentario_ts não é confiável.
  const urlsNoPeriodo = useMemo(
    () => new Set(filtrarPorPeriodo(data?.data ?? [], dias).map((p) => p.url)),
    [data, dias]
  );

  const view = useMemo(() => {
    if (!data) return null;
    const posts = filtrarPorPeriodo(data.data, dias);
    if (posts.length === 0) return { vazio: true } as const;
    const iad = Math.round(calcIAD(posts));
    const wx = getWeather(iad);
    const totalComents = posts.reduce((s, p) => s + (p.comentarios_total || 0), 0);
    return {
      vazio: false as const,
      iad,
      wx,
      posts: posts.length,
      comentarios: totalComents,
    };
  }, [data, dias]);

  if (isLoading) return <div className="p-8 text-txt-2">Lendo o clima político…</div>;
  if (!view) return null;

  if (view.vazio)
    return (
      <div className="space-y-4 p-5">
        <div className="reveal reveal-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">{periodoTitulo(dias)}</h1>
            <p className="text-base text-txt-2">Alagoinhas/BA · imagem do prefeito e da prefeitura</p>
          </div>
          <div className="flex rounded-full p-1 glass-btn">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                onClick={() => setDias(p.dias)}
                className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                  dias === p.dias ? "bg-white/25 text-txt-1 shadow-sm" : "text-txt-2 hover:text-txt-1"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-[28px] border border-line bg-bg-1 p-6 text-txt-2">
          A {periodoClima(dias)} não é possível por falta de dados no período selecionado.
        </div>
      </div>
    );

  // Admin vê o clima derivado do score (client). Usuário comum vê a condição
  // que vem pronta do boletim (backend) — sem o número.
  const wx = isAdmin ? view.wx : weatherFromCondicao(boletim?.condicao);
  const txt1 = "#FFFFFF";
  const txt2 = "rgba(255,255,255,0.86)";
  const heroBg = `linear-gradient(105deg, rgba(8,11,18,0.72) 0%, rgba(8,11,18,0.32) 50%, rgba(8,11,18,0.58) 100%), url("${wx.image}") center/cover no-repeat, ${wx.bg}`;
  const amostra = forcaAmostra(view.comentarios);

  return (
    <div className="space-y-4 p-5">
      <div className="reveal reveal-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">{periodoTitulo(dias)}</h1>
          <p className="text-base text-txt-2">Alagoinhas/BA · imagem do prefeito e da prefeitura</p>
        </div>
        <div className="flex rounded-full p-1 glass-btn">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              onClick={() => setDias(p.dias)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
                dias === p.dias ? "bg-white/25 text-txt-1 shadow-sm" : "text-txt-2 hover:text-txt-1"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div
          className="reveal reveal-2 relative overflow-hidden rounded-[28px] p-7 lg:col-span-3"
          style={{ background: heroBg, minHeight: 320 }}
        >
          {(wx.cls === "rain" || wx.cls === "storm" || wx.cls === "severe") && (
            <div className="rain-layer">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="raindrop"
                  style={{
                    left: `${(i * 4.3) % 100}%`,
                    animationDuration: `${0.55 + (i % 5) * 0.12}s`,
                    animationDelay: `${-(i % 7) * 0.2}s`,
                  }}
                />
              ))}
            </div>
          )}

          <div className="relative z-10 flex h-full flex-col">
            <div className="text-[13px] font-bold tracking-[0.08em]" style={{ color: txt2 }}>
              Como a população vê a gestão
            </div>

            <div className="mt-5 flex items-center gap-6">
              <div style={{ filter: "drop-shadow(0 6px 16px rgba(0,0,0,0.22))" }}>
                <WeatherIcon cls={wx.cls} size={88} color="#FFFFFF" strokeWidth={1.4} />
              </div>
              <div>
                {isAdmin ? (
                  <div className="flex items-end gap-1">
                    <span className="tnum text-[60px] leading-[0.85] tracking-tight sm:text-[84px]" style={{ color: txt1, fontWeight: 200 }}>
                      {view.iad}
                    </span>
                    <span className="mb-3 text-2xl font-bold" style={{ color: txt2 }}>%</span>
                  </div>
                ) : (
                  <div className="text-[40px] font-extrabold leading-[1.0] tracking-tight" style={{ color: txt1 }}>
                    {wx.label}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-5 max-w-xl text-lg font-semibold leading-snug" style={{ color: txt1 }}>
              {wx.sub}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                <IconPosts /> {fmtInt(view.posts)} publicações analisadas
              </span>
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold"
                style={{ background: "rgba(255,255,255,0.16)", color: "#FFFFFF", backdropFilter: "blur(6px)" }}
              >
                <IconVozes /> {fmtInt(view.comentarios)} vozes ouvidas
              </span>
            </div>
          </div>
        </div>

        <div
          className="reveal reveal-3 relative overflow-hidden rounded-[28px] p-7 lg:col-span-2"
          style={{
            background: "linear-gradient(150deg, #FB923C 0%, #EA580C 100%)",
            minHeight: 320,
            boxShadow: "0 18px 40px -14px rgba(234,88,12,0.5)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
            style={{ background: "rgba(255,255,255,0.12)" }}
          />
          <div className="relative z-10 flex h-full flex-col">
            <div className="text-[13px] font-bold tracking-[0.08em] text-white/80">
              Engajamento no período
            </div>
            <p className="mt-2 max-w-[22ch] text-base font-medium leading-snug text-white/90">
              Quanto mais vozes ouvidas, mais confiável é a leitura do clima.
            </p>

            <div
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-extrabold"
              style={{ background: "#BEDB1D", color: "#1A2400" }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <line x1="6" y1="20" x2="6" y2="15" />
                <line x1="12" y1="20" x2="12" y2={amostra.nivel >= 2 ? "9" : "13"} style={{ opacity: amostra.nivel >= 1 ? 1 : 0.3 }} />
                <line x1="18" y1="20" x2="18" y2="5" style={{ opacity: amostra.nivel >= 3 ? 1 : 0.3 }} />
              </svg>
              {amostra.label}
            </div>

            <div className="mt-auto pt-6">
              <div className="flex items-end gap-1">
                <span className="tnum text-[68px] leading-[0.85] tracking-tight text-white" style={{ fontWeight: 200 }}>
                  {fmtInt(view.comentarios)}
                </span>
              </div>
              <div className="mt-1 text-base font-semibold text-white/85">
                vozes ouvidas · {fmtInt(view.posts)} publicações
              </div>
            </div>
          </div>
        </div>
      </div>

      {briefing ? (
        <DiagnosticoCard briefing={briefing} dias={dias} />
      ) : (
        // Sem diagnóstico para semana/mês (histórico curto, tenant novo): diz
        // isso explicitamente — nunca cai no diagnóstico de outro período
        // disfarçado. Pro "dia", mantém o comportamento de sempre (some e
        // cai no fallback de frentes) — o backend também gera na hora.
        !loadingBriefing &&
        periodo !== "dia" && (
          <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6 text-sm text-txt-2">
            Análise {periodo === "semana" ? "da semana" : "do mês"} ainda não disponível — dados insuficientes.
          </div>
        )
      )}

      {briefing?.alertas?.length ? (
        <TemasEmCrise alertas={briefing.alertas} urlsNoPeriodo={urlsNoPeriodo} />
      ) : (
        boletim?.frentes && boletim.frentes.length > 0 && (
          <FrentesInstabilidade frentes={boletim.frentes} />
        )
      )}

      {briefing && <RecomendacoesPeriodo recomendacoes={briefing.recomendacoes} periodo={periodo} />}

      <VolumeComentarios allPosts={data!.data} />
    </div>
  );
}
