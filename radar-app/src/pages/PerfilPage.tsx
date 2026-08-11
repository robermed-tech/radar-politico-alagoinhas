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
import { fmtInt } from "@/lib/format";
import { ContadorAnimado } from "@/components/ContadorAnimado";
import { FUNDO_ESCUTA } from "@/components/superficieRadio";
import { RankingSeguidores } from "@/components/RankingSeguidores";
import { montarRanking } from "@/lib/seguidores";
import { PeriodoFilter, periodoLabel, periodoFrase, type Dias } from "@/components/PeriodoFilter";
import { prepararKeywords, casaRelevancia } from "@/lib/relevancia";
import { analisarPerfis, extremos, MIN_AMOSTRA, type PerfilAnalise } from "@/lib/analisePerfis";
import { EsqueletoPagina } from "@/components/EsqueletoPagina";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
  tintaSentimento,
} from "@/components/ComentarioBox";

// Sentimento como TEXTO usa os tokens de tema, nunca o par de gráfico
// (COLOR_SENTIMENT é cor de preenchimento; como letra sobre o creme reprova).
const COR_CONTRA = "var(--danger)";
const COR_FAVOR = "var(--success)";

/** Agrupamento do seletor (prévia de 04/08): acha-se o perfil pelo grupo,
 *  não varrendo a lista. A categoria vem do cadastro de Fontes. */
function grupoDaCategoria(cat: string): string {
  if (/prefeit|governo/i.test(cat)) return "Governo";
  if (/imprensa/i.test(cat)) return "Imprensa";
  if (/oposi/i.test(cat)) return "Oposição";
  return "Outros";
}
const ORDEM_GRUPO = ["Governo", "Imprensa", "Oposição", "Outros"];

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

/**
 * Card de extremo ("quem mais critica…", "quem mais elogia…").
 *
 * Revisão de 29/07 (pedido do cliente): o card volta a ser BRANCO — o mesmo
 * vidro dos outros cards do painel (`bg-bg-1`, que é branco no tema claro e
 * segue o toggle no escuro) — e quem carrega a cor semântica agora é o @ do
 * perfil, em corpo grande: verde para elogio, vermelho para crítica. O
 * gradiente preenchido de 28/07 saiu: com quatro cards coloridos lado a lado
 * o que o olho lia primeiro era a faixa de cor, e a resposta da tela é QUEM,
 * não a cor.
 *
 * A cor do @ vem dos tokens `--success`/`--danger` (text-success/text-danger),
 * não do par #22C55E/#EF4444 dos gráficos: sobre fundo branco o verde de
 * gráfico mede 2,29:1 e reprovaria até o mínimo de 3:1 de texto grande. Os
 * tokens já são resolvidos por tema (#16A34A/#DC2626 no claro, #4ADE80/#F87171
 * no escuro) e passam AA nos dois. Verde/vermelho seguem reservados a
 * sentimento, que é exatamente o que estes quatro cards medem.
 */
