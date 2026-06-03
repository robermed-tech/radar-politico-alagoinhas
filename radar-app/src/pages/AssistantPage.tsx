import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchBriefing } from "@/lib/data";
import { NIVEL_COLOR, NIVEL_LABEL, type NivelCrise } from "@/lib/indices";

function Tag({ children, color }: { children: ReactNode; color: string }) {
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
      style={{ background: `${color}1A`, color }}
    >
      {children}
    </span>
  );
}

const IMPACTO_COR: Record<string, string> = {
  alto: "#22C55E",
  medio: "#EAB308",
  baixo: "#5F6E8C",
};

export function AssistantPage() {
  const { data: b, isLoading } = useQuery({
    queryKey: ["briefing"],
    queryFn: fetchBriefing,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 15 * 60 * 1000,
  });

  if (isLoading) return <div className="p-8 text-txt-2">Carregando briefing…</div>;

  if (!b)
    return (
      <div className="p-5">
        <h1 className="text-2xl font-extrabold">Assistente Estratégico</h1>
        <div className="mt-4 rounded-xl border border-line bg-bg-1 p-6 text-txt-2">
          Nenhum briefing gerado ainda. O Assistente é produzido pelo AGORA a cada
          execução (grava em <code>ai_briefings</code>). Rode o workflow ÁGORA e
          volte aqui.
        </div>
      </div>
    );

  const nivel = (b.nivel_crise as NivelCrise) || "baixo";
  const cor = NIVEL_COLOR[nivel];

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Assistente Estratégico</h1>
          <p className="text-sm text-txt-2">
            Briefing de {b.dia} ·{" "}
            <span style={{ color: cor }} className="font-bold">
              Crise {NIVEL_LABEL[nivel]} ({Math.round(b.risco)})
            </span>
          </p>
        </div>
      </div>

      {/* Diagnóstico */}
      <div className="rounded-xl border border-line bg-bg-1 p-5">
        <div className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-2">
          Diagnóstico
        </div>
        <p className="text-[15px] leading-relaxed text-txt-1">{b.diagnostico}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Oportunidades */}
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <span className="text-risk-low">▲</span> Oportunidades
          </div>
          <div className="space-y-3">
            {(b.oportunidades ?? []).map((o, i) => (
              <div key={i} className="rounded-lg border border-line bg-bg-2 p-3">
                <div className="font-semibold text-txt-1">{o.titulo}</div>
                <div className="mt-1 text-sm text-txt-2">{o.acao}</div>
                <div className="mt-2 flex gap-2">
                  {o.impacto && <Tag color={IMPACTO_COR[o.impacto] ?? "#5F6E8C"}>impacto {o.impacto}</Tag>}
                  {o.esforco && <Tag color="#9FB0CC">esforço {o.esforco}</Tag>}
                </div>
              </div>
            ))}
            {(b.oportunidades ?? []).length === 0 && (
              <div className="text-sm text-txt-3">Sem oportunidades destacadas.</div>
            )}
          </div>
        </div>

        {/* Alertas */}
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <span className="text-risk-crit">⚠</span> Alertas
          </div>
          <div className="space-y-3">
            {(b.alertas ?? []).map((a, i) => {
              const c = NIVEL_COLOR[(a.nivel as NivelCrise) ?? "baixo"] ?? "#5F6E8C";
              return (
                <div
                  key={i}
                  className="rounded-lg border bg-bg-2 p-3"
                  style={{ borderColor: `${c}55` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-txt-1">{a.tema}</span>
                    <Tag color={c}>{a.nivel}</Tag>
                  </div>
                  {a.janela && <div className="mt-1 text-xs text-txt-3">janela: {a.janela}</div>}
                </div>
              );
            })}
            {(b.alertas ?? []).length === 0 && (
              <div className="text-sm text-txt-3">Sem alertas no período.</div>
            )}
          </div>
        </div>

        {/* Recomendações */}
        <div className="rounded-xl border border-line bg-bg-1 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold">
            <span className="text-brand">✦</span> Comunicação
          </div>
          <div className="space-y-3">
            {(b.recomendacoes ?? []).map((r, i) => (
              <div key={i} className="rounded-lg border border-line bg-bg-2 p-3">
                <div className="flex items-center gap-2">
                  <Tag color="#3B82F6">{r.canal}</Tag>
                  {r.timing && <span className="text-xs text-txt-3">{r.timing}</span>}
                </div>
                <div className="mt-1.5 text-sm text-txt-1">{r.mensagem}</div>
                {r.tom && <div className="mt-1 text-xs italic text-txt-3">tom: {r.tom}</div>}
              </div>
            ))}
            {(b.recomendacoes ?? []).length === 0 && (
              <div className="text-sm text-txt-3">Sem recomendações.</div>
            )}
          </div>
        </div>
      </div>

      <div className="text-[11px] text-txt-3">
        Gerado por IA a partir dos dados do dia · {new Date(b.gerado_em).toLocaleString("pt-BR")}
      </div>
    </div>
  );
}
