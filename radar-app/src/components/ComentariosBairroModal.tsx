import { useMemo } from "react";
import type { BairroStats, ComentarioBairro } from "@/lib/data";
import { fmtInt, labelBairro } from "@/lib/format";
import { ModalShell, ModalPainel } from "@/components/ModalShell";
import {
  ComentarioBox,
  ComentarioTexto,
  ComentarioMeta,
  ComentarioChip,
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
 *
 * Casca visual: ModalShell (linha única de pop-up do painel, 03/08).
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

  return (
    <ModalShell
      onFechar={onClose}
      larguraMax="max-w-xl"
      chip="Mapa da cidade"
      titulo={labelBairro(bairro.localidade)}
      subtitulo={`${explicacao} · ${periodoLabel}`}
      icone={
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      }
    >
      {/* Barra de composição: o número da coluna, decomposto. */}
      <ModalPainel className="!p-3">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-2">
          {(["negativo", "neutro", "positivo"] as const).map((s) => {
            const n = s === "negativo" ? bairro.neg : s === "positivo" ? bairro.pos : bairro.neu;
            const pct = bairro.total ? (n / bairro.total) * 100 : 0;
            return pct > 0 ? <div key={s} style={{ width: `${pct}%`, background: SENT_COR[s] }} /> : null;
          })}
        </div>
      </ModalPainel>

      <div className="mt-3 space-y-2">
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
              <div className="mt-1.5 rounded border border-line px-2 py-1 text-[13px] font-semibold text-txt-2">
                Pedido: {c.pedido}
              </div>
            )}
          </ComentarioBox>
        ))}
      </div>
    </ModalShell>
  );
}
