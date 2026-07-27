import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { BairroStats, ComentarioBairro } from "@/lib/data";
import { fmtInt } from "@/lib/format";

const SENT_COR: Record<string, string> = {
  negativo: "#EF4444",
  positivo: "#22C55E",
  neutro: "#8593AD",
};

const SENT_LABEL: Record<string, string> = {
  negativo: "crítico",
  positivo: "favorável",
  neutro: "neutro",
};

type Filtro = "todos" | "negativo" | "positivo" | "neutro";

interface Props {
  bairro: BairroStats;
  /** Posição no ranking exibido (1 = topo da coluna). */
  posicao: number;
  /** Critério de ordenação da tela — o que colocou o bairro nessa posição. */
  criterio: "volume" | "negativo";
  /** Comentários do bairro já recortados pelo período selecionado. */
  comentarios: ComentarioBairro[];
  periodoLabel: string;
  onClose: () => void;
}

/**
 * Coletânea de comentários por trás da posição de um bairro no ranking do
 * Mapa da Cidade (pedido de 27/07: as colunas do gráfico viraram clicáveis).
 *
 * O ponto do drill-down é auditoria: a barra diz "6 menções, 100% negativas" e
 * esta tela mostra exatamente quais frases produziram esse número, para que a
 * assessoria possa conferir em vez de acreditar.
 */
export function ComentariosBairroModal({
  bairro,
  posicao,
  criterio,
  comentarios,
  periodoLabel,
  onClose,
}: Props) {
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const lista = useMemo(() => {
    const arr = filtro === "todos" ? comentarios : comentarios.filter((c) => c.sentimento === filtro);
    return [...arr].sort((a, b) => (b.curtidas || 0) - (a.curtidas || 0));
  }, [comentarios, filtro]);

  const abas: { id: Filtro; label: string; n: number; cor?: string }[] = [
    { id: "todos", label: "Todos", n: bairro.total },
    { id: "negativo", label: "Críticos", n: bairro.neg, cor: SENT_COR.negativo },
    { id: "positivo", label: "Favoráveis", n: bairro.pos, cor: SENT_COR.positivo },
    { id: "neutro", label: "Neutros", n: bairro.neu, cor: SENT_COR.neutro },
  ];

  const explicacao =
    criterio === "negativo"
      ? `${posicao}º mais crítico · ${bairro.pctNeg}% dos comentários com local são críticas`
      : `${posicao}º mais citado · ${fmtInt(bairro.total)} menç${bairro.total === 1 ? "ão" : "ões"} no período`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.8)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex max-h-[84vh] w-full max-w-xl flex-col rounded-2xl border border-line bg-bg-1 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[17px] font-extrabold text-txt-1">{bairro.localidade}</div>
            <div className="mt-0.5 text-[13px] font-semibold text-txt-3">
              {explicacao} · {periodoLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg p-1 text-txt-3 transition hover:text-txt-1"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Barra de composição: o número da coluna, decomposto. */}
        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-bg-2">
          {(["negativo", "neutro", "positivo"] as const).map((s) => {
            const n = s === "negativo" ? bairro.neg : s === "positivo" ? bairro.pos : bairro.neu;
            const pct = bairro.total ? (n / bairro.total) * 100 : 0;
            return pct > 0 ? <div key={s} style={{ width: `${pct}%`, background: SENT_COR[s] }} /> : null;
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {abas.map((a) => {
            const ativo = filtro === a.id;
            const cor = a.cor ?? "var(--brand)";
            return (
              <button
                key={a.id}
                onClick={() => setFiltro(a.id)}
                disabled={a.n === 0}
                className="rounded-lg px-3 py-1 text-[13px] font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
                style={
                  ativo
                    ? { background: cor, color: "#0B0B0B" }
                    : { border: "1px solid var(--line)", background: "var(--bg-2)", color: "var(--txt2)" }
                }
              >
                {a.label} ({fmtInt(a.n)})
              </button>
            );
          })}
        </div>

        <div className="mt-3 space-y-2 overflow-y-auto">
          {lista.length === 0 && (
            <p className="text-sm text-txt-3">
              Nenhum comentário deste tipo para {bairro.localidade} no período selecionado.
            </p>
          )}
          {lista.map((c, i) => (
            <div key={i} className="rounded-lg p-3" style={{ background: "#1E293B", border: "1px solid #334155" }}>
              <p className="text-sm leading-relaxed" style={{ color: "#F8FAFC" }}>
                “{c.texto}”
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[13px]" style={{ color: "#94A3B8" }}>
                {c.autor && <span>@{c.autor}</span>}
                <span className="tnum">
                  {fmtInt(c.curtidas)} curtida{c.curtidas === 1 ? "" : "s"}
                </span>
                {c.tema && c.tema !== "outro" && <span className="uppercase">{c.tema}</span>}
                <span className="font-bold uppercase" style={{ color: SENT_COR[c.sentimento] ?? SENT_COR.neutro }}>
                  {SENT_LABEL[c.sentimento] ?? c.sentimento}
                </span>
              </div>
              {c.pedido && (
                <div className="mt-1.5 rounded border border-line px-2 py-1 text-[13px]" style={{ color: "#CBD5E1" }}>
                  Pedido: {c.pedido}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
