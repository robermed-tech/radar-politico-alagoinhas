import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, fetchBoletimByRole, fetchBriefing, fetchComentariosPorTema, filtrarPorPeriodo, type Post, type Boletim, type BoletimFrente, type Briefing, type Periodo } from "@/lib/data";
import { calcIAD, NIVEL_COLOR, NIVEL_LABEL, nivelBadgeStyle, type NivelCrise } from "@/lib/indices";
import { getWeather } from "@/lib/weather";
import { fmtInt, fmtDataBR, fraseCapitalizada, limparTravessoes } from "@/lib/format";
import { useAuth } from "@/components/AuthProvider";
import { EvidenciaComentariosModal } from "@/components/EvidenciaComentariosModal";
import { PublicacoesModal } from "@/components/PublicacoesModal";
import { RadarStatusBar, RadarStatusColumn } from "@/components/RadarStatusBar";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
// Import direto: desde 27/07 o velocímetro é SVG puro (não puxa mais o chunk
// de ~1 MB do ECharts), então não há mais motivo para carregá-lo em lazy.
import { GaugeTema } from "@/components/GaugeTema";
import { ContadorAnimado } from "@/components/ContadorAnimado";
import { ClimaIconeAnimado } from "@/components/ClimaIconeAnimado";
import { useThemeStore } from "@/stores/theme";
// Chumbo QUENTE da linguagem aprovada em 03/08 — a mesma superfície dos cards
// escuros (radar, antena, Rádio Escuta), importada para chip e botão neutro.
// Substitui os antigos CHUMBO/#334155 e CHUMBO_ESCURO/#1E293B (slate azulado).
import { FUNDO_ESCUTA } from "@/components/superficieRadio";

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

/**
 * Velocímetros por tema — decisão da reunião de 24/07: as barras empilhadas e
 * o recorte "essa semana / esse mês" saem (conflitavam com o filtro global de
 * período); fica um gauge animado por tema, medindo a % de negativos sobre
 * (positivos + negativos) — o neutro fica fora do ponteiro.
 */
function TermometroTemas({ allPosts, dias }: { allPosts: Post[]; dias: number }) {
  const postsPeriodo = filtrarPorPeriodo(allPosts, dias);
  const urlsPeriodo = useMemo(() => new Set(postsPeriodo.map((p) => p.url)), [postsPeriodo]);

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
      if (!urlsPeriodo.has(c.urlPost)) continue;
      const tema = c.tema.toLowerCase().trim();
      if (!TEMA_LABEL[tema]) continue;
      const b = (byTema[tema] ??= { neg: 0, pos: 0, neu: 0 });
      if (c.sentimento === "negativo") b.neg += 1;
      else if (c.sentimento === "positivo") b.pos += 1;
      else b.neu += 1;
    }
    return Object.entries(byTema)
      .map(([tema, v]) => ({ tema, ...v }))
      .filter((t) => t.neg + t.pos > 0)
      .sort((a, b) => {
        const pa = a.neg / (a.neg + a.pos);
        const pb = b.neg / (b.neg + b.pos);
        return pb - pa || b.neg - a.neg;
      });
  }, [comentariosClassificados, urlsPeriodo]);

  if (temas.length === 0) return null;

  return (
    <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="section-label">Termômetro por tema</div>
        <div className="text-[13px] text-txt-3">
          % de comentários negativos entre os que tomam partido (neutros fora do ponteiro)
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {temas.map(({ tema, neg, pos }) => (
          <GaugeTema key={tema} label={TEMA_LABEL[tema]} neg={neg} pos={pos} />
        ))}
      </div>
    </div>
  );
}

/** Qualidade da amostra do período — reintroduzida na revisão de 25/07. */
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

/**
 * Resumo principal do porquê do clima. Decisão da reunião de 24/07: a etiqueta
 * de nível ("BAIXO") sai — dava a impressão de bug por não mudar — e o título
 * "Análise do clima" entra para dentro do box, em chumbo e branco (cor neutra,
 * sem verde/vermelho que sugerisse julgamento).
 */
