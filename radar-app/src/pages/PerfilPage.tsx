import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchRadar,
  fetchComments,
  fetchComentariosLeves,
  fetchProfileMetrics,
  filtrarPorPeriodo,
  type Comment,
  type Post,
} from "@/lib/data";
import { fetchKeywords } from "@/lib/admin";
import { calcIndices, NIVEL_LABEL, NIVEL_COLOR } from "@/lib/indices";
import { KpiStat } from "@/components/KpiStat";
import { COLOR_SENTIMENT } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";
import { InfluencersSection } from "@/pages/InfluencersPage";
import { RankingSeguidores, CAT_COR } from "@/components/RankingSeguidores";
import { montarRanking } from "@/lib/seguidores";
import { PeriodoFilter, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { prepararKeywords, casaRelevancia } from "@/lib/relevancia";
import { analisarPerfis, extremos, MIN_AMOSTRA, type PerfilAnalise } from "@/lib/analisePerfis";

const COR_CONTRA = COLOR_SENTIMENT.neg;
const COR_FAVOR = COLOR_SENTIMENT.pos;

/**
 * Card de extremo ("quem mais critica…", "quem mais elogia…"). Fundo por
 * GRUPO: tudo que fala de crítica é vermelho, tudo que fala de elogio é
 * verde — antes os cards eram brancos com o @ colorido, e os dois grupos se
 * misturavam numa faixa só.
 *
 * Revisão de 28/07: o degradê escuro com texto claro saiu — destoava do
 * resto do painel. O padrão que o dashboard já usa para card colorido é o
 * box "Engajamento no período" da Estação Meteorológica: gradiente CLARO
 * (150deg, mesma família de cor do início ao fim) com texto quase preto por
 * cima, não o inverso. Aqui é a mesma receita: `#FCA5A5 → #EF4444` (o
 * vermelho de sentimento do painel) e `#86EFAC → #22C55E` (idem, verde),
 * texto em `#1A0F02` (o preto usado nos outros botões/cards em degradê do
 * painel — puro #000 teria contraste igual ou maior, mas esse tom é o que já
 * está em uso, e reaproveitar mantém uma paleta de "preto" só no produto).
 */
const FUNDO_CRITICA = "linear-gradient(150deg, #FCA5A5 0%, #EF4444 100%)";
const FUNDO_ELOGIO = "linear-gradient(150deg, #86EFAC 0%, #22C55E 100%)";
// Preta SÓLIDA em todo lugar, e não com alpha. Medido no harness: o alpha
// (0,78) passava na ponta clara mas reprovava na escura do vermelho (3,87:1,
// abaixo do mínimo AA de 4,5) — a mesma pegadinha do texto branco-com-alpha
// da primeira versão deste componente. Preto sólido mede 5,01:1+ nas duas
// pontas dos dois gradientes; a hierarquia entre título e valor vem do peso
// da fonte, não de uma segunda tinta.
const TINTA_PRETA = "#1A0F02";

const CHUMBO = "#334155";

/**
 * Revisão de 28/07: o degradê por categoria (verde/azul/roxo/vermelho) saiu
 * do seletor de perfis — cor por perfil contrariava a doutrina do painel
 * ("sem identidade visual fechada"; verde/vermelho ficam reservados para
 * sentimento, nunca para identidade). Todo perfil agora usa o mesmo chip
 * neutro: base em degradê chumbo→preto com um brilho translúcido branco por
 * cima (a mesma linguagem de vidro fosco do resto do painel) — daí "branco,
 * chumbo e preto" no pedido do cliente. Texto branco sólido funciona em
 * qualquer ponto do chip porque a base NUNCA sai da faixa escura, e o brilho
 * tem teto baixo (24% no máximo, no estado ativo).
 *
 * A ponta clara da base é chumbo (#334155, slate-700), não um cinza mais
 * aberto (slate-600): medido num harness de contraste, o brilho por cima
 * empurrava o texto branco pra 4,13:1 (inativo) e 2,54:1 (ativo) no canto
 * mais claro do botão — os dois abaixo do mínimo AA de 4,5. Com a base mais
 * escura e o teto do brilho reduzido, o mesmo cálculo dá 6,83:1 e 5,12:1.
 */
const FUNDO_PERFIL_BASE = "linear-gradient(150deg, #334155 0%, #1E293B 55%, #020617 100%)";
const BRILHO_PERFIL = "linear-gradient(120deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0) 46%)";
const BRILHO_PERFIL_ATIVO = "linear-gradient(120deg, rgba(255,255,255,0.24) 0%, rgba(255,255,255,0) 58%)";

function CardExtremo({
  titulo,
  perfil,
  valor,
  sufixo,
  fundo,
  vazio,
}: {
  titulo: string;
  perfil: PerfilAnalise | null;
  valor?: (p: PerfilAnalise) => string;
  sufixo: string;
  fundo: string;
  vazio: string;
}) {
  return (
    <div
      className="card-hover overflow-hidden rounded-xl p-4"
      style={{ background: fundo, boxShadow: "0 10px 24px -14px rgba(0,0,0,0.35)" }}
    >
      <div
        className="text-[13px] uppercase tracking-[0.12em]"
        style={{ color: TINTA_PRETA, fontWeight: 700 }}
      >
        {titulo}
      </div>
      {perfil ? (
        <>
          <div
            className="mt-1.5 truncate text-[19px]"
            style={{ fontWeight: 800, color: TINTA_PRETA }}
            title={`@${perfil.autor}`}
          >
            @{perfil.autor}
          </div>
          <div
            className="tnum mt-0.5 text-sm"
            style={{ color: TINTA_PRETA, fontWeight: 700 }}
          >
            {valor ? valor(perfil) : ""} {sufixo}
          </div>
        </>
      ) : (
        <div className="mt-1.5 text-sm" style={{ color: TINTA_PRETA, fontWeight: 600 }}>
          {vazio}
        </div>
      )}
    </div>
  );
}

/** Barra dupla favorável/contrária de um perfil na tabela de ranking. */
function BarraLados({ contra, favor }: { contra: number; favor: number }) {
  const total = contra + favor || 1;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-bg-2">
      <div style={{ width: `${(contra / total) * 100}%`, background: COR_CONTRA }} />
      <div style={{ width: `${(favor / total) * 100}%`, background: COR_FAVOR }} />
    </div>
  );
}

