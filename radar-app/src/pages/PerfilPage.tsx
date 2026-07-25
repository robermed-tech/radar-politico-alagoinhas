import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar, fetchComments, type Comment } from "@/lib/data";
import { calcIndices, NIVEL_LABEL, NIVEL_COLOR } from "@/lib/indices";
import { KpiStat } from "@/components/KpiStat";
import { COLOR_SENTIMENT } from "@/lib/chartTheme";
import { fmtInt } from "@/lib/format";
import { InfluencersSection } from "@/pages/InfluencersPage";
import { RankingSeguidores, CAT_COR } from "@/components/RankingSeguidores";
import { fetchProfileMetrics } from "@/lib/data";
import { montarRanking } from "@/lib/seguidores";

const TEMA_LABEL: Record<string, string> = {
  saude: "Saúde", educacao: "Educação", obras: "Obras", seguranca: "Segurança",
  transporte: "Transporte", emprego: "Emprego", impostos: "Impostos",
  saneamento: "Saneamento", cultura_eventos: "Cultura", comunicacao: "Comunicação",
};
const labelTema = (t: string) => TEMA_LABEL[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "—");

interface PerfilResumo { autor: string; posts: number; coments: number; categoria: string }

export function PerfilPage() {
  const { data } = useQuery({ queryKey: ["radar"], queryFn: fetchRadar, staleTime: 5 * 60 * 1000 });
  const { data: comments = [] } = useQuery({
    queryKey: ["comments"],
    queryFn: () => fetchComments(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  // Mesma queryKey do RankingSeguidores: os dois leem do cache do React Query,
  // então a série é buscada uma vez só por ciclo de atualização.
  const { data: metrics = [] } = useQuery({
    queryKey: ["profile-metrics"],
    queryFn: () => fetchProfileMetrics(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
  const posts = data?.data ?? [];

  const perfis = useMemo<PerfilResumo[]>(() => {
    const by: Record<string, PerfilResumo> = {};
    for (const p of posts) {
      const a = (p.autor || "").trim();
      if (!a) continue;
      const e = (by[a] ??= { autor: a, posts: 0, coments: 0, categoria: p.categoria || "" });
      e.posts += 1;
      e.coments += p.comentarios_total || 0;
    }
    return Object.values(by).sort((a, b) => b.posts - a.posts);
  }, [posts]);

  // Default: o perfil do prefeito ("análise só de Gustavo") ou o de maior volume.
  const [sel, setSel] = useState<string | null>(null);
  const autor =
    sel ?? perfis.find((p) => /prefeito/i.test(p.categoria))?.autor ?? perfis[0]?.autor ?? null;

  const perfilAtivo = perfis.find((p) => p.autor === autor);
  // Seguidores do perfil selecionado (null enquanto não houver retrato dele).
  const seguidores = useMemo(
    () => montarRanking(metrics).find((p) => p.handle === (autor || "").toLowerCase()) ?? null,
    [metrics, autor]
  );
  const postsPerfil = useMemo(() => posts.filter((p) => p.autor === autor), [posts, autor]);
  const idx = useMemo(() => calcIndices(postsPerfil), [postsPerfil]);

  // Sentimento dos comentários, ponderado por volume de comentários do post.
  const sent = useMemo(() => {
    let wNeg = 0, wPos = 0, wTot = 0;
    for (const p of postsPerfil) {
      const t = p.comentarios_total || 0;
      wTot += t;
      wNeg += (p.comentarios_pct_neg || 0) * t;
      wPos += (p.comentarios_pct_pos || 0) * t;
    }
    const neg = wTot ? Math.round(wNeg / wTot) : 0;
    const pos = wTot ? Math.round(wPos / wTot) : 0;
    return { pos, neg, neu: Math.max(0, 100 - pos - neg) };
  }, [postsPerfil]);

  // Temas mais falados pelo/sobre o perfil.
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

  // Comentários negativos em destaque deste perfil (mais curtidos primeiro).
  const negComments = useMemo<Comment[]>(
    () =>
      comments
        .filter(
          (c) =>
            c.autor_post === autor &&
            (c.sentimento || "").toLowerCase() === "negativo" &&
            (c.texto || "").length > 2
        )
        .sort((a, b) => (b.curtidas || 0) - (a.curtidas || 0))
        .slice(0, 8),
    [comments, autor]
  );

  if (!data) return <div className="p-8 text-txt-2">Carregando…</div>;
  if (perfis.length === 0) return <div className="p-8 text-txt-2">Sem perfis para analisar.</div>;

  const maxTema = temas[0]?.n || 1;

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-extrabold text-txt-1">Análise por Perfil</h1>
        <p className="text-sm text-txt-3">
          Isola os números de um único perfil monitorado, sem misturar com o agregado geral.
        </p>
      </div>

      {/* Seletor de perfis */}
      <div className="flex flex-wrap gap-1.5">
        {perfis.map((p) => {
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
              title={`${p.categoria} · ${p.posts} posts`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ativo ? "#fff" : cor }} />
              @{p.autor}
              <span className={ativo ? "opacity-80" : "text-txt-3"}>{p.posts}</span>
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
          <span
            className="ml-auto rounded px-2 py-0.5 text-xs font-bold"
            style={{ color: NIVEL_COLOR[idx.nivel], background: `${NIVEL_COLOR[idx.nivel]}1A` }}
          >
            Risco {NIVEL_LABEL[idx.nivel]}
          </span>
        </div>
      )}

      {/* KPIs */}
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
                  dir:
                    seguidores.delta24h > 0 ? "up" : seguidores.delta24h < 0 ? "down" : "flat",
                }
              : undefined
          }
        />
        <KpiStat
          label="Críticas (comentários)"
          value={<span style={{ color: COLOR_SENTIMENT.neg, fontWeight: 700 }}>{sent.neg}%</span>}
          sub={
            <>
              <b style={{ color: COLOR_SENTIMENT.pos }}>{sent.pos}%</b> favoráveis ·{" "}
              <b style={{ color: COLOR_SENTIMENT.neu }}>{sent.neu}%</b> neutros
            </>
          }
        />
        <KpiStat label="Posts" value={fmtInt(idx.volumePosts)} sub="no período coletado" />
        <KpiStat label="Comentários" value={fmtInt(idx.volumeComents)} sub="analisados" />
      </div>

      {/* Ranking de seguidores de todos os perfis monitorados (pedido do
          cliente em 25/07): quem tem mais e menos audiência e quanto cada
          conta ganhou ou perdeu entre as coletas. */}
      <RankingSeguidores />

      {/* Distribuição de sentimento + temas */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="section-label mb-2">Sentimento dos comentários</div>
          <div className="flex h-4 w-full overflow-hidden rounded-full bg-bg-2">
            <div style={{ width: `${sent.neg}%`, background: COLOR_SENTIMENT.neg }} />
            <div style={{ width: `${sent.neu}%`, background: COLOR_SENTIMENT.neu }} />
            <div style={{ width: `${sent.pos}%`, background: COLOR_SENTIMENT.pos }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-txt-2">
            <span><b style={{ color: COLOR_SENTIMENT.neg }}>{sent.neg}%</b> críticas</span>
            <span><b style={{ color: COLOR_SENTIMENT.neu }}>{sent.neu}%</b> neutros</span>
            <span><b style={{ color: COLOR_SENTIMENT.pos }}>{sent.pos}%</b> favoráveis</span>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="section-label mb-2">Temas do perfil</div>
          {temas.length === 0 ? (
            <p className="text-sm text-txt-3">Sem temas classificados para este perfil.</p>
          ) : (
            <div className="space-y-1.5">
              {temas.map((t) => {
                const pctNeg = t.n ? Math.round((t.neg / t.n) * 100) : 0;
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

      {/* Comentários negativos em destaque */}
      <div className="rounded-xl border border-line bg-bg-1 p-4">
        <div className="section-label mb-2">Críticas em destaque</div>
        {negComments.length === 0 ? (
          <p className="text-sm text-txt-3">
            Nenhum comentário negativo classificado para @{autor} ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {negComments.map((c, i) => (
              <li key={i} className="rounded-md border border-line bg-bg-2 p-2.5">
                <p className="text-[14px] leading-relaxed text-txt-1">{c.texto}</p>
                <div className="mt-1 flex items-center gap-2 text-[13px] text-txt-3">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: COLOR_SENTIMENT.neg }} />
                  {c.username && <span>@{c.username}</span>}
                  {(c.curtidas || 0) > 0 && <span className="ml-auto tnum">♥ {c.curtidas}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Influenciadores — conteúdo da antiga página da sidebar, encaixado
          aqui por decisão da reunião de 24/07 (menos itens no menu). */}
      <InfluencersSection />
    </div>
  );
}
