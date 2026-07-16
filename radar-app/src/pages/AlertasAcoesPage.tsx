import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBriefing, fetchCrisisPlans, type CrisisPlan } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, nivelBadgeStyle, type NivelCrise } from "@/lib/indices";
import { IconAlertBell, IconCheckCircle } from "@/components/icons";

const IMPACTO_COR: Record<string, string> = {
  alto: "#22C55E",
  medio: "#EAB308",
  baixo: "#5F6E8C",
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

  if (planos.length === 0) return null;

  return (
    <div className="rounded-xl border bg-bg-1 p-5" style={{ borderColor: "rgba(249,115,22,0.35)" }}>
      <div className="mb-1 flex items-center gap-2">
        <IconAlertBell size={20} className="shrink-0" style={{ color: "#F97316" }} />
        <h2 className="text-base font-extrabold" style={{ color: "#F97316" }}>
          {reais.length > 0
            ? `${reais.length} situação(ões) que precisa(m) de atenção`
            : "Nenhuma crise real identificada"}
        </h2>
      </div>

      {reais.length === 0 && (
        <p className="mt-2 flex items-start gap-2 rounded-lg border border-risk-low/30 bg-risk-low/5 p-3 text-sm text-txt-2">
          <IconCheckCircle size={16} className="mt-0.5 shrink-0 text-risk-low" />
          Os posts de alto risco foram analisados pela IA e classificados como ruído — não exigem ação imediata.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {reais.map((p) => {
          const cor = NIVEL_COLOR[(p.nivel as NivelCrise) ?? "alto"] ?? "#F97316";
          return (
            <div
              key={p.post_url}
              className="rounded-lg border p-4"
              style={{ borderColor: `${cor}44`, background: `${cor}0D` }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="shrink-0 rounded px-2.5 py-0.5 text-xs font-extrabold uppercase"
                  style={nivelBadgeStyle(cor)}
                >
                  {NIVEL_LABEL[(p.nivel as NivelCrise) ?? "alto"] ?? p.nivel}
                </span>
                {p.tema && (
                  <span className="text-sm font-extrabold capitalize text-txt-1">
                    {p.tema}
                  </span>
                )}
                <span className="ml-auto text-xs text-txt-3">@{p.autor}</span>
              </div>

              <p className="mt-2 text-sm font-medium text-txt-1">
                <span className="font-bold text-orange-400">O que disparou: </span>
                {p.pavio}
              </p>

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

    </div>
  );
}

export function AlertasAcoesPage() {
  const { data: b, isLoading: loadBriefing } = useQuery({
    queryKey: ["briefing"],
    queryFn: () => fetchBriefing(),
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

  return (
    <div className="space-y-4 p-5">
      <div>
        <h1 className="text-2xl font-extrabold">Alertas & Ações</h1>
        <p className="text-sm text-txt-2">
          O que precisa de atenção hoje e o que fazer
        </p>
      </div>

      {semBriefing ? (
        <div className="card-hover rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Ainda não há recomendações geradas. Execute o fluxo ÁGORA para popular
          esta página.
        </div>
      ) : (
        <>
          {/* Planos do Caçador de Crises */}
          <PlanosAcao planos={planos} />

          {(b!.oportunidades ?? []).length > 0 && (
            <div className="card-hover rounded-xl border border-line bg-bg-1 p-4">
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

          <div className="text-xs text-txt-3">
            Gerado automaticamente a partir dos dados do dia ·{" "}
            {new Date(b!.gerado_em).toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        </>
      )}
    </div>
  );
}
