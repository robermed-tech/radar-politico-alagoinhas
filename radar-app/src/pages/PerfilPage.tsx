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

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};
const labelTema = (t: string) => TEMA_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "—");

const COR_CONTRA = COLOR_SENTIMENT.neg;
const COR_FAVOR = COLOR_SENTIMENT.pos;

/** Card de extremo ("quem mais…", "quem menos…"). */
function CardExtremo({
  titulo,
  perfil,
  valor,
  sufixo,
  cor,
  vazio,
}: {
  titulo: string;
  perfil: PerfilAnalise | null;
  valor?: (p: PerfilAnalise) => string;
  sufixo: string;
  cor: string;
  vazio: string;
}) {
  return (
    <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
      <div className="section-label">{titulo}</div>
      {perfil ? (
        <>
          <div className="mt-1 truncate text-[17px] font-extrabold" style={{ color: cor }} title={`@${perfil.autor}`}>
            @{perfil.autor}
          </div>
          <div className="tnum mt-0.5 text-[13px] font-bold text-txt-2">
            {valor ? valor(perfil) : ""} {sufixo}
          </div>
        </>
      ) : (
        <div className="mt-1 text-[13px] text-txt-3">{vazio}</div>
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

  const kws = useMemo(() => prepararKeywords(keywords), [keywords]);
  const semKeywords = kws.length === 0;

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

  const rankVolume = useMemo(
    () => extremos(analise, (p) => p.postsGestao, (p) => p.postsGestao > 0),
    [analise]
  );
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
    const postsGestao = ativos.reduce((s, p) => s + p.postsGestao, 0);
    const posts = analise.reduce((s, p) => s + p.posts, 0);
    return { contra, favor, postsGestao, posts };
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

  // Temas das publicações do perfil sobre a gestão.
  const temas = useMemo(() => {
    const by: Record<string, { tema: string; n: number; neg: number }> = {};
    for (const p of postsPerfil) {
      const t = (p.tema || "").trim();
      if (!t || t === "—") continue;
      const e = (by[t] ??= { tema: t, n: 0, neg: 0 });
      e.n += 1;
      if (p.sentimento_post === "negativo") e.neg += 1;
    }
    return Object.values(by).sort((a, b) => b.n - a.n).slice(0, 6);
  }, [postsPerfil]);

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
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-txt-1">Análise por Perfil</h1>
          <p className="text-sm text-txt-3">
            Quem fala do prefeito, da prefeitura e da gestão · {periodoLabel(dias)}
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} />
      </div>

      {/* Critério da análise, dito na cara: o recorte é a tela Relevância. */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="section-label mb-1">Critério desta análise</div>
        {semKeywords ? (
          <p className="text-sm text-txt-2">
            Nenhuma palavra ativa cadastrada em <b>Relevância</b>, então todas as publicações
            do período estão sendo contadas. Cadastre as palavras que definem o assunto
            (prefeito, prefeitura, gestão) para que o recorte passe a valer.
          </p>
        ) : (
          <p className="text-sm text-txt-2">
            Só entram as publicações que citam alguma das <b>{kws.length} palavras</b> cadastradas
            em <b>Relevância</b>: {fmtInt(totalGeral.postsGestao)} de {fmtInt(totalGeral.posts)}{" "}
            publicações do período. As críticas favoráveis e contrárias vêm dos{" "}
            <b>comentários de cidadãos</b> nessas publicações, com o mesmo critério que forma o
            clima. O tom da publicação em si não é classificado pelo pipeline e não é deduzido
            pelo lado do perfil.
          </p>
        )}
      </div>

      {/* Quem faz e quem tem — os quatro extremos pedidos pelo cliente */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <CardExtremo
          titulo="Mais publica sobre a gestão"
          perfil={rankVolume.maior}
          valor={(p) => fmtInt(p.postsGestao)}
          sufixo="publicações"
          cor="var(--brand)"
          vazio="Sem publicações no período"
        />
        <CardExtremo
          titulo="Menos publica sobre a gestão"
          perfil={rankVolume.menor}
          valor={(p) => fmtInt(p.postsGestao)}
          sufixo="publicações"
          cor="#64748B"
          vazio="Só um perfil no período"
        />
        <CardExtremo
          titulo="Concentra mais críticas"
          perfil={rankContra.maior}
          valor={(p) => `${fmtInt(p.contra)} contrárias · ${p.pctContra}%`}
          sufixo=""
          cor={COR_CONTRA}
          vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
        />
        <CardExtremo
          titulo="Concentra mais elogios"
          perfil={rankFavor.maior}
          valor={(p) => `${fmtInt(p.favor)} favoráveis · ${100 - p.pctContra}%`}
          sufixo=""
          cor={COR_FAVOR}
          vazio={`Nenhum perfil com ${MIN_AMOSTRA}+ comentários`}
        />
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
            <table className="w-full min-w-[640px] text-left">
              <thead>
                <tr className="text-[12px] font-bold uppercase tracking-wide text-txt-3">
                  <th className="pb-2 pr-3 font-bold">Perfil</th>
                  <th className="pb-2 pr-3 text-right font-bold">Publicações<br />sobre a gestão</th>
                  <th className="pb-2 pr-3 text-right font-bold">Críticas<br />contrárias</th>
                  <th className="pb-2 pr-3 text-right font-bold">Manifestações<br />favoráveis</th>
                  <th className="pb-2 pr-3 text-right font-bold">Saldo</th>
                  <th className="pb-2 w-32 font-bold">Composição</th>
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
          {/* Seletor de perfis */}
          <div className="flex flex-wrap gap-1.5">
            {analise.map((p) => {
              const ativo = p.autor === autor;
              const cor = CAT_COR[p.categoria] ?? "#64748B";
              return (
                <button
                  key={p.autor}
                  onClick={() => setSel(p.autor)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    ativo ? "text-white" : "text-txt-2 hover:text-txt-1"
                  }`}
                  style={
                    ativo
                      ? { background: cor, borderColor: cor }
                      : { borderColor: "var(--line)", background: "var(--bg-2)" }
                  }
                  title={`${p.categoria} · ${p.postsGestao} publicações sobre a gestão`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ativo ? "#fff" : cor }} />
                  @{p.autor}
                  <span className={ativo ? "opacity-80" : "text-txt-3"}>{p.postsGestao}</span>
                </button>
              );
            })}
          </div>

          {/* Cabeçalho do perfil ativo */}
          {perfilAtivo && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-1 px-4 py-3">
              <span className="text-lg font-extrabold text-txt-1">@{perfilAtivo.autor}</span>
              <span
                className="rounded px-2 py-0.5 text-xs font-bold uppercase"
                style={{
                  color: CAT_COR[perfilAtivo.categoria] ?? "#64748B",
                  background: `${CAT_COR[perfilAtivo.categoria] ?? "#64748B"}1A`,
                }}
              >
                {perfilAtivo.categoria || "—"}
              </span>
              <span className="text-[13px] font-semibold text-txt-3">
                {fmtInt(perfilAtivo.postsGestao)} de {fmtInt(perfilAtivo.posts)} publicações citam
                as palavras da Relevância
              </span>
              <span
                className="ml-auto rounded px-2 py-0.5 text-xs font-bold"
                style={{ color: NIVEL_COLOR[idx.nivel], background: `${NIVEL_COLOR[idx.nivel]}1A` }}
              >
                Risco {NIVEL_LABEL[idx.nivel]}
              </span>
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
            <KpiStat
              label="Publicações sobre a gestão"
              value={fmtInt(perfilAtivo?.postsGestao ?? 0)}
              sub={`${fmtInt(perfilAtivo?.comentarios ?? 0)} comentários analisados`}
            />
          </div>

          {/* Ranking de seguidores de todos os perfis monitorados (pedido do
              cliente em 25/07): quem tem mais e menos audiência e quanto cada
              conta ganhou ou perdeu entre as coletas. */}
          <RankingSeguidores />

          {/* Distribuição de sentimento + temas */}
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label mb-2">Comentários nas publicações sobre a gestão</div>
              {perfilAtivo && perfilAtivo.comentarios > 0 ? (
                <>
                  <div className="flex h-4 w-full overflow-hidden rounded-full bg-bg-2">
                    <div
                      style={{
                        width: `${(perfilAtivo.contra / perfilAtivo.comentarios) * 100}%`,
                        background: COR_CONTRA,
                      }}
                    />
                    <div
                      style={{
                        width: `${(perfilAtivo.indefinido / perfilAtivo.comentarios) * 100}%`,
                        background: COLOR_SENTIMENT.neu,
                      }}
                    />
                    <div
                      style={{
                        width: `${(perfilAtivo.favor / perfilAtivo.comentarios) * 100}%`,
                        background: COR_FAVOR,
                      }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-txt-2">
                    <span><b style={{ color: COR_CONTRA }}>{fmtInt(perfilAtivo.contra)}</b> contrárias</span>
                    <span><b style={{ color: COLOR_SENTIMENT.neu }}>{fmtInt(perfilAtivo.indefinido)}</b> sem lado</span>
                    <span><b style={{ color: COR_FAVOR }}>{fmtInt(perfilAtivo.favor)}</b> favoráveis</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-txt-3">
                  Nenhum comentário de cidadão classificado nas publicações deste perfil no período.
                </p>
              )}
            </div>

            <div className="rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label mb-2">Temas das publicações sobre a gestão</div>
              {temas.length === 0 ? (
                <p className="text-sm text-txt-3">Sem temas classificados para este perfil no período.</p>
              ) : (
                <div className="space-y-1.5">
                  {temas.map((t) => {
                    const pctNeg = t.n ? Math.round((t.neg / t.n) * 100) : 0;
                    const maxTema = temas[0]?.n || 1;
                    return (
                      <div key={t.tema}>
                        <div className="flex items-center justify-between gap-2 text-[13px]">
                          <span className="min-w-0 flex-1 truncate text-txt-2">{labelTema(t.tema)}</span>
                          <span className="tnum shrink-0 text-txt-3">{t.n} posts</span>
                        </div>
                        <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-bg-2">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.round((t.n / maxTema) * 100)}%`,
                              background: pctNeg >= 50 ? "#EF4444" : pctNeg >= 30 ? "#F97316" : "#3B82F6",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

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
                    <p className="text-[14px] leading-relaxed text-txt-1">{c.texto}</p>
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
