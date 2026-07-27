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
      className="glass-btn inline-flex shrink-0 rounded-full p-1"
    >
      {PERIODOS.map((p) => {
        const ativo = dias === p.dias;
        return (
          <button
            key={p.dias}
            onClick={() => onChange(p.dias)}
            aria-pressed={ativo}
            className={`rounded-full px-4 py-1.5 text-sm font-bold transition ${
              ativo ? "text-txt-1 shadow-sm" : "text-txt-2 hover:text-txt-1"
            }`}
            style={ativo ? { background: "rgba(255,255,255,0.25)" } : undefined}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