function DiagnosticoCard({ briefing, dias }: { briefing: Briefing; dias: number }) {
  return (
    <div className="card-hover rounded-[28px] border border-line bg-bg-1 p-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span
          className="section-label rounded-full px-3 py-1"
          style={{ background: FUNDO_ESCUTA, color: "#FFFFFF" }}
        >
          {periodoClima(dias)}
        </span>
        <span className="text-xs text-txt-3">{fmtDataBR(briefing.dia)}</span>
      </div>
      <p className="text-[16px] font-semibold leading-relaxed text-txt-1">
        {limparTravessoes(briefing.diagnostico)}
      </p>
    </div>
  );
}

function TemasEmCrise({ alertas, urlsNoPeriodo }: { alertas: Briefing["alertas"]; urlsNoPeriodo: Set<string> }) {
  const [aberto, setAberto] = useState<{ tema: string; categoria: string } | null>(null);
  // Contadores rápidos por tema (pedido da reunião de 24/07: "numerozinho"
  // verde/vermelho pro leitor bater o olho sem abrir o modal). Mesma fonte e
  // cache do termômetro por tema.
  const { data: comentariosClassificados } = useQuery({
    queryKey: ["comentarios-tema-todos"],
    queryFn: () => fetchComentariosPorTema(),
    staleTime: 5 * 60 * 1000,
  });
  const contagem = useMemo(() => {
    const by: Record<string, { neg: number; pos: number }> = {};
    for (const c of comentariosClassificados ?? []) {
      if (!urlsNoPeriodo.has(c.urlPost)) continue;
      const t = c.tema.toLowerCase().trim();
      const b = (by[t] ??= { neg: 0, pos: 0 });
      if (c.sentimento === "negativo") b.neg += 1;
      else if (c.sentimento === "positivo") b.pos += 1;
    }
    return by;
  }, [comentariosClassificados, urlsNoPeriodo]);

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
          const cont = a.tema_categoria ? contagem[a.tema_categoria.toLowerCase()] : undefined;
          return (
            <div
              key={i}
              className="flex items-center gap-3 rounded-lg border bg-bg-2 px-4 py-2.5"
              style={{ borderColor: `${cor}33` }}
            >
              <span
                className="shrink-0 rounded px-2.5 py-0.5 text-xs font-extrabold uppercase"
                style={nivelBadgeStyle(cor)}
              >
                {NIVEL_LABEL[(a.nivel as NivelCrise) ?? "baixo"]}
              </span>
              <span className="min-w-0 flex-1 font-semibold text-txt-1">{tema}</span>
              {cont && (cont.neg > 0 || cont.pos > 0) && (
                <span className="tnum flex shrink-0 items-center gap-2 text-[13px] font-bold">
                  <span style={{ color: "var(--sent-ink-neg)" }}>{cont.neg} neg</span>
                  <span style={{ color: "var(--sent-ink-pos)" }}>{cont.pos} pos</span>
                </span>
              )}
              {a.tema_categoria && (
                <button
                  onClick={() => setAberto({ tema, categoria: a.tema_categoria! })}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition hover:opacity-90"
                  style={{ background: FUNDO_ESCUTA }}
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
  const rotulo = periodo === "semana" ? "na semana" : periodo === "mes" ? "no mês" : "hoje";
  // Título definido na reunião de 24/07 (sem "genéricas" desde 01/08, pedido do
  // cliente) — a plataforma não prescreve o que "deveria" ser feito; oferece
  // sugestões que um humano avalia.
  return (
    <div className="rounded-[28px] border border-line bg-bg-1 p-6">
      {/* Corpo e peso maiores que o padrão de seção (pedido de 27/07): é a
          ressalva que separa "sugestão" de "prescrição", e no tamanho antigo
          (.section-label, 13px peso 500) passava despercebida. O peso vai
          inline porque a diretriz global do index.css rebaixa as classes de
          peso do Tailwind com !important. */}
      <div
        className="mb-1.5 uppercase tracking-[0.1em] text-txt-1"
        style={{ fontSize: 17, fontWeight: 800 }}
      >
        Sugestões a serem avaliadas por especialista
      </div>
      <p className="mb-4 text-txt-2" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5 }}>
        Baseadas em protocolos de gestão de crise de imagem e nos temas que merecem atenção {rotulo}.
        Cabe à assessoria avaliar se (e como) aplicá-las.
      </p>
      <div className="space-y-3">
        {recomendacoes.slice(0, 3).map((r, i) => (
          <div key={i} className="flex gap-3 rounded-lg border border-line bg-bg-2 p-4">
            {/* Marcador do protótipo aprovado: seta na cor de texto da marca. */}
            <span aria-hidden className="shrink-0 font-extrabold" style={{ color: "var(--brand-text)" }}>→</span>
            <div className="min-w-0">
              {r.canal && (
                <div className="mb-1 text-sm font-extrabold text-txt-1">{fraseCapitalizada(r.canal)}</div>
              )}
              <p className="text-sm text-txt-2">{limparTravessoes(r.mensagem)}</p>
            </div>
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
            <div key={f.tema} className="flex items-center justify-between py-1.5 text-sm">
              <span className="flex items-center gap-2.5 text-txt-1">
                {/* Tile do protótipo aprovado: o ícone de clima da frente num
                    quadradinho laranja translúcido, em vez de solto no cinza. */}
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10"
                  style={{ color: "var(--brand-text)" }}
                >
                  <WeatherIcon cls={FRENTE_TO_CLS[f.icone] ?? "cloudy"} size={17} strokeWidth={1.7} />
                </span>
                {f.tema}
              </span>
              <span
                className="rounded px-2.5 py-0.5 text-xs font-extrabold uppercase"
                style={nivelBadgeStyle(cor)}
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

export function ClimaPage({ onVerFeed }: { onVerFeed?: () => void }) {
  const [dias, setDias] = useState<Dias>(1);
  const [publicacoesAbertas, setPublicacoesAbertas] = useState(false);
  const { isAdmin } = useAuth();
  // Tema atual (mesmo store do Gauge): a tinta do texto sobre a FOTO do fade
  // é decidida pela luminância da foto E pelo tema — hook aqui no topo, antes
  // dos returns condicionais (regra de hooks, a mesma do fix do Histórico).
  const theme = useThemeStore((s) => s.theme);
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
          <PeriodoFilter dias={dias} onChange={setDias} />
        </div>
        {/* Sem os dois cards do clima, o radar volta ao formato de faixa. */}
        <div className="reveal reveal-1">
          <RadarStatusBar />
        </div>
        <div className="rounded-[28px] border border-line bg-bg-1 p-6 text-txt-2">
          A {periodoClima(dias)} não é possível por falta de dados no período selecionado.
        </div>
      </div>
    );

  // Clima ÚNICO para todo mundo (auditoria de 26/07). Antes o admin via o
  // clima derivado do IAD (escala de aprovação, alto é bom) e o usuário comum
  // via a condição do boletim (escala de risco, alto é ruim): duas grandezas
  // diferentes traduzidas para a mesma metáfora visual, que podiam discordar
  // no mesmo dia sem que houvesse explicação possível numa reunião.
  //
  // O que continua diferente por papel é só o DETALHE numérico: o admin vê o
  // valor do IAD, o usuário comum vê o rótulo. A condição do boletim segue
  // viva onde ela é o dado certo (frentes de instabilidade, mais abaixo).
  const wx = view.wx;
  const amostra = forcaAmostra(view.comentarios);
  // Tinta do texto que senta sobre a FOTO do fade: fixa pela luminância da
  // foto, não pelos tokens. Foto ESCURA = claro sempre (o véu leve dá o
  // assento, nos dois temas). Foto CLARA = preto sólido no tema claro
  // (revisão de 04/08: os tokens txt-1/txt-2 não eram pretos o bastante
  // sobre a foto cinza do nublado); no tema ESCURO volta aos tokens, porque
  // atrás da transição do fade o fundo é o card escuro e o preto sumiria.
  const inkFoto = wx.heroDark
    ? { forte: "#F7F4ED", suave: "rgba(247,244,237,0.85)", rotulo: "rgba(247,244,237,0.92)" }
    : theme === "light"
      ? { forte: "#0B0E14", suave: "#0B0E14", rotulo: "#0B0E14" }
      : null;

  return (
    <div className="space-y-4 p-5">
      <div className="reveal reveal-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">{periodoTitulo(dias)}</h1>
          <p className="text-base text-txt-2">Alagoinhas/BA · imagem do prefeito e da prefeitura</p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} />
      </div>

      {/* Clima · radar de coleta · engajamento. O radar saiu do topo da página
          e passou a ocupar a coluna do meio (pedido de 27/07). */}
      <div className="grid gap-4 lg:grid-cols-6">
        {/* Card do clima inteiro clicável: leva direto à curadoria de
            comentários que explica o clima ("O que o povo diz"). */}
        {/* Hero na linguagem aprovada em 03/08: card claro de vidro (tokens,
            acompanha o tema) com brilho quente no canto — o fundo INTEIRO de
            foto com véu escuro e texto branco fixo não existe mais. Desde
            04/08 o desenho do clima é o ClimaIconeAnimado (estilo soft do
            vídeo de referência do cliente), no lugar da cena em CSS do
            CeuAnimado, e a foto de céu voltou de outro jeito: como FADE
            lateral esquerdo (camada mascarada abaixo), aprovado em prévia. */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onVerFeed?.()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onVerFeed?.(); }}
          className="reveal reveal-2 card-hover group relative cursor-pointer overflow-hidden rounded-[28px] border border-line bg-bg-1 p-7 lg:col-span-3"
          style={{ minHeight: 320 }}
          aria-label="Ver os comentários que explicam este clima"
        >
          {/* Brilho quente do protótipo — atmosfera, atrás do conteúdo. */}
          <div
            className="pointer-events-none absolute -right-16 -top-28 h-[380px] w-[380px] rounded-full"
            style={{ background: "radial-gradient(circle, rgba(255,140,82,0.30) 0%, transparent 65%)" }}
          />

          {/* Foto de céu da condição em FADE (teste aprovado em 04/08): a foto
              (wx.image, que estava órfã desde o redesign) ocupa a parte
              esquerda do card e desvanece para a direita via mask-image,
              revelando o fundo do card no tema claro ou escuro. Nas fotos
              ESCURAS (wx.heroDark: chuva/tempestade/severíssimo) entra um véu
              escuro leve dentro da própria camada mascarada, o assento do
              texto claro por cima. */}
          {/* Revisão de 04/08 (2ª rodada): fade mais curto e mais suave — a
              foto morre mais à esquerda (52% de largura, opaca só até 22%) e
              a curva tem stops intermediários em vez de uma reta. O véu das
              fotos escuras subiu junto (0.22 → 0.28) para o texto claro
              continuar assentado com menos foto por baixo. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-0"
            style={{
              width: "52%",
              background: `${wx.heroDark ? "linear-gradient(rgba(10,12,18,0.28), rgba(10,12,18,0.28)), " : ""}url("${wx.image}") left center / cover no-repeat`,
              WebkitMaskImage:
                "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,0.78) 42%, rgba(0,0,0,0.45) 62%, rgba(0,0,0,0.18) 80%, rgba(0,0,0,0) 96%)",
              maskImage:
                "linear-gradient(to right, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 22%, rgba(0,0,0,0.78) 42%, rgba(0,0,0,0.45) 62%, rgba(0,0,0,0.18) 80%, rgba(0,0,0,0) 96%)",
            }}
          />

          <div className="relative z-10 flex h-full flex-col">
            <div className="flex items-start justify-between gap-2">
              {/* Sobre a foto, a cor do texto vem de inkFoto (fixa pela
                  luminância da foto e pelo tema), nunca dos tokens: text-txt-1
                  sumia na foto de tempestade, e os tokens não eram pretos o
                  bastante sobre a foto cinza do nublado. Ícone, título e
                  frase ficam na zona já transparente e seguem nos tokens. */}
              <div className="section-label" style={inkFoto ? { color: inkFoto.rotulo } : undefined}>
                Como a população vê a gestão
              </div>
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13.5px] font-bold text-white opacity-90 transition group-hover:opacity-100"
                style={{ background: FUNDO_ESCUTA }}
              >
                Ver o que o povo diz
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </div>

            {/* Revisão de 27/07: o número passa a ocupar a altura do card e o
                clima (ícone + frase) vai para a DIREITA dele, em corpo maior.
                Antes o ícone ficava à esquerda do número e a frase embaixo,
                sobrando faixa vazia no meio do card. Os chips de contagem
                seguem fora daqui (25/07): vivem no box de engajamento ao lado.
                Revisão de 28/07: a porcentagem do IAD passa a aparecer para
                TODO papel, não só admin — antes o usuário comum via apenas o
                nome do clima ("Chuva"), sem o número que dá a magnitude por
                trás do rótulo. */}
            <div className="mt-4 flex min-h-0 flex-1 flex-wrap items-center gap-x-8 gap-y-4">
              <div className="flex flex-col items-start">
                <div className="flex items-start" aria-label={`Índice de aprovação: ${view.iad}%`}>
                  {/* Peso 600 desde a onda 2 (03/08): o 200 era da doutrina
                      fina de 11/07, e o briefing pede número em destaque com
                      legibilidade alta. Não vai a 800: neste corpo (até 208px)
                      o traço da Space Grotesk 700 já fecha os vazados.
                      Dígitos PROPORCIONAIS, sem tnum e sem tracking custom
                      (04/08, 3ª rodada): em caixas tabulares nenhum
                      espaçamento fixo é harmônico — o 4 preenche a caixa
                      inteira e o 5/2 sobram, então "44" colava com tracking
                      negativo e "52" abria com o positivo. O kerning da
                      própria fonte decide o espaço; tnum fica para colunas
                      de métricas. A cópia invisível reserva a largura do
                      valor FINAL e o contador anima em camada absoluta por
                      cima — sem isso a largura oscila durante a rampa de
                      0,9s e o ícone e a frase ao lado tremem a cada carga. */}
                  <span
                    className="relative inline-block text-[120px] leading-[0.76] text-txt-1 sm:text-[168px] lg:text-[208px]"
                    style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif", color: inkFoto?.forte }}
                  >
                    <span aria-hidden="true" className="invisible">{view.iad}</span>
                    <span className="absolute inset-y-0 left-0">
                      <ContadorAnimado valor={view.iad} />
                    </span>
                  </span>
                  <span
                    className="mt-3 text-5xl font-medium text-txt-2 sm:text-6xl lg:text-7xl"
                    style={inkFoto ? { color: inkFoto.suave } : undefined}
                  >
                    %
                  </span>
                </div>
                {/* Legenda pedida pelo cliente em 28/07: o número sozinho não
                    dizia o que media. Fica sempre igual, direto embaixo do
                    número — o rótulo qualitativo ao lado (wx.sub) já varia
                    por faixa, então essa linha é a única explicação fixa do
                    que "44%" quer dizer. */}
                <p
                  className="mt-6 max-w-[24ch] text-[15px] font-semibold leading-snug text-txt-2 sm:text-[17px]"
                  style={inkFoto ? { color: inkFoto.suave } : undefined}
                >
                  Aprovação da gestão nos comentários analisados no período
                </p>
              </div>

              {/* Revisão de 04/08 (vídeo de referência do cliente): a cena em
                  CSS (CeuAnimado) saiu; entra o ícone animado soft do
                  ClimaIconeAnimado, grande, ocupando o centro do card, com a
                  frase do clima à DIREITA dele. flex-basis REAL (não flex-1):
                  base 0 nunca quebra linha num flex-wrap — no mobile o par
                  encolhia em vez de descer e o conteúdo vazava por baixo do
                  overflow-hidden do card. */}
              <div className="flex min-w-0 flex-[1_1_300px] flex-wrap items-center justify-center gap-x-7 gap-y-3">
                <div className="w-[150px] shrink-0 sm:w-[180px] lg:w-[205px]">
                  <ClimaIconeAnimado cls={wx.cls} />
                </div>
                {/* Título do clima em DESTAQUE (revisão de 04/08, 2ª rodada):
                    o nome da condição em caixa alta acima da frase — antes só
                    a frase aparecia e o nome do clima não estava em lugar
                    nenhum do card. */}
                <div className="min-w-0 max-w-[18ch] flex-[1_1_11rem]">
                  <div
                    className="text-[30px] font-extrabold uppercase leading-none tracking-tight text-txt-1 sm:text-[36px]"
                    style={{ fontFamily: "Space Grotesk, Inter, sans-serif" }}
                  >
                    {wx.label}
                  </div>
                  <div
                    className="mt-2 text-[18px] leading-snug text-txt-2 sm:text-[20px]"
                    style={{ fontWeight: 600, fontFamily: "Space Grotesk, Inter, sans-serif" }}
                  >
                    {limparTravessoes(wx.sub)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Radar de coleta, entre os dois cards. */}
        <div className="reveal reveal-3 lg:col-span-1">
          <RadarStatusColumn />
        </div>

        {/* Box de engajamento — clicável: abre a lista das publicações
            analisadas no período, com link direto para cada post. Texto em
            preto sobre o laranja (decisão de contraste da reunião de 24/07). */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => setPublicacoesAbertas(true)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPublicacoesAbertas(true); }}
          className="reveal reveal-4 group relative cursor-pointer overflow-hidden rounded-[28px] p-7 transition-transform duration-200 hover:-translate-y-0.5 lg:col-span-2"
          style={{
            // Chapado, e não degradê: `--brand` é um hex único nos dois temas
            // desde 31/07, então o preenchimento sólido já é a cor de marca
            // certa nas duas telas, sem precisar de dois stops para disfarçar
            // a troca de tom entre tema claro e escuro.
            background: "var(--brand)",
            minHeight: 320,
            boxShadow: "0 18px 40px -14px rgba(255,106,43,0.5)",
          }}
          aria-label="Ver as publicações analisadas no período"
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full"
            style={{ background: "rgba(255,255,255,0.12)" }}
          />
          <div className="relative z-10 flex h-full flex-col" style={{ color: "#1A0F02" }}>
            <div className="flex items-start justify-between gap-2">
              <div className="text-[14px] font-bold tracking-[0.08em]" style={{ color: "rgba(26,15,2,0.75)" }}>
                Engajamento no período
              </div>
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[13px] font-bold text-white opacity-90 transition group-hover:opacity-100"
                style={{ background: FUNDO_ESCUTA }}
              >
                Ver publicações
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            </div>
            <p className="mt-2 max-w-[26ch] text-base font-normal leading-snug" style={{ color: "rgba(26,15,2,0.85)" }}>
              Quanto mais <b className="font-bold">comentários analisados</b>, mais confiável é a leitura do clima.
            </p>

            <div
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-bold text-white"
              style={{ background: FUNDO_ESCUTA }}
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
                <span
                  className="tnum text-[68px] leading-[0.85] tracking-tight"
                  style={{ fontWeight: 700, color: "#1A0F02", fontFamily: "Space Grotesk, Inter, sans-serif" }}
                >
                  <ContadorAnimado valor={view.comentarios} formatar={fmtInt} />
                </span>
              </div>
              <div className="mt-1 text-base font-bold" style={{ color: "rgba(26,15,2,0.85)" }}>
                comentários analisados · {fmtInt(view.posts)} publicações
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

      <TermometroTemas allPosts={data!.data} dias={dias} />

      {briefing && <RecomendacoesPeriodo recomendacoes={briefing.recomendacoes} periodo={periodo} />}

      {publicacoesAbertas && (
        <PublicacoesModal
          posts={filtrarPorPeriodo(data!.data, dias)}
          periodoLabel={periodoLabel(dias)}
          onClose={() => setPublicacoesAbertas(false)}
        />
      )}
    </div>
  );
}