export function PerfilPage() {
  const [dias, setDias] = useState<Dias>(30);
  const [sel, setSel] = useState<string | null>(null);

  const { data } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000 });
  const { data: comments = [] } = useQuery({
    queryKey: ["comments"],
    queryFn: () => fetchComments(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Par (post, sentimento) de todo comentário de cidadão — é o que sustenta a
  // contagem de críticas por perfil sem trazer texto nem @ de ninguém.
  const { data: leves = [] } = useQuery({
    queryKey: ["comentarios-leves"],
    queryFn: () => fetchComentariosLeves(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // As palavras da tela Relevância são o critério da análise (pedido de 27/07).
  const { data: keywords = [] } = useQuery({
    queryKey: ["admin-keywords"],
    queryFn: fetchKeywords,
    staleTime: 5 * 60 * 1000,
  });
  // Mesma queryKey do RankingSeguidores: os dois leem do cache do React Query,
  // então a série é buscada uma vez só por ciclo de atualização.
  const { data: metrics = [] } = useQuery({
    queryKey: ["profile-metrics"],
    queryFn: () => fetchProfileMetrics(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });

  // Sem palavra ativa cadastrada, `casaRelevancia` deixa tudo passar e a tela
  // conta o período inteiro. Isso não é mais sinalizado aqui (o aviso saiu em
  // 27/07): quem configura a lista é a tela Relevância, e é lá que a ausência
  // dela aparece.
  const kws = useMemo(() => prepararKeywords(keywords), [keywords]);

  const postsPeriodo = useMemo<Post[]>(
    () => filtrarPorPeriodo(data?.data ?? [], dias),
    [data, dias]
  );

  const analise = useMemo(
    () => analisarPerfis(postsPeriodo, leves, kws),
    [postsPeriodo, leves, kws]
  );

  // Só perfis que publicaram sobre a gestão no período entram nos rankings.
  const ativos = useMemo(() => analise.filter((p) => p.postsGestao > 0), [analise]);

  // Quem FAZ: tom das publicações do próprio perfil (migration 010).
  // Elegível quem publicou sobre a gestão; "quem menos critica" entre perfis
  // que não falam do assunto não seria resposta, seria ausência.
  const rankFazCritica = useMemo(
    () => extremos(analise, (p) => p.fazCritica, (p) => p.postsGestao > 0),
    [analise]
  );
  const rankFazElogio = useMemo(
    () => extremos(analise, (p) => p.fazElogio, (p) => p.postsGestao > 0),
    [analise]
  );
  // Quem TEM: reação dos cidadãos nas publicações do perfil.
  const rankContra = useMemo(
    () => extremos(analise, (p) => p.contra, (p) => p.contra + p.favor >= MIN_AMOSTRA),
    [analise]
  );
  const rankFavor = useMemo(
    () => extremos(analise, (p) => p.favor, (p) => p.contra + p.favor >= MIN_AMOSTRA),
    [analise]
  );

  const totalGeral = useMemo(() => {
    const contra = ativos.reduce((s, p) => s + p.contra, 0);
    const favor = ativos.reduce((s, p) => s + p.favor, 0);
    const fazCritica = ativos.reduce((s, p) => s + p.fazCritica, 0);
    const fazElogio = ativos.reduce((s, p) => s + p.fazElogio, 0);
    const postsGestao = ativos.reduce((s, p) => s + p.postsGestao, 0);
    const posts = analise.reduce((s, p) => s + p.posts, 0);
    return { contra, favor, fazCritica, fazElogio, postsGestao, posts };
  }, [ativos, analise]);

  // ── Perfil selecionado ────────────────────────────────────────────────────
  const autor =
    sel ?? ativos.find((p) => /prefeito/i.test(p.categoria))?.autor ?? ativos[0]?.autor ?? analise[0]?.autor ?? null;
  const perfilAtivo = analise.find((p) => p.autor === autor) ?? null;

  const seguidores = useMemo(
    () => montarRanking(metrics).find((p) => p.handle === (autor || "").toLowerCase()) ?? null,
    [metrics, autor]
  );

  // Posts do perfil que passam no critério da Relevância — é sobre eles que
  // todo o detalhe abaixo é calculado.
  const postsPerfil = useMemo(
    () => postsPeriodo.filter((p) => p.autor === autor && casaRelevancia(p, kws)),
    [postsPeriodo, autor, kws]
  );
  const idx = useMemo(() => calcIndices(postsPerfil), [postsPerfil]);

  const urlsPerfil = useMemo(() => new Set(postsPerfil.map((p) => p.url)), [postsPerfil]);

  // Críticas em destaque: comentários contrários mais curtidos, restritos às
  // publicações do perfil que falam da gestão.
  const negComments = useMemo<Comment[]>(
    () =>
      comments
        .filter(
          (c) =>
            urlsPerfil.has(c.url_post) &&
            (c.sentimento || "").toLowerCase() === "negativo" &&
            (c.texto || "").length > 2
        )
        .sort((a, b) => (b.curtidas || 0) - (a.curtidas || 0))
        .slice(0, 8),
    [comments, urlsPerfil]
  );

  if (!data) return <div className="p-8 text-txt-2">Carregando…</div>;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-txt-1">Análise por Perfil</h1>
          <p className="text-sm text-txt-3">
            Quem fala do prefeito, da prefeitura e da gestão · {periodoLabel(dias)}
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} />
      </div>

      {/* Seletor de perfis — subiu para o topo da página (revisão de 28/07):
          é o controle que decide o que todo o resto da tela mostra, então
          vem antes dos cards, não depois do ranking. Chip neutro (revisão de
          28/07 novamente, mesmo dia): a cor por categoria saiu — todo perfil
          usa o mesmo degradê chumbo→preto com brilho translúcido branco;
          diferenciar por categoria virou tarefa só do tooltip (title). */}
      {analise.length > 0 && (
        <div>
          <div className="section-label mb-2">Selecionar perfil</div>
          <div className="flex flex-wrap gap-2">
            {analise.map((p) => {
              const ativo = p.autor === autor;
              return (
                <button
                  key={p.autor}
                  onClick={() => setSel(p.autor)}
                  className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white transition"
                  style={{
                    backgroundImage: `${ativo ? BRILHO_PERFIL_ATIVO : BRILHO_PERFIL}, ${FUNDO_PERFIL_BASE}`,
                    fontWeight: 800,
                    // Sem opacity reduzida no estado inativo: opacity mistura
                    // TODO o botão (fundo + texto) com o que está atrás dele,
                    // e isso desidratava o contraste do gradiente com o fundo
                    // escuro da página sem eu saber por quanto — melhor
                    // diferenciar ativo/inativo só pelo anel e pela força do
                    // brilho, que não mexem na cor do texto.
                    boxShadow: ativo
                      ? "0 0 0 2px rgba(255,255,255,0.9), 0 10px 22px -10px rgba(0,0,0,0.6)"
                      : "0 6px 16px -10px rgba(0,0,0,0.5)",
                  }}
                  title={`${p.categoria} · ${p.postsGestao} publicações sobre a gestão`}
                >
                  @{p.autor}
                  {/* Selo claro (quase sólido) sobre o chip escuro — inverte
                      o selo escuro da versão colorida, que sumia de vista
                      num fundo agora igualmente escuro. */}
                  <span
                    className="tnum rounded-full px-1.5 py-0.5 text-[12px]"
                    style={{ background: "rgba(248,250,252,0.92)", color: "#0B1120", fontWeight: 800 }}
                  >
                    {p.postsGestao}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* O que cada perfil PUBLICA sobre a gestão */}
      <div>
        <div className="section-label mb-2">
          Quem critica e quem elogia a gestão · {fmtInt(totalGeral.fazCritica)} publicações
          críticas e {fmtInt(totalGeral.fazElogio)} favoráveis no período
        </div>
        {/* Só os extremos de "mais" (revisão de 27/07) — "menos critica"/
            "menos elogia" saíram: o interesse prático é quem concentra a
            crítica e quem concentra o elogio, não quem faz pouco de cada. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CardExtremo
            titulo="Mais critica a gestão"
            perfil={rankFazCritica.maior}
            valor={(p) => `${fmtInt(p.fazCritica)} de ${fmtInt(p.postsGestao)}`}
            sufixo="publicações"
            fundo={FUNDO_CRITICA}
            vazio="Ninguém publicou sobre a gestão"
          />
          <CardExtremo
            titulo="Mais elogia a gestão"
            perfil={rankFazElogio.maior}
            valor={(p) => `${fmtInt(p.fazElogio)} de ${fmtInt(p.postsGestao)}`}
            sufixo="publicações"
            fundo={FUNDO_ELOGIO}
            vazio="Ninguém publicou sobre a gestão"
          />
        </div>
      </div>

      {/* O que cada perfil RECEBE dos cidadãos */}
      <div>
        <div className="section-label mb-2">
          Quem concentra a reação dos cidadãos · {fmtInt(totalGeral.contra)} comentários
          contrários e {fmtInt(totalGeral.favor)} favoráveis
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CardExtremo
            titulo="Recebe mais críticas"
            perfil={rankContra.maior}
            valor={(p) => `${fmtInt(p.contra)} contrárias · ${p.pctContra}%`}
            sufixo=""
            fundo={FUNDO_CRITICA}
            vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
          />
          <CardExtremo
            titulo="Recebe mais elogios"
            perfil={rankFavor.maior}
            valor={(p) => `${fmtInt(p.favor)} favoráveis · ${100 - p.pctContra}%`}
            sufixo=""
            fundo={FUNDO_ELOGIO}
            vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
          />
        </div>
      </div>

      {/* Ranking completo */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <div className="section-label">Ranking dos perfis monitorados</div>
          <div className="text-[13px] text-txt-3">
            {fmtInt(totalGeral.contra)} críticas contrárias · {fmtInt(totalGeral.favor)} favoráveis
            no período
          </div>
        </div>
        {ativos.length === 0 ? (
          <p className="text-sm text-txt-3">
            Nenhum perfil publicou sobre a gestão {periodoLabel(dias)}. Amplie o período acima.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left">
              <thead>
                <tr className="text-[12px] font-bold uppercase tracking-wide text-txt-3">
                  <th className="pb-2 pr-3 font-bold">Perfil</th>
                  <th className="pb-2 pr-3 text-right font-bold">Publicações<br />sobre a gestão</th>
                  <th className="pb-2 pr-3 text-right font-bold">Publica<br />criticando</th>
                  <th className="pb-2 pr-3 text-right font-bold">Publica<br />elogiando</th>
                  <th className="pb-2 pr-3 text-right font-bold">Recebe<br />críticas</th>
                  <th className="pb-2 pr-3 text-right font-bold">Recebe<br />elogios</th>
                  <th className="pb-2 pr-3 text-right font-bold">Saldo<br />recebido</th>
                  <th className="pb-2 w-32 font-bold">Reação</th>
                </tr>
              </thead>
              <tbody>
                {ativos.map((p) => {
                  const cor = CAT_COR[p.categoria] ?? "#64748B";
                  const poucaAmostra = p.contra + p.favor < MIN_AMOSTRA;
                  return (
                    <tr
                      key={p.autor}
                      onClick={() => setSel(p.autor)}
                      className={`cursor-pointer border-t border-line text-sm transition hover:bg-bg-2 ${
                        p.autor === autor ? "bg-bg-2" : ""
                      }`}
                    >
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: cor }} />
                          <span className="font-bold text-txt-1">@{p.autor}</span>
                        </span>
                      </td>
                      <td className="tnum py-2 pr-3 text-right font-bold text-txt-1">
                        {fmtInt(p.postsGestao)}
                        <span className="ml-1 text-[12px] font-semibold text-txt-3">/{fmtInt(p.posts)}</span>
                      </td>
                      <td
                        className="tnum py-2 pr-3 text-right font-bold"
                        style={{ color: p.fazCritica ? COR_CONTRA : "var(--txt3)" }}
                      >
                        {fmtInt(p.fazCritica)}
                      </td>
                      <td
                        className="tnum py-2 pr-3 text-right font-bold"
                        style={{ color: p.fazElogio ? COR_FAVOR : "var(--txt3)" }}
                      >
                        {fmtInt(p.fazElogio)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right font-bold" style={{ color: COR_CONTRA }}>
                        {fmtInt(p.contra)}
                      </td>
                      <td className="tnum py-2 pr-3 text-right font-bold" style={{ color: COR_FAVOR }}>
                        {fmtInt(p.favor)}
                      </td>
                      <td
                        className="tnum py-2 pr-3 text-right font-bold"
                        style={{ color: p.saldo > 0 ? COR_FAVOR : p.saldo < 0 ? COR_CONTRA : "var(--txt3)" }}
                      >
                        {p.saldo > 0 ? "+" : ""}
                        {fmtInt(p.saldo)}
                      </td>
                      <td className="py-2">
                        {poucaAmostra ? (
                          <span className="text-[12px] font-semibold text-txt-3">amostra pequena</span>
                        ) : (
                          <BarraLados contra={p.contra} favor={p.favor} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[13px] text-txt-3">
          Perfis com menos de {MIN_AMOSTRA} comentários que tomam partido ficam fora dos
          rankings de críticas: com dois ou três comentários, qualquer perfil vira o
          &ldquo;mais crítico&rdquo; da cidade.
        </p>
      </div>

      {analise.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-1 p-6 text-sm text-txt-2">
          Sem publicações {periodoLabel(dias)}. Amplie o período para ver os perfis.
        </div>
      ) : (
        <>
          {/* Cabeçalho do perfil ativo — nome em corpo de título de página
              (revisão de 28/07): era text-lg, do mesmo tamanho que qualquer
              rótulo ao redor, fácil de olhar pra tela e não ter certeza de
              qual perfil está em verificação. Categoria volta a ser um chip
              neutro (chumbo), não colorido por CAT_COR — mesma doutrina do
              seletor logo acima. */}
          {perfilAtivo && (
            <div className="rounded-xl border border-line bg-bg-1 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[34px] font-extrabold leading-none tracking-tight text-txt-1 sm:text-[42px]">
                    @{perfilAtivo.autor}
                  </span>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white"
                    style={{ background: CHUMBO }}
                  >
                    {perfilAtivo.categoria || "—"}
                  </span>
                </div>
                <span
                  className="rounded-full px-3 py-1.5 text-sm font-bold"
                  style={{ color: NIVEL_COLOR[idx.nivel], background: `${NIVEL_COLOR[idx.nivel]}1A` }}
                >
                  Risco {NIVEL_LABEL[idx.nivel]}
                </span>
              </div>
              <p className="mt-2 text-[13px] font-semibold text-txt-3">
                {fmtInt(perfilAtivo.postsGestao)} de {fmtInt(perfilAtivo.posts)} publicações citam
                as palavras da Relevância
              </p>
            </div>
          )}

          {/* KPIs do perfil */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiStat
              label="Seguidores"
              value={seguidores ? fmtInt(seguidores.seguidores) : "n/d"}
              sub={
                seguidores
                  ? seguidores.delta24h === null
                    ? "primeira coleta registrada"
                    : "saldo nas últimas 24h"
                  : "aguardando primeira coleta"
              }
              delta={
                seguidores && seguidores.delta24h !== null
                  ? {
                      v: seguidores.delta24h,
                      dir: seguidores.delta24h > 0 ? "up" : seguidores.delta24h < 0 ? "down" : "flat",
                    }
                  : undefined
              }
            />
            <KpiStat
              label="Críticas contrárias"
              value={
                <span style={{ color: COR_CONTRA, fontWeight: 700 }}>
                  {fmtInt(perfilAtivo?.contra ?? 0)}
                </span>
              }
              sub={`${perfilAtivo?.pctContra ?? 0}% dos que tomam partido`}
            />
            <KpiStat
              label="Manifestações favoráveis"
              value={
                <span style={{ color: COR_FAVOR, fontWeight: 700 }}>
                  {fmtInt(perfilAtivo?.favor ?? 0)}
                </span>
              }
              sub={`${100 - (perfilAtivo?.pctContra ?? 0)}% dos que tomam partido`}
            />
            {/* O KPI "O que publica sobre a gestão" saiu na revisão de 27/07:
                mostrava "7/2 críticas / elogios" logo acima da barra "Tom das
                publicações", que já diz o mesmo com mais clareza e ainda
                separa as neutras. Dois números para o mesmo fato, e o do KPI
                era o mais difícil de ler. */}
            <KpiStat
              label="Publicações sobre a gestão"
              value={fmtInt(perfilAtivo?.postsGestao ?? 0)}
              sub={`de ${fmtInt(perfilAtivo?.posts ?? 0)} no período`}
            />
          </div>

          {/* O que o perfil publica x o que recebe, lado a lado. É a leitura
              que o cliente pediu: fala e reação são coisas diferentes. */}
          {perfilAtivo && perfilAtivo.postsGestao > 0 && (
            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label mb-2">Tom das publicações de @{perfilAtivo.autor}</div>
              <div className="flex h-4 w-full overflow-hidden rounded-full bg-bg-2">
                <div
                  style={{
                    width: `${(perfilAtivo.fazCritica / perfilAtivo.postsGestao) * 100}%`,
                    background: COR_CONTRA,
                  }}
                />
                <div
                  style={{
                    width: `${(perfilAtivo.fazNeutro / perfilAtivo.postsGestao) * 100}%`,
                    background: COLOR_SENTIMENT.neu,
                  }}
                />
                <div
                  style={{
                    width: `${(perfilAtivo.fazElogio / perfilAtivo.postsGestao) * 100}%`,
                    background: COR_FAVOR,
                  }}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-txt-2">
                <span><b style={{ color: COR_CONTRA }}>{fmtInt(perfilAtivo.fazCritica)}</b> criticam a gestão</span>
                <span><b style={{ color: COLOR_SENTIMENT.neu }}>{fmtInt(perfilAtivo.fazNeutro)}</b> sem juízo</span>
                <span><b style={{ color: COR_FAVOR }}>{fmtInt(perfilAtivo.fazElogio)}</b> elogiam a gestão</span>
                {perfilAtivo.fazCritica + perfilAtivo.fazElogio > 0 && (
                  <span className="ml-auto text-txt-3">
                    {perfilAtivo.pctFazCritica}% das que tomam partido são críticas
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Ranking de seguidores de todos os perfis monitorados (pedido do
              cliente em 25/07): quem tem mais e menos audiência e quanto cada
              conta ganhou ou perdeu entre as coletas. */}
          <RankingSeguidores />

          {/* Comentários contrários em destaque */}
          <div className="rounded-xl border border-line bg-bg-1 p-4">
            <div className="section-label mb-2">Críticas em destaque</div>
            {negComments.length === 0 ? (
              <p className="text-sm text-txt-3">
                Nenhum comentário contrário classificado nas publicações de @{autor} sobre a
                gestão {periodoLabel(dias)}.
              </p>
            ) : (
              <ul className="space-y-2">
                {negComments.map((c, i) => (
                  <li key={i} className="rounded-md border border-line bg-bg-2 p-2.5">
                    <p className="text-base leading-relaxed text-txt-1" style={{ fontWeight: 600 }}>{c.texto}</p>
                    <div className="mt-1 flex items-center gap-2 text-[13px] text-txt-3">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: COR_CONTRA }} />
                      {c.username && <span>@{c.username}</span>}
                      {(c.curtidas || 0) > 0 && <span className="ml-auto tnum">♥ {c.curtidas}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Influenciadores — conteúdo da antiga página da sidebar, encaixado
          aqui por decisão da reunião de 24/07 (menos itens no menu). */}
      <InfluencersSection postsPeriodo={postsPeriodo} dias={dias} />
    </div>
  );
}