function CardExtremo({
  titulo,
  perfil,
  valor,
  sufixo,
  tom,
  vazio,
}: {
  titulo: string;
  perfil: PerfilAnalise | null;
  valor?: (p: PerfilAnalise) => string;
  sufixo: string;
  tom: "critica" | "elogio";
  vazio: string;
}) {
  const corTexto = tom === "critica" ? "text-danger" : "text-success";
  // Fio vertical na cor do grupo: mantém a leitura "crítica vs. elogio" que o
  // fundo colorido dava, sem inundar o tile. Desde a prévia de 04/08 os
  // quatro extremos moram em UM card ("Quem puxa a conversa"), como tiles
  // compactos — o fio é absoluto porque border-left mudaria a largura.
  const corFio = tom === "critica" ? "var(--danger)" : "var(--success)";

  return (
    <div className="relative rounded-xl border border-line bg-bg-2 p-4 pl-5">
      <span
        aria-hidden
        className="absolute left-0 top-3 bottom-3 w-1 rounded-full"
        style={{ background: corFio }}
      />
      <div className="section-label" style={{ fontSize: 11 }}>{titulo}</div>
      {perfil ? (
        <>
          <div
            className={`mt-1.5 truncate font-display text-[21px] font-bold leading-tight tracking-tight ${corTexto}`}
            title={`@${perfil.autor}`}
          >
            @{perfil.autor}
          </div>
          <div className="tnum mt-1 text-sm font-bold text-txt-2">
            {valor ? valor(perfil) : ""} {sufixo}
          </div>
        </>
      ) : (
        <div className="mt-2 text-sm font-semibold text-txt-2">{vazio}</div>
      )}
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

  if (!data) return <EsqueletoPagina titulo="Análise por Perfil" />;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Análise por Perfil</h1>
          <p className="text-base text-txt-2">
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
      {/* Prévia de 04/08: o muro de chips em linhas embrulhadas vira um
          TRILHO rolável agrupado por categoria — acha-se o perfil pelo grupo.
          O chip continua NEUTRO para toda categoria (regra de 28/07: cor por
          categoria não existe; verde/vermelho são de sentimento). */}
      {analise.length > 0 && (
        <div>
          <div className="section-label mb-2">Selecionar perfil</div>
          <div className="flex gap-5 overflow-x-auto pb-2">
            {ORDEM_GRUPO.map((grupo) => {
              const doGrupo = analise.filter((p) => grupoDaCategoria(p.categoria) === grupo);
              if (doGrupo.length === 0) return null;
              return (
                <div key={grupo} className="shrink-0">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-txt-3">
                    {grupo}
                  </div>
                  <div className="flex gap-2">
                    {doGrupo.map((p) => {
                      const ativo = p.autor === autor;
                      return (
                        <button
                          key={p.autor}
                          onClick={() => setSel(p.autor)}
                          className="flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm text-white transition"
                          style={{
                            backgroundImage: `${ativo ? BRILHO_PERFIL_ATIVO : BRILHO_PERFIL}, ${FUNDO_PERFIL_BASE}`,
                            fontWeight: 800,
                            // Sem opacity reduzida no inativo (mistura fundo e
                            // texto com o que está atrás); ativo = anel, com o
                            // laranja da marca por fora do respiro branco.
                            boxShadow: ativo
                              ? "0 0 0 2px var(--bg-page), 0 0 0 4px var(--brand), 0 10px 22px -10px rgba(0,0,0,0.6)"
                              : "0 6px 16px -10px rgba(0,0,0,0.5)",
                          }}
                          title={`${p.categoria} · ${p.postsGestao} publicações sobre a gestão`}
                        >
                          @{p.autor}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Perfil em verificação + os números dele, imediatamente abaixo da
          relação completa de perfis monitorados (pedido de 29/07). Antes este
          bloco vinha depois da tabela de ranking, a meia página do seletor: o
          usuário clicava num chip no topo e o efeito do clique acontecia fora
          da tela. Agora selecionar e ler o resultado ficam na mesma dobra.
          Nome em corpo de título de página (28/07) e categoria em chip neutro
          (chumbo), não colorido por CAT_COR — mesma doutrina do seletor. */}
      {/* Prévia de 04/08: o cabeçalho do perfil e os 4 KPIs se FUNDEM num
          cartão único — quem está sendo lido à esquerda, os números à direita
          — devolvendo uma dobra inteira de tela. */}
      {perfilAtivo && (
        <div className="grid overflow-hidden rounded-[20px] border border-line bg-bg-1 lg:grid-cols-[minmax(280px,1.1fr)_2fr]" style={{ boxShadow: "var(--shadow-ambient)" }}>
          <div className="flex flex-col justify-center gap-2 px-7 py-6">
            <span
              className="w-fit rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-white"
              style={{ background: FUNDO_ESCUTA }}
            >
              {perfilAtivo.categoria || "—"}
            </span>
            {/* Laranja da marca CHAPADO, exceção pedida pelo cliente em 04/08:
                é o único texto do painel que não passa pelo `--brand-text`.
                Medido sobre o card: 2,14:1 no tema claro (abaixo do mínimo de
                3:1 até para texto grande) e 8,45:1 no escuro. Fica como está
                por decisão de design — o nome também aparece no chip aceso do
                seletor logo acima, então a informação não depende só daqui.
                Se um dia tiver que passar no AA sem perder o tom, o caminho é
                `var(--brand-text)` (5,54:1 no claro). */}
            <span
              className="font-display text-[30px] font-bold leading-none tracking-tight sm:text-[40px]"
              style={{ wordBreak: "break-all", color: "#F79641" }}
            >
              @{perfilAtivo.autor}
            </span>
            <p className="text-[13.5px] font-semibold text-txt-3">
              {fmtInt(perfilAtivo.postsGestao)} de {fmtInt(perfilAtivo.posts)} publicações citam
              as palavras da Relevância
            </p>
          </div>
          <div className="grid grid-cols-2 border-t border-line lg:grid-cols-4 lg:border-l lg:border-t-0">
            <div className="border-r border-line px-5 py-5">
              <div className="section-label">Seguidores</div>
              <div className="tnum mt-2 font-display text-[30px] font-bold leading-none text-txt-1">
                {seguidores ? (
                  <>
                    <ContadorAnimado valor={seguidores.seguidores} formatar={fmtInt} />
                    {seguidores.delta24h !== null && seguidores.delta24h !== 0 && (
                      <span className="ml-1.5 text-[15px]" style={{ color: seguidores.delta24h > 0 ? COR_FAVOR : COR_CONTRA }}>
                        {seguidores.delta24h > 0 ? "▲" : "▼"}{Math.abs(seguidores.delta24h)}
                      </span>
                    )}
                  </>
                ) : "n/d"}
              </div>
              <div className="mt-1.5 text-xs font-medium text-txt-3">
                {seguidores
                  ? seguidores.delta24h === null ? "primeira coleta registrada" : "saldo nas últimas 24h"
                  : "aguardando primeira coleta"}
              </div>
            </div>
            <div className="px-5 py-5 lg:border-r lg:border-line">
              <div className="section-label">Críticas contrárias</div>
              <div className="tnum mt-2 font-display text-[30px] font-bold leading-none" style={{ color: COR_CONTRA }}>
                <ContadorAnimado valor={perfilAtivo.contra} formatar={fmtInt} />
              </div>
              <div className="mt-1.5 text-xs font-medium text-txt-3">{perfilAtivo.pctContra}% dos que tomam partido</div>
            </div>
            <div className="border-r border-t border-line px-5 py-5 lg:border-t-0">
              <div className="section-label">Favoráveis</div>
              <div className="tnum mt-2 font-display text-[30px] font-bold leading-none" style={{ color: COR_FAVOR }}>
                <ContadorAnimado valor={perfilAtivo.favor} formatar={fmtInt} />
              </div>
              <div className="mt-1.5 text-xs font-medium text-txt-3">{100 - perfilAtivo.pctContra}% dos que tomam partido</div>
            </div>
            <div className="border-t border-line px-5 py-5 lg:border-t-0">
              <div className="section-label">Sobre a gestão</div>
              <div className="tnum mt-2 font-display text-[30px] font-bold leading-none text-txt-1">
                <ContadorAnimado valor={perfilAtivo.postsGestao} formatar={fmtInt} />
              </div>
              <div className="mt-1.5 text-xs font-medium text-txt-3">de {fmtInt(perfilAtivo.posts)} publicações no período</div>
            </div>
          </div>
        </div>
      )}

      {/* Os quatro extremos num card só (prévia de 04/08): "quem PUBLICA" na
          linha de cima, "quem RECEBE" na de baixo, com as contagens no rótulo.
          Só os extremos de "mais" (revisão de 27/07). */}
      <div className="rounded-[20px] border border-line bg-bg-1 p-5" style={{ boxShadow: "var(--shadow-ambient)" }}>
        <div className="section-label">
          Quem puxa a conversa · {fmtInt(totalGeral.fazCritica)} publicações críticas e{" "}
          {fmtInt(totalGeral.fazElogio)} favoráveis · {fmtInt(totalGeral.contra)} comentários
          contrários e {fmtInt(totalGeral.favor)} favoráveis
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CardExtremo
            titulo="Mais critica a gestão"
            perfil={rankFazCritica.maior}
            valor={(p) => `${fmtInt(p.fazCritica)} de ${fmtInt(p.postsGestao)}`}
            sufixo="publicações"
            tom="critica"
            vazio="Ninguém publicou sobre a gestão"
          />
          <CardExtremo
            titulo="Mais elogia a gestão"
            perfil={rankFazElogio.maior}
            valor={(p) => `${fmtInt(p.fazElogio)} de ${fmtInt(p.postsGestao)}`}
            sufixo="publicações"
            tom="elogio"
            vazio="Ninguém publicou sobre a gestão"
          />
          <CardExtremo
            titulo="Recebe mais críticas"
            perfil={rankContra.maior}
            valor={(p) => `${fmtInt(p.contra)} contrárias · ${p.pctContra}%`}
            sufixo=""
            tom="critica"
            vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
          />
          <CardExtremo
            titulo="Recebe mais elogios"
            perfil={rankFavor.maior}
            valor={(p) => `${fmtInt(p.favor)} favoráveis · ${100 - p.pctContra}%`}
            sufixo=""
            tom="elogio"
            vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
          />
        </div>
      </div>

      {/* A tabela "Ranking dos perfis monitorados" saiu em 01/08 (pedido do
          cliente, print com X vermelho). Os números dela continuam calculados
          em lib/analisePerfis.ts e resumidos nos cards de extremo acima e nos
          KPIs do perfil selecionado. Não recriar sem pedido explícito. */}

      {analise.length === 0 ? (
        <div className="rounded-xl border border-line bg-bg-1 p-6 text-sm text-txt-2">
          Sem publicações {periodoFrase(dias)}. Amplie o período para ver os perfis.
        </div>
      ) : (
        <>
          {/* O cabeçalho do perfil ativo e os KPIs dele subiram para logo
              abaixo do seletor (29/07) — ver o bloco no topo desta página.
              O card "Tom das publicações de @perfil" saiu na mesma revisão, e
              a tabela de ranking saiu em 01/08. Não recriar sem pedido
              explícito; `fazNeutro` e `pctFazCritica` continuam calculados em
              lib/analisePerfis.ts, agora sem consumidor nesta tela. */}

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
                gestão {periodoFrase(dias)}.
              </p>
            ) : (
              <ul className="space-y-2">
                {negComments.map((c, i) => (
                  <li key={i}>
                    <ComentarioBox>
                      <ComentarioTexto>{c.texto}</ComentarioTexto>
                      <ComentarioMeta>
                        <ComentarioChip cor={tintaSentimento("negativo")}>crítico</ComentarioChip>
                        {c.username && <span>@{c.username}</span>}
                        {(c.curtidas || 0) > 0 && <span className="tnum ml-auto">♥ {c.curtidas}</span>}
                      </ComentarioMeta>
                    </ComentarioBox>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

    </div>
  );
}
