/**
 * Seletor de janela (24h / 7 dias / 30 dias) compartilhado por todas as telas
 * que mostram comentários ou análise.
 *
 * Existia uma cópia deste controle em cada página que já tinha filtro (Clima,
 * Feed, Aprovação), cada uma com um visual e um conjunto de rótulos diferente
 * ("7 dias" numa, "7d" noutra). Ao levar o filtro para as telas que não tinham
 * (Mapa da Cidade, Pedidos, Perfil, Previsões, Alertas), a divergência ia de
 * três para oito. Uma fonte só: mesmo rótulo, mesma ordem, mesmo desenho.
 */

/** Janelas suportadas, em dias. */
export type Dias = 1 | 7 | 30;

export const PERIODOS: { dias: Dias; label: string }[] = [
  { dias: 1, label: "24h" },
  { dias: 7, label: "7 dias" },
  { dias: 30, label: "30 dias" },
];

/** "últimas 24h" / "últimos 7 dias" — para subtítulos e modais. */
export function periodoLabel(dias: number): string {
  return dias === 1 ? "últimas 24h" : `últimos ${dias} dias`;
}

interface Props {
  dias: Dias;
  onChange: (d: Dias) => void;
  /** Rótulo acessível quando há mais de um seletor na mesma tela. */
  ariaLabel?: string;
}

export function PeriodoFilter({ dias, onChange, ariaLabel = "Período de análise" }: Props) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-lg border border-line bg-bg-1 p-1"
    >
      {PERIODOS.map((p) => {
        const ativo = dias === p.dias;
        return (
          <button
            key={p.dias}
            onClick={() => onChange(p.dias)}
            aria-pressed={ativo}
            className={`rounded-md px-3.5 py-1 text-sm transition ${
              ativo ? "" : "text-txt-2 hover:text-txt-1"
            }`}
            // Tinta escura sobre o laranja, e não branca: é a decisão de
            // contraste da reunião de 24/07, já usada na pílula ativa do menu
            // e no box de engajamento. Branco sobre #FB923C mede 2,26:1 e
            // reprova no AA (mínimo 4,5); com #1A0F02 passa folgado.
            //
            // O laranja é o MESMO degradê dos botões de duração do card
            // "Gravar agora" (`FUNDO_LARANJA`), e não o `var(--brand)` chapado
            // que estava aqui: o token muda de tom entre o tema claro (#FB923C)
            // e o escuro (#EA580C), então a mesma tela mostrava dois laranjas
            // diferentes lado a lado. O cliente apontou isso em 30/07 usando o
            // botão "30 min" como referência. Contraste com #1A0F02: 8,34:1 na
            // ponta clara e 5,30:1 na escura.
            //
            // O peso vem inline porque a diretriz tipográfica global do
            // index.css rebaixa `font-bold` para 400 com !important — classe
            // de peso aqui não teria efeito nenhum.
            style={
              ativo
                ? {
                    background: "linear-gradient(150deg, #FB923C 0%, #EA580C 100%)",
                    color: "#1A0F02",
                    fontWeight: 800,
                  }
                : { fontWeight: 600 }
            }
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
