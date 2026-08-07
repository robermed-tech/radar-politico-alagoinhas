/**
 * Divisão da Conversa (Share of Voice) — aprovada em 07/08/26 sobre o mockup
 * `Desktop/aprovacao-share-of-voice.html` (fluxo prévia-primeiro do projeto).
 *
 * Cinco blocos: barra da divisão com veredito em uma frase, voz por publicação
 * (comentários gerados por post de cada lado), evolução semanal, ranking de
 * quem puxa a conversa e o quadrante estratégico (voz × reação).
 *
 * Cores: o laranja da marca é a GESTÃO — identidade, não sentimento (a mesma
 * razão que tirou verde/vermelho da tela Fontes). Oposição e imprensa ficam em
 * dois tons de chumbo por tema. Vermelho aparece apenas onde mede sentimento:
 * a reação negativa, sempre na tinta `--sent-ink-neg` (ver ReacaoNegativa).
 *
 * A reação negativa é sempre "dos que tomam partido" com o piso MIN_VOTOS_IAD
 * — nunca a média diluída por post sem medição (ver o cabeçalho de lib/sov.ts:
 * a versão diluída dizia 14,4% onde a realidade por comentário era 43,5%).
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRadar } from "@/lib/data";
import { fetchSources } from "@/lib/admin";
import { calcularSov, LADO_LABEL, type Lado, type LadoStats } from "@/lib/sov";
import { MIN_VOTOS_IAD } from "@/lib/indices";
import { fmtInt } from "@/lib/format";
import { PeriodoFilter, periodoFrase, periodoLabel, type Dias } from "@/components/PeriodoFilter";
import { useThemeStore } from "@/stores/theme";
import { IconInbox } from "@/components/icons";

/** Preenchimento e tinta de cada lado, por tema. Gestão é sempre a marca. */
function coresDosLados(tema: "light" | "dark"): Record<Lado, { bg: string; ink: string }> {
  return {
    governo: { bg: "var(--brand)", ink: "#1A0F02" },
    oposicao:
      tema === "light"
        ? { bg: "#4B4A46", ink: "#F5F1E8" }
        : { bg: "#A8A29A", ink: "#171613" },
    imprensa:
      tema === "light"
        ? { bg: "#C9C2B6", ink: "#26282D" }
        : { bg: "#6B6862", ink: "#F5F1E8" },
    outros:
      tema === "light"
        ? { bg: "#8A857C", ink: "#F5F1E8" }
        : { bg: "#55534E", ink: "#F5F1E8" },
  };
}

const ORDEM_TRIO: Lado[] = ["governo", "oposicao", "imprensa"];

function fmtPct1(v: number): string {
  return `${v.toFixed(1).replace(".", ",")}%`;
}

/**
 * Reação negativa como texto: SEMPRE na tinta vermelha de sentimento (ajuste de
 * 07/08, primeira leitura do cliente). A versão anterior pintava de verde
 * abaixo de 50%, para dizer "cenário bom" — mas verde colado no rótulo
 * "Reação negativa" lia como contradição. O juízo bom/ruim vem do VALOR; a cor
 * só nomeia o que o número conta.
 */
function ReacaoNegativa({ pctNeg, votos }: { pctNeg: number | null; votos: number }) {
  if (pctNeg === null) {
    return (
      <span
        className="font-bold text-txt-3"
        title={`Só ${votos} ${votos === 1 ? "comentário tomou" : "comentários tomaram"} partido, abaixo do mínimo de ${MIN_VOTOS_IAD}.`}
      >
        sem sinal
      </span>
    );
  }
  return (
    <span className="font-bold" style={{ color: "var(--sent-ink-neg)" }}>{fmtPct1(pctNeg)}</span>
  );
}

