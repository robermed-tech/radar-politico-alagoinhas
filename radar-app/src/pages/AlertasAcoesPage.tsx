import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBriefing, fetchCrisisPlans, type CrisisPlan } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";

const JANELA_LABEL: Record<string, string> = {
  imediato: "Agir agora",
  "24h": "Agir hoje",
  "esta semana": "Esta semana",
};

const IMPACTO_COR: Record<string, string> = {
  alto: "#22C55E",
  medio: "#EAB308",
  baixo: "#5F6E8C",
};

const CANAL_ICON: Record<string, string> = {
  instagram: "📸",
  whatsapp: "💬",
  "nota oficial": "📄",
  assessoria: "🗣",
  youtube: "🎥",
  facebook: "👥",
  tv: "📺",
  radio: "📻",
};

function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded px-2 py-0.5 text-xs font-bold uppercase"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}33` }}
    >
      {children}
    </span>
  );
}

/** Planos de ação do Caçador de Crises — apenas crises reais */
function PlanosAcao({ planos }: { planos: CrisisPlan[] }) {
  const reais = planos.filter((p) => p.e_crise_real);
  const descartados = planos.filter((p) => !p.e_crise_real);

  if (planos.length === 0) return null;

  return (
    <div className="rounded-xl border bg-bg-1 p-5" style={{ borderColor: "rgba(249,115,22,0.35)" }}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xl">🚨</span>
        <h2 className="text-base font-extrabold" style={{ color: "#F97316" }}>
          {reais.length > 0
            ? `${reais.length} situação(ões) que precisa(m) de atenção`
            : "Nenhuma crise real identificada"}
        </h2>
      </div>

      {reais.length === 0 && (
        <p className="mt-2 rounded-lg border border-risk-low/30 bg-risk-low/5 p-3 text-sm text-txt-2">
          ✅ Os posts de alto risco foram analisados pela IA e classificados como ruído — não exigem ação imediata.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {reais.map((p) => {
          const cor = NIVEL_COLOR[(p.nivel as NivelCrise) ?? "alto"] ?? "#F97316";
          const janelaLabel = JANELA_LABEL[p.janela_resposta] ?? p.janela_resposta;
          return (
            <div key={p.post_url} className="rounded-lg border border-line bg-bg-2 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Tag color={cor}>{NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel}</Tag>
                <span className="rounded bg-bg-3 px-2 py-0.5 text-xs font-semibold text-txt-2">
                  ⏱ {janelaLabel}
                </span>
                <span className="ml-auto text-xs text-txt-3">@{p.autor}</span>
              </div>

              <p className="mt-2 text-sm font-medium text-txt-1">
                <span className="font-bold text-orange-400">O que disparou: </span>
                {p.pavio}
              </p>

              {p.plano_contencao?.length > 0 && (
                <div className="mt-3">
                  <div className="mb-1 text-xs font-bold uppercase tracking-wide text-txt-3">
                    O que fazer
                  </div>
                  <ol className="space-y-1.5">
                    {p.plano_contencao.map((passo, i) => (
                      <li key={i} className="flex gap-2 text-sm text-txt-1">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: `${cor}22`, color: cor }}>
                          {i + 1}
                        </span>
                        <span>{passo}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {p.risco_se_ignorar && (
                <div className="mt-3 rounded border border-risk-crit/20 bg-risk-crit/5 px-3 py-2 text-xs text-txt-2">
                  <span className="font-bold text-risk-crit">Se não agir: </span>
                  {p.risco_se_ignorar}
                </div>
              )}

              {p.post_url && (
                <a href={p.post_url} target="_blank" rel="noopener noreferrer"
                   className="mt-2 inline-block text-xs font-semibold text-brand hover:underline">
                  Ver post no Instagram ↗
                </a>
              )}
            </div>
          );
        })}
      </div>

      {descartados.length > 0 && (
        <div className="mt-3 border-t border-line/40 pt-3">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-txt-3">
            ✅ {descartados.length} post(s) de alto risco analisados — avaliados como monitoramento
          </div>
          <div className="space-y-1">
            {descartados.map((p) => (
              <div key={p.post_url} className="text-xs text-txt-3">
                @{p.autor} → {p.pavio}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function AlertasAcoesPage() {
  const { data: b, isLoading: loadBriefing } = useQuery({
    queryKey: ["briefing"],
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const { data: planosData } = useQuery({
    queryKey: ["crisis-plans"],
    queryFn: fetchCrisisPlans,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  const planos = planosData ?? [];

  if (loadBriefing) return <div className="p-8 text-txt-2">Carregando recomendações…</div>;

  const semBriefing = !b;
  const nivel = (b?.nivel_crise as NivelCrise) || "baixo";
  const cor = NIVEL_COLOR[nivel];
  const nivelLabel = NIVEL_LABEL[nivel];

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Alertas & Ações</h1>
        <p className="text-sm text-txt-2">
          O que precisa de atenção hoje e o que fazer
        </p>
      </div>

      {semBriefing ? (
        <div className="rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda não há recomendações geradas. Execute o fluxo ÁGORA para popular
          esta página.
        </div>
      ) : (
        <>
          {/* Diagnóstico do dia */}
          <div
            className="rounded-xl border bg-bg-1 p-5"
            style={{ borderColor: `${cor}55` }}
          >
            <div className="mb-1 flex items-center gap-2">
              <span
                className="rounded-full px-3 py-0.5 text-xs font-bold uppercase"
                style={{ background: `${cor}22`, color: cor }}
              >
                {nivelLabel}
              </span>
              <span className="text-xs text-txt-3">situação geral · {b!.dia}</span>
            </div>
            <p className="mt-2 text-[15px] leading-relaxed text-txt-1">{b!.diagnostico}</p>
          </div>

          {/* Planos do Caçador de Crises */}
          <PlanosAcao planos={planos} />

          {/* Alertas da IA */}
          {(b!.alertas ?? []).length > 0 && (
            <div className="rounded-xl border border-line bg-bg-1 p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-risk-crit">⚠</span>
                <h2 className="text-sm font-extrabold">Pontos de atenção</h2>
              </div>
              <div className="space-y-2">
                {b!.alertas!.map((a, i) => {
                  const c = NIVEL_COLOR[(a.nivel as NivelCrise) ?? "baixo"] ?? "#5F6E8C";
                  const jLabel = JANELA_LABEL[a.janela ?? ""] ?? a.janela ?? "";
                  return (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg border bg-bg-2 px-3 py-2"
                      style={{ borderColor: `${c}44` }}
                    >
                      <span className="text-sm font-semibold text-txt-1">{a.tema}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        {jLabel && <span className="text-xs text-txt-3">{jLabel}</span>}
                        <Tag color={c}>{a.nivel}</Tag>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {/* Oportunidades */}
            {(b!.oportunidades ?? []).length > 0 && (
              <div className="rounded-xl border border-line bg-bg-1 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-risk-low">
                  <span>▲</span> Oportunidades para aproveitar
                </div>
                <div className="space-y-3">
                  {b!.oportunidades!.map((o, i) => (
                    <div key={i} className="rounded-lg border border-line bg-bg-2 p-3">
                      <div className="font-semibold text-txt-1">{o.titulo}</div>
                      <div className="mt-1 text-sm text-txt-2">{o.acao}</div>
                      {o.impacto && (
                        <div className="mt-2">
                          <Tag color={IMPACTO_COR[o.impacto] ?? "#5F6E8C"}>
                            impacto {o.impacto}
                          </Tag>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recomendações de comunicação */}
            {(b!.recomendacoes ?? []).length > 0 && (
              <div className="rounded-xl border border-line bg-bg-1 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-bold text-brand">
                  <span>✦</span> O que comunicar hoje
                </div>
                <div className="space-y-3">
                  {b!.recomendacoes!.map((r, i) => {
                    const canalIcon = CANAL_ICON[r.canal?.toLowerCase() ?? ""] ?? "📢";
                    return (
                      <div key={i} className="rounded-lg border border-line bg-bg-2 p-3">
                        <div className="flex items-center gap-2">
                          <span>{canalIcon}</span>
                          <span className="text-xs font-bold uppercase text-txt-3">{r.canal}</span>
                          {r.timing && (
                            <span className="ml-auto text-xs text-txt-3">{r.timing}</span>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-txt-1">{r.mensagem}</p>
                        {r.tom && (
                          <p className="mt-1 text-xs italic text-txt-3">Tom: {r.tom}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="text-xs text-txt-3">
            Gerado automaticamente a partir dos dados do dia ·{" "}
            {new Date(b!.gerado_em).toLocaleString("pt-BR")}
          </div>
        </>
      )}
    </div>
  );
}
