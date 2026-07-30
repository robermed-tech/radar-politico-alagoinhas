import { useMemo } from "react";
import { createPortal } from "react-dom";
import type { BairroStats, ComentarioBairro } from "@/lib/data";
import { fmtInt, labelBairro } from "@/lib/format";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
  TINTA_COMENTARIO_2,
  tintaSentimento,
} from "@/components/ComentarioBox";

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
  // Revisão de 29/07: os chips "Todos / Críticos / Favoráveis / Neutros" saíram
  // desta coletânea por pedido do cliente — mesma linha do "Todos" que saiu dos
  // Pedidos do Povo. A lista mostra tudo, do mais curtido para o menos, e a
  // decomposição por sentimento continua visível na barra logo acima (mais o
  // chip de sentimento em cada comentário), então nada de informação se perdeu:
  // o que saiu foi o controle, não o dado.
  const lista = useMemo(
    () => [...comentarios].sort((a, b) => (b.curtidas || 0) - (a.curtidas || 0)),
    [comentarios]
  );

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
            <div className="truncate text-xl font-extrabold text-txt-1">{labelBairro(bairro.localidade)}</div>
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

        <div className="mt-3 space-y-2 overflow-y-auto">
          {lista.length === 0 && (
            <p className="text-sm text-txt-3">
              Nenhum comentário para {labelBairro(bairro.localidade)} no período selecionado.
            </p>
          )}
          {lista.map((c, i) => (
            <ComentarioBox key={i}>
              {/* Comentário em destaque maior e mais pesado (pedido de 27/07):
                  é o dado bruto que sustenta o número da barra, e precisa ser
                  o elemento mais fácil de ler do card. */}
              <ComentarioTexto>{c.texto}</ComentarioTexto>
              <ComentarioMeta>
                {c.autor && <span>@{c.autor}</span>}
                <span className="tnum">
                  {fmtInt(c.curtidas)} curtida{c.curtidas === 1 ? "" : "s"}
                </span>
                {c.tema && c.tema !== "outro" && <ComentarioChip>{c.tema}</ComentarioChip>}
                <ComentarioChip cor={tintaSentimento(c.sentimento)}>
                  {SENT_LABEL[c.sentimento] ?? c.sentimento}
                </ComentarioChip>
              </ComentarioMeta>
              {c.pedido && (
                <div
                  className="mt-1.5 rounded px-2 py-1 text-[13px] font-semibold"
                  style={{ background: "rgba(2,6,23,0.88)", color: TINTA_COMENTARIO_2 }}
                >
                  Pedido: {c.pedido}
                </div>
              )}
            </ComentarioBox>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