export function SovPage() {
  const [dias, setDias] = useState<Dias>(7);
  const tema = useThemeStore((s) => s.theme);
  const COR = coresDosLados(tema);

  const { data: radar, isLoading } = useQuery({
    queryKey: ["radar"],
    queryFn: fetchRadar,
    staleTime: 5 * 60 * 1000,
  });
  const { data: fontes } = useQuery({
    queryKey: ["admin-sources"],
    queryFn: fetchSources,
    staleTime: 5 * 60 * 1000,
  });

  const sov = useMemo(
    () => (radar ? calcularSov(radar.data, fontes ?? [], dias) : null),
    [radar, fontes, dias]
  );

  if (isLoading) return <div className="p-8 text-txt-2">Carregando divisão da conversa…</div>;
  if (!sov) return null;

  const porLado = new Map(sov.lados.map((l) => [l.lado, l]));
  const gestao = porLado.get("governo");
  const trio = ORDEM_TRIO.map((l) => porLado.get(l)).filter((l): l is LadoStats => !!l);

  // Delta contra a janela anterior de mesma duração, quando existe.
  const delta =
    gestao && sov.gestaoAnterior !== null ? gestao.share - sov.gestaoAnterior : null;

  const maiorPorPost = Math.max(...trio.map((l) => l.comentsPorPost), 1);
  const maiorShareRank = Math.max(...sov.ranking.map((r) => r.share), 1);

  // Cortes do quadrante: 33,3% no eixo da voz (a divisão igual entre três
  // lados) e a média da conversa no eixo da reação.
  const CORTE_X = 100 / 3;
  const corteY = sov.pctNegConversa;
  const quadrantePronto = gestao && gestao.pctNeg !== null && corteY !== null;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Divisão da Conversa</h1>
          <p className="text-base text-txt-2">
            Quanto do debate público é da gestão, da oposição e da imprensa
          </p>
        </div>
        <PeriodoFilter dias={dias} onChange={setDias} ariaLabel="Período da divisão da conversa" />
      </div>

      {sov.totalPosts === 0 ? (
        <div className="rounded-xl border border-line bg-bg-1 p-6">
          <div className="flex items-center gap-2 font-bold text-txt-1">
            <IconInbox size={20} className="text-txt-3" />
            Sem publicações no período
          </div>
          <p className="mt-2 text-sm text-txt-2">
            Nenhuma publicação monitorada entrou {periodoFrase(dias)}. Amplie o período no seletor
            acima — se a coleta estiver parada, o aviso no topo do painel diz a causa.
          </p>
        </div>
      ) : (
        <>
          {/* ── 1. A divisão ── */}
          <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
            <div className="section-label">
              Share of Voice · {periodoLabel(dias)} · {fmtInt(sov.totalComents)}{" "}
              {sov.totalComents === 1 ? "comentário" : "comentários"}
            </div>
            {gestao && (
              <div className="mt-2 font-display text-[24px] font-bold leading-snug tracking-tight text-txt-1">
                A gestão responde por{" "}
                <span style={{ color: "var(--brand-text)" }}>{fmtPct1(gestao.share)}</span> da
                conversa
                {delta !== null && Math.abs(delta) >= 1 && (
                  <>
                    {" "}e {delta > 0 ? "subiu" : "caiu"}{" "}
                    {fmtPct1(Math.abs(delta)).replace("%", " pontos")} contra a janela anterior
                  </>
                )}
                .
              </div>
            )}
            <p className="mt-1 text-sm text-txt-3">
              Fatia calculada sobre o volume de comentários que as publicações de cada lado
              geraram {periodoFrase(dias)} — a conversa que o público teve, não o que cada perfil
              publicou.
            </p>

            <div className="mt-4 flex h-[72px] overflow-hidden rounded-xl">
              {[...sov.lados]
                .sort((a, b) => b.share - a.share)
                .map((l) => (
                  <div
                    key={l.lado}
                    className="flex flex-col items-center justify-center overflow-hidden"
                    style={{ width: `${l.share}%`, background: COR[l.lado].bg, color: COR[l.lado].ink }}
                    title={`${LADO_LABEL[l.lado]}: ${fmtPct1(l.share)} (${fmtInt(l.coments)} comentários)`}
                  >
                    {l.share >= 12 && (
                      <>
                        <span className="font-display text-[22px] font-bold leading-none">
                          {fmtPct1(l.share)}
                        </span>
                        <span className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.07em] opacity-80">
                          {LADO_LABEL[l.lado]}
                        </span>
                      </>
                    )}
                  </div>
                ))}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {trio.map((l) => (
                <div key={l.lado} className="rounded-xl border border-line bg-bg-2 p-3">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: COR[l.lado].bg }} />
                    <span className="text-[15px] font-extrabold text-txt-1">{LADO_LABEL[l.lado]}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] font-medium text-txt-3">
                    {l.perfis.length === 1
                      ? `@${l.perfis[0]}`
                      : `${l.perfis.length} ${l.lado === "imprensa" ? "veículos" : "perfis"}`}
                  </div>
                  <div className="mt-2 space-y-1 text-sm font-semibold text-txt-2">
                    <div className="flex justify-between">
                      <span>Publicações</span>
                      <b className="font-display text-txt-1">{fmtInt(l.posts)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span>Conversa gerada</span>
                      <b className="font-display text-txt-1">{fmtInt(l.coments)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span title="Percentual de comentários negativos entre os que tomam partido sobre a gestão.">
                        Reação negativa
                      </span>
                      <ReacaoNegativa pctNeg={l.pctNeg} votos={l.votos} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {/* A legenda fixa existe porque o rótulo sozinho gerou a dúvida "é
                gente falando mal da imprensa?" na primeira leitura (07/08) — a
                mesma solução da legenda do IAD em 28/07. */}
            <p className="mt-2 text-[12.5px] font-medium text-txt-3">
              Reação negativa: entre os comentários que tomam partido nas publicações de cada
              lado, a fatia que critica a gestão. A opinião medida é sempre sobre a gestão,
              nunca sobre quem publicou.
            </p>
          </div>

          {/* ── 2. Voz por publicação ── */}
          <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
            <div className="section-label">Voz por publicação</div>
            <p className="mt-1 text-sm text-txt-3">
              Quantos comentários cada publicação gera, por lado. Publicar mais não é ser mais
              ouvido.
            </p>
            <div className="mt-3 space-y-3">
              {[...trio]
                .sort((a, b) => b.comentsPorPost - a.comentsPorPost)
                .map((l) => (
                  <div key={l.lado} className="grid grid-cols-[96px_1fr_86px] items-center gap-3 sm:grid-cols-[120px_1fr_96px]">
                    <div className="text-sm font-bold leading-tight text-txt-1">
                      {LADO_LABEL[l.lado]}
                      <small className="block text-[11.5px] font-medium text-txt-3">
                        {fmtInt(l.posts)} {l.posts === 1 ? "publicação" : "publicações"}
                      </small>
                    </div>
                    <div className="h-6 overflow-hidden rounded-lg bg-bg-2">
                      <div
                        className="h-full rounded-lg"
                        style={{
                          width: `${(l.comentsPorPost / maiorPorPost) * 100}%`,
                          background: COR[l.lado].bg,
                        }}
                      />
                    </div>
                    <div className="text-right">
                      <span className="font-display text-lg font-bold text-txt-1">
                        {l.comentsPorPost.toFixed(1).replace(".", ",")}
                      </span>
                      <small className="block text-[11px] font-semibold text-txt-3">coment./post</small>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* ── 3. Evolução semanal ── */}
          {sov.semanas.some((s) => s.total > 0) && (
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Evolução semanal</div>
              <p className="mt-1 text-sm text-txt-3">
                A mesma divisão, semana a semana, nas cinco semanas até a coleta mais recente.
              </p>
              {/* No celular as 5 colunas rolam DENTRO do card (a página nunca
                  rola de lado — regra de 06/08). */}
              <div className="mt-3 overflow-x-auto pb-1">
                <div className="grid min-w-[520px] grid-cols-5 items-end gap-2.5">
                  {sov.semanas.map((s) => (
                    <div key={s.rotulo}>
                      <div className="flex h-[170px] flex-col-reverse overflow-hidden rounded-lg">
                        {s.total === 0 ? (
                          <div className="flex h-full items-center justify-center bg-bg-2 text-[11px] font-semibold text-txt-3">
                            sem coleta
                          </div>
                        ) : (
                          (["governo", "oposicao", "imprensa", "outros"] as Lado[]).map((lado) =>
                            s.share[lado] > 0 ? (
                              <div
                                key={lado}
                                className="flex items-center justify-center text-[11px] font-extrabold"
                                style={{
                                  height: `${s.share[lado]}%`,
                                  background: COR[lado].bg,
                                  color: COR[lado].ink,
                                }}
                                title={`${LADO_LABEL[lado]}: ${fmtPct1(s.share[lado])}`}
                              >
                                {s.share[lado] >= 13 ? `${Math.round(s.share[lado])}%` : ""}
                              </div>
                            ) : null
                          )
                        )}
                      </div>
                      <div className="mt-1.5 text-center text-[11.5px] font-semibold leading-tight text-txt-3">
                        <b className="block text-[12px] text-txt-2">{s.rotulo}</b>
                        {fmtInt(s.total)} {s.total === 1 ? "comentário" : "comentários"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] font-semibold text-txt-3">
                {ORDEM_TRIO.map((lado) => (
                  <span key={lado} className="flex items-center gap-1.5">
                    <span className="h-2 w-3.5 rounded-sm" style={{ background: COR[lado].bg }} />
                    {LADO_LABEL[lado]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ── 4. Quem puxa a conversa ── */}
          {sov.ranking.length > 0 && (
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Quem puxa a conversa</div>
              <p className="mt-1 text-sm text-txt-3">
                Perfis por volume de comentários gerados. A barra é a fatia da conversa total do
                período.
              </p>
              <div className="mt-3 space-y-2.5">
                {sov.ranking.map((r) => (
                  <div
                    key={r.autor}
                    className="grid items-center gap-x-3 gap-y-1 sm:grid-cols-[200px_1fr_150px]"
                  >
                    <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-txt-1">
                      <span className="h-2 w-2 shrink-0 rounded-[3px]" style={{ background: COR[r.lado].bg }} />
                      <span className="truncate">@{r.autor}</span>
                      <small className="shrink-0 font-medium text-txt-3">
                        {LADO_LABEL[r.lado].toLowerCase()}
                      </small>
                    </div>
                    <div className="h-5 overflow-hidden rounded-md bg-bg-2">
                      <div
                        className="h-full rounded-md"
                        style={{ width: `${(r.share / maiorShareRank) * 100}%`, background: COR[r.lado].bg }}
                        title={`${fmtPct1(r.share)} da conversa do período`}
                      />
                    </div>
                    <div className="flex items-baseline justify-end gap-3 text-[13px] font-semibold text-txt-2">
                      <span>{fmtInt(r.posts)} {r.posts === 1 ? "post" : "posts"}</span>
                      <span
                        className="flex items-baseline gap-1"
                        title="Percentual de comentários negativos entre os que tomam partido sobre a gestão."
                      >
                        <ReacaoNegativa pctNeg={r.pctNeg} votos={r.votos} />
                        {r.pctNeg !== null && <small className="text-[11px] text-txt-3">neg.</small>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 5. Quadrante ── */}
          {quadrantePronto && gestao && (
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
              <div className="section-label">Onde a gestão está</div>
              <p className="mt-1 text-sm text-txt-3">
                Fatia de voz cruzada com a reação do público às publicações da própria gestão.
                Cada quadrante pede uma resposta diferente.
              </p>
              <div className="mt-3 grid items-center gap-4 lg:grid-cols-[1fr_300px]">
                <div>
                  <div className="relative aspect-[1.55/1] overflow-hidden rounded-xl border border-line bg-bg-2">
                    {/* Fundos das regiões, cortados nas linhas REAIS. */}
                    <div
                      className="absolute left-0 top-0 h-full"
                      style={{ width: `${CORTE_X}%`, background: "rgba(58,61,66,0.05)" }}
                    />
                    <div
                      className="absolute right-0 top-0"
                      style={{ width: `${100 - CORTE_X}%`, height: `${100 - corteY!}%`, background: "rgba(247,150,65,0.10)" }}
                    />
                    <div
                      className="absolute bottom-0 right-0"
                      style={{ width: `${100 - CORTE_X}%`, height: `${corteY}%`, background: "rgba(194,38,38,0.07)" }}
                    />
                    {/* Linhas de corte */}
                    <div className="absolute top-0 h-full w-px bg-line" style={{ left: `${CORTE_X}%` }} />
                    <div className="absolute left-0 w-full bg-line" style={{ top: `${corteY}%`, height: 1 }} />
                    {/* Rótulos das regiões */}
                    <span className="absolute left-2 top-2 max-w-[45%] text-[11.5px] font-bold leading-tight text-txt-3">
                      <b className="font-display uppercase tracking-wide text-txt-2">Invisível</b>
                      <br />Falam bem, mas falam pouco. Produzir pauta própria.
                    </span>
                    <span className="absolute right-2 top-2 max-w-[45%] text-right text-[11.5px] font-bold leading-tight text-txt-3">
                      <b className="font-display uppercase tracking-wide text-txt-2">Dominando</b>
                      <br />Muita conversa e favorável. Manter o ritmo.
                    </span>
                    <span className="absolute bottom-2 left-2 max-w-[45%] text-[11.5px] font-bold leading-tight text-txt-3">
                      <b className="font-display uppercase tracking-wide text-txt-2">Sob fogo</b>
                      <br />Pouca voz e reação ruim. A narrativa é do outro.
                    </span>
                    <span className="absolute bottom-2 right-2 max-w-[45%] text-right text-[11.5px] font-bold leading-tight text-txt-3">
                      <b className="font-display uppercase tracking-wide text-txt-2">Sob ataque</b>
                      <br />Falam muito, e mal. Responder.
                    </span>
                    {/* Pino da gestão */}
                    <div
                      className="absolute flex -translate-x-1/2 translate-y-1/2 flex-col items-center gap-1"
                      style={{ left: `${Math.min(96, Math.max(4, gestao.share))}%`, bottom: `${Math.min(92, Math.max(8, 100 - gestao.pctNeg!))}%` }}
                    >
                      <b className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-extrabold" style={{ background: "#171613", color: "#F5F1E8" }}>
                        Gestão hoje
                      </b>
                      <i
                        className="block h-4 w-4 rounded-full"
                        style={{ background: "var(--brand)", boxShadow: "0 0 0 5px var(--brand-glow)" }}
                      />
                    </div>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] font-bold uppercase tracking-wider text-txt-3">
                    <span>← menos voz</span>
                    <span>mais voz →</span>
                  </div>
                </div>
                <div className="text-sm font-medium leading-relaxed text-txt-2">
                  <b className="text-txt-1">Posição atual:</b> {fmtPct1(gestao.share)} da conversa,
                  com {fmtPct1(gestao.pctNeg!)} de reação negativa nas próprias publicações (a
                  conversa inteira está em {fmtPct1(corteY!)}).
                  <br />
                  <br />
                  <span className="text-[12.5px] text-txt-3">
                    Os cortes: 33,3% no eixo da voz (a divisão igual entre três lados) e a média da
                    conversa no eixo da reação. Reação medida entre os comentários que tomam
                    partido, com piso de {MIN_VOTOS_IAD} votos.
                  </span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
